/**
 * Inbound message normalization — pure logic, no SDK types.
 *
 * Feishu delivers mentions as `@_user_1` placeholders inside the text plus a
 * parallel `mentions` array; we strip them, decide whether the bot was
 * mentioned, and derive the session key. Kept free of the Lark SDK so it is
 * unit-testable without a Feishu app.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface RawMention {
  /** Placeholder token as it appears in the text, e.g. `_user_1` or `_all`. */
  key: string
  openId?: string
  name?: string
}

export interface RawFeishuMessage {
  messageId: string
  chatId: string
  chatType: 'p2p' | 'group'
  senderOpenId: string
  /** Feishu `sender.sender_type`: 'user', 'bot' or 'app'. */
  senderType?: string
  /** Raw text as delivered, mention placeholders included. */
  text: string
  mentions?: RawMention[]
  threadId?: string
  /**
   * The message this one replies to (`parent_id`).
   *
   * Present on every quote-reply. NOT a thread marker — `root_id` is present on
   * ordinary quote replies too, which is why the thread fallback uses only
   * `thread_id` (see `toRawMessage`).
   */
  parentId?: string
  /** Topic root (`root_id`); equals `parentId` outside a topic thread. */
  rootId?: string
  /** Event id, used for redelivery dedup. */
  eventId: string
}

/** A non-text message, reduced to what the media store needs. */
export interface RawFeishuAttachment {
  eventId: string
  messageId: string
  chatId: string
  chatType: 'p2p' | 'group'
  senderOpenId: string
  senderType?: string
  /** Feishu `message_type`: image / file / audio / media. */
  type: string
  fileKey?: string
  fileName?: string
  mentions?: RawMention[]
}

export interface NormalizedMessage {
  messageId: string
  eventId: string
  chatId: string
  chatType: 'p2p' | 'group'
  senderOpenId: string
  /** True when the sender is another app/bot (or ourselves). */
  fromBot: boolean
  /** Text with mention placeholders removed and whitespace collapsed. */
  text: string
  /** Whether the message mentions the bot. */
  mentioned: boolean
  /** True when the only mention is an @all. */
  mentionAllOnly: boolean
  /** Other people the sender @-ed (never the bot, never @all). */
  othersMentioned: RawMention[]
  threadId?: string
  /** The message being quoted, when this one is a reply. */
  parentId?: string
  rootId?: string
  /** Key the session map uses (chat, thread or sender scope). */
  sessionKey: string
}

const MENTION_ALL_KEYS = new Set(['_all', 'all'])

/** Strip `@_user_1` style placeholders and collapse whitespace. */
export function stripMentions(text: string, mentions: readonly RawMention[] = []): string {
  let out = text
  for (const mention of mentions) {
    if (!mention.key) continue
    out = out.split(`@${mention.key}`).join(' ')
  }
  return out.replace(/\s+/g, ' ').trim()
}

function isAllMention(mention: RawMention): boolean {
  return MENTION_ALL_KEYS.has(mention.key) || mention.name === '所有人' || mention.name === 'all'
}

/**
 * Flatten a Feishu rich-text (`post`) body into plain text.
 *
 * A post is `{title, content: [[{tag:'text'|'a'|'at'|'img'|...}]]}` — one inner
 * array per paragraph. Only the readable pieces are kept, and a link keeps its
 * href so the agent can still follow it. Returns '' for a shape we do not know,
 * which the caller treats as "unsupported" rather than as an empty message.
 */
export function extractPostText(content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return ''
  }
  const body = parsed as {
    title?: unknown
    content?: unknown
    // Locale-wrapped payload: {zh_cn: {title, content}, en_us: {...}}
    zh_cn?: { title?: unknown; content?: unknown }
  }
  const source = Array.isArray(body?.content)
    ? body
    : typeof body?.zh_cn === 'object' && body.zh_cn
      ? body.zh_cn
      : body
  const lines: string[] = []
  if (typeof source?.title === 'string' && source.title) lines.push(source.title)
  if (Array.isArray(source?.content)) {
    for (const paragraph of source.content) {
      if (!Array.isArray(paragraph)) continue
      const text = paragraph
        .map((node) => {
          if (!node || typeof node !== 'object') return ''
          const item = node as { tag?: string; text?: string; href?: string; user_name?: string }
          if (item.tag === 'text' || item.tag === 'code_block' || item.tag === 'md') return item.text ?? ''
          if (item.tag === 'a') return item.href ? `${item.text ?? ''}(${item.href})` : item.text ?? ''
          if (item.tag === 'at') return `@${item.user_name ?? ''}`
          if (item.tag === 'img') return '[图片]'
          return ''
        })
        .join('')
      if (text.trim()) lines.push(text)
    }
  }
  return lines.join('\n').trim()
}

