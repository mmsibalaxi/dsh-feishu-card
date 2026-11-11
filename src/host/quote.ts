/**
 * Fetch the message a user is replying to.
 *
 * Feishu puts only `parent_id` on a quote-reply; the text lives in the message
 * it points at. Without this the model sees "这条你再看下" and has no idea what
 * "这条" is — the failure the user reported on 2026-11-09, and the same thing the
 * Hermes bridge solves by pulling the parent before the turn starts.
 *
 * `im.v1.message.get` needs the bot to be in the chat (it always is — the event
 * came from there) and honors `with_sender_name`, so a quote carries a readable
 * name without any contact-directory permission.
 */
import * as Lark from '@larksuiteoapi/node-sdk'
import type { QuotedMessage } from './channel.ts'
import { extractPostText } from './messages.ts'

export interface QuoteOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
  logger?: { warn: (message: string) => void }
  /**
   * Injection point for tests: the raw API call.
   *
   * `cardContent` asks Feishu for the card JSON itself
   * (`card_msg_content_type: 'user_card_content'`); without it an `interactive`
   * message carries only a "please upgrade your client" placeholder.
   */
  get?: (messageId: string, options?: { cardContent?: boolean }) => Promise<unknown>
}

/** Card body text is derived from these node tags, in document order. */
const CARD_TEXT_TAGS = new Set(['plain_text', 'lark_md', 'markdown'])

/** Pull every text run out of a card JSON blob (best effort, nested anywhere). */
export function cardText(content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return ''
  }
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const tag = typeof record.tag === 'string' ? record.tag : undefined
    if (tag && CARD_TEXT_TAGS.has(tag) && typeof record.content === 'string') {
      // A quote line is plain prose inside `> 引用 …`, so the card's own
      // markdown emphasis is dropped rather than re-rendered inside it.
      const text = record.content
        .replace(/<[^>]+>/g, '')
        .replace(/[*_`~]/g, '')
        .trim()
      if (text) out.push(text)
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') walk(value)
    }
  }
  walk(parsed)
  return out.join('\n').trim()
}

/** The `msg_type` of the first item, for branching (e.g. cards need a 2nd call). */
export function messageTypeOf(payload: unknown): string | undefined {
  const items = (payload as { data?: { items?: unknown[] } } | undefined)?.data?.items
  const item = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined
  return typeof item?.msg_type === 'string' ? item.msg_type : undefined
}

/**
 * Turn one `im.v1.message.get` payload into a quotable message.
 *
 * Pure so every message type can be tested without Feishu. Unknown types still
 * yield a label (`[视频]`, `[未知消息]`) — silence would let the model answer a
 * question it cannot see.
 */
export function parseQuotedMessage(payload: unknown): QuotedMessage | undefined {
  const items = (payload as { data?: { items?: unknown[] } } | undefined)?.data?.items
  const item = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined
  if (!item) return undefined
  if (item.deleted === true) {
    return { text: '（这条消息已被撤回）' }
  }
  const sender = item.sender as
    | { id?: string; sender_type?: string; sender_name?: string; open_bot_id?: string }
    | undefined
  // For an app/bot sender, `sender.id` is the APP id (`cli_…`), not an open_id;
  // printing it in a `姓名 (id)` label would be a lie. `open_bot_id` is the real
  // open_id when Feishu supplies one.
  const userSender = sender?.sender_type === undefined || sender.sender_type === 'user'
  const senderOpenId = userSender ? sender?.id : sender?.open_bot_id
  const type = typeof item.msg_type === 'string' ? item.msg_type : 'unknown'
  const raw = (item.body as { content?: string } | undefined)?.content ?? ''
  let text = ''
  try {
    switch (type) {
      case 'text':
        text = (JSON.parse(raw) as { text?: string }).text ?? ''
        break
      case 'post':
        text = extractPostText(raw)
        break
      case 'image':
        text = '[图片]'
        break
      case 'file':
      case 'audio':
      case 'media':
        text = `[${type === 'file' ? '文件' : type === 'audio' ? '语音' : '视频'}]`
        break
      case 'interactive':
        text = cardText(raw) || '[卡片消息]'
        break
      case 'system':
        text = '[系统提示]'
        break
      default:
        text = `[${type === 'unknown' ? '未知消息' : type}]`
        break
    }
  } catch {
    text = ''
  }
  if (!text.trim()) return undefined
  return {
    ...(senderOpenId ? { senderOpenId } : {}),
    ...(sender?.sender_name ? { senderName: sender.sender_name } : {}),
    text,
  }
}

export class FeishuQuoteFetcher {
  private readonly get: (messageId: string, options?: { cardContent?: boolean }) => Promise<unknown>

  constructor(private readonly options: QuoteOptions) {
    if (options.get) {
      this.get = options.get
      return
    }
    const client = new Lark.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    })
    this.get = (messageId, callOptions) =>
      client.im.v1.message.get({
        path: { message_id: messageId },
        params: {
          with_sender_name: true,
          // Read live: without this an `interactive` message returns Feishu's
          // "请升级至最新版本客户端" placeholder instead of the card body.
          ...(callOptions?.cardContent ? { card_msg_content_type: 'user_card_content' } : {}),
        },
      })
  }

  /**
   * Resolve one quoted message. Never throws: a quote is context, not a
   * prerequisite, and a failed lookup must not cost the turn.
   */
  async fetch(messageId: string): Promise<QuotedMessage | undefined> {
    if (!messageId) return undefined
    try {
      const payload = await this.get(messageId)
      const quoted = parseQuotedMessage(payload)
      if (quoted && messageTypeOf(payload) !== 'interactive') return quoted
      // A card message needs its own call to get the JSON; a second failure just
      // keeps the placeholder label.
      const withCard = await this.get(messageId, { cardContent: true })
      return parseQuotedMessage(withCard) ?? quoted
    } catch (error) {
      this.options.logger?.warn(`feishu-card: could not read quoted message ${messageId}: ${error}`)
      return undefined
    }
  }
}