/**
 * Normalize one inbound message.
 *
 * `botOpenId` is the bot's OWN open_id. It decides what "mentioned" means: the
 * `mentions` array carries every @ in the message, so without the comparison a
 * group where colleagues @ each other would keep waking the agent up. When the
 * id is unknown (the bot-info call failed) we fall back to the old
 * "someone was mentioned" reading rather than silently muting the bot.
 */
export function normalizeInbound(
  raw: RawFeishuMessage,
  botOpenId?: string,
): NormalizedMessage {
  const mentions = raw.mentions ?? []
  const all = mentions.filter(isAllMention)
  const real = mentions.filter((m) => !isAllMention(m))
  const selfMentioned = botOpenId ? real.some((m) => m.openId === botOpenId) : false
  const mentioned = botOpenId ? selfMentioned : real.length > 0
  const mentionAllOnly = !mentioned && all.length > 0
  return {
    messageId: raw.messageId,
    eventId: raw.eventId,
    chatId: raw.chatId,
    chatType: raw.chatType,
    senderOpenId: raw.senderOpenId,
    // Feishu never echoes our own outbound back as inbound, but another app's
    // message arrives with sender_type 'app'/'bot' — treat both as bot traffic.
    fromBot: raw.senderType === 'bot' || raw.senderType === 'app',
    text: stripMentions(raw.text, mentions),
    mentioned,
    mentionAllOnly,
    // Who ELSE was @-ed. The agent used to see nothing here: every placeholder
    // was stripped, so "问一下 @李四" reached the model as "问一下".
    othersMentioned: real.filter((mention) => mention.openId !== botOpenId),
    threadId: raw.threadId,
    parentId: raw.parentId,
    rootId: raw.rootId,
    sessionKey: raw.chatId,
  }
}

/** Apply the configured session scope to a normalized message. */
export function sessionKeyFor(
  message: NormalizedMessage,
  scope: 'chat' | 'thread' | 'sender',
): string {
  switch (scope) {
    case 'thread':
      return message.threadId ? `${message.chatId}#${message.threadId}` : message.chatId
    case 'sender':
      return `${message.chatId}#${message.senderOpenId}`
    case 'chat':
      return message.chatId
  }
}

/**
 * Redelivery dedup with a TTL. Feishu re-delivers events after a reconnect, so
 * every inbound id is checked here before any work starts.
 *
 * An id older than the TTL counts as new again: a redelivery that arrives
 * after the window is indistinguishable from a genuine repeat, and silently
 * dropping it would lose a message.
 *
 * When `file` is given the window survives a restart. Without that, every
 * duplicate Feishu re-sent while dsh was down (or before an ack) runs the agent
 * again on the next boot — the window is only as good as the process's uptime.
 */
export class Dedup {
  private seen = new Map<string, number>()
  private dirty = false
  private loading?: Promise<void>
  private writing: Promise<void> = Promise.resolve()
  /** Bumped per write, so tmp names never collide. */
  private tmpSeq = 0
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly file?: string,
  ) {}

  /** Read the persisted window. Safe to call repeatedly; the first call wins. */
  load(): Promise<void> {
    if (!this.file) return Promise.resolve()
    this.loading ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.file!, 'utf8')) as {
          ids?: Record<string, number>
        }
        const now = this.now()
        for (const [id, at] of Object.entries(parsed.ids ?? {})) {
          if (typeof at === 'number' && now - at <= this.ttlMs) this.seen.set(id, at)
        }
      } catch {
        // Missing or corrupt: an empty window is the same as a fresh process.
      }
    })()
    return this.loading
  }

  /** @returns true when the id is new (and records it), false on a replay. */
  check(id: string): boolean {
    const now = this.now()
    const at = this.seen.get(id)
    if (at !== undefined && now - at <= this.ttlMs) return false
    this.seen.set(id, now)
    this.dirty = true
    this.sweep(now)
    this.schedulePersist()
    return true
  }

  private sweep(now: number): void {
    if (this.seen.size < 1024) return
    for (const [id, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(id)
    }
  }

  /**
   * Persist on the next tick rather than per message: a burst of events must
   * not turn into a burst of file writes.
   */
  private schedulePersist(): void {
    if (!this.file || this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.writeNow()
    }, 250)
    ;(this.flushTimer as { unref?: () => void }).unref?.()
  }

  private async writeNow(): Promise<void> {
    if (!this.file || !this.dirty) return
    this.dirty = false
    const payload = JSON.stringify({ version: 1, ids: Object.fromEntries(this.seen) })
    const file = this.file
    // Unique per write: two writers in the same process (or a re-entrant flush)
    // must not race on one tmp name, and a failed write must not leave litter.
    const tmp = `${file}.${process.pid}.${(this.tmpSeq += 1)}.tmp`
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(tmp, payload, 'utf8')
        await rename(tmp, file)
      })
      .catch(async () => {
        await unlink(tmp).catch(() => undefined)
      })
    await this.writing
  }

  /** Wait for any pending write (tests, shutdown). */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.writeNow()
    await this.writing
  }

  get size(): number {
    return this.seen.size
  }
}
