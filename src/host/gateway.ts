/**
 * Feishu/Lark gateway — WebSocket long connection.
 *
 * Uses the official `@larksuiteoapi/node-sdk`:
 *   const ws = new Lark.WSClient({ appId, appSecret, domain })
 *   await ws.start({ eventDispatcher })
 *
 * Long connection means no public callback URL, no reverse proxy — the same
 * transport the user's Hermes bridge and every other DSH bridge uses.
 *
 * Everything Feishu-specific is normalized into RawFeishuMessage here; the
 * access-control decision and agent driving live in access.ts / bridge.ts.
 */
import * as Lark from '@larksuiteoapi/node-sdk'
import { extractPostText, type RawFeishuAttachment, type RawFeishuMessage } from './messages.ts'

export interface GatewayOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
  onMessage: (raw: RawFeishuMessage) => void | Promise<void>
  onUnsupported?: (info: {
    chatId: string
    chatType: 'p2p' | 'group'
    type: string
    senderOpenId?: string
    mentioned?: boolean
  }) => void
  /**
   * Card button callbacks (`card.action.trigger`). Arrive over the same long
   * connection once the developer console subscribes to them; until then the
   * ask card's free-form path carries the answer instead.
   */
  onCardAction?: (data: unknown) => void | Promise<unknown>
  /**
   * A message was recalled (撤回). Feishu sends this for the bot's own messages
   * too, which is how the streaming card learns it should stop updating.
   */
  onMessageRecalled?: (info: { messageId: string; chatId?: string }) => void
  /**
   * A picture / file / voice message. The bytes are NOT fetched here: the
   * runtime decides whether the sender is allowed before it spends a download.
   */
  onAttachment?: (attachment: RawFeishuAttachment) => void
  logger?: {
    info: (message: string) => void
    warn: (message: string) => void
    debug: (message: string) => void
  }
}

interface LarkMessage {
  message_id?: string
  root_id?: string
  parent_id?: string
  thread_id?: string
  chat_id?: string
  chat_type?: 'p2p' | 'group'
  message_type?: string
  content?: string
  mentions?: { key?: string; id?: { open_id?: string }; name?: string }[]
}

const SUPPORTED_TYPES = new Set(['text'])
/** Types whose payload points at a downloadable resource. */
const RESOURCE_TYPES = new Set(['image', 'file', 'audio', 'media'])

/** Pull the file key / name out of a resource message's JSON content. */
export function parseResourceContent(
  type: string,
  content: string,
): { fileKey?: string; fileName?: string } {
  try {
    const parsed = JSON.parse(content) as {
      image_key?: string
      file_key?: string
      file_name?: string
    }
    const fileKey = parsed.image_key ?? parsed.file_key
    return { fileKey: fileKey || undefined, fileName: parsed.file_name || undefined }
  } catch {
    return {}
  }
}

/**
 * Map a Feishu `im.message.receive_v1` payload onto our raw message.
 *
 * Pure and exported so the field mapping can be tested against realistic
 * payloads. NOTE the thread rule — learned from a production bug in the user's
 * own Hermes bridge (#19711 / #20548): `root_id` is present on EVERY quoted
 * reply, so using it as a thread fallback turns ordinary quote-replies into
 * topic sessions and pushes the answer into a fresh thread. Only a native
 * `thread_id` marks a topic.
 */
export function toRawMessage(data: {
  event_id?: string
  sender: { sender_id?: { open_id?: string }; sender_type: string }
  message: {
    message_id: string
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    thread_id?: string
    root_id?: string
    parent_id?: string
    mentions?: { key: string; id?: { open_id?: string }; name: string }[]
  }
}): RawFeishuMessage | undefined {
  const message = data.message
  const openId = data.sender?.sender_id?.open_id
  if (!message.message_id || !message.chat_id || !openId) return undefined

  let text = ''
  try {
    const parsed = JSON.parse(message.content ?? '{}') as { text?: string }
    text = parsed.text ?? ''
  } catch {
    return undefined
  }

  return {
    messageId: message.message_id,
    // Feishu's canonical dedup key is the top-level event_id; message_id is
    // the fallback for payloads that omit it.
    eventId: data.event_id ?? message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type === 'group' ? 'group' : 'p2p',
    senderOpenId: openId,
    // 'user' | 'bot' | 'app' — the access gate drops app traffic by default.
    senderType: data.sender?.sender_type,
    text,
    mentions: (message.mentions ?? []).map((mention) => ({
      key: mention.key,
      openId: mention.id?.open_id,
      name: mention.name,
    })),
    threadId: message.thread_id ?? undefined,
    // The quoted message. `parent_id` is the immediate one; `root_id` is the
    // topic root, which equals the parent outside a topic thread.
    parentId: message.parent_id ?? undefined,
    rootId: message.root_id ?? undefined,
  }
}

export class FeishuGateway {
  private ws?: Lark.WSClient

  constructor(private readonly options: GatewayOptions) {}

  get domain(): Lark.Domain {
    return this.options.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
  }

  async start(): Promise<void> {
    const { appId, appSecret, logger } = this.options
    logger?.info(`feishu-card: connecting to ${this.options.brand} over WebSocket`)

    // The handler parameter is typed by the SDK's own event map, so a wrong
    // field name fails `tsc` instead of the first live message.
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data) => {
        // Deliberately NOT returning the promise. The SDK acknowledges the frame
        // only after this handler resolves (`handleEventData` awaits
        // `eventDispatcher.invoke` before sending the response), and a turn can
        // take minutes — an unacknowledged event is re-delivered by Feishu, and
        // in-memory dedup is lost on restart.
        void this.handleEvent(data).catch((error) => {
          logger?.warn(`feishu-card: inbound handler failed: ${error}`)
        })
        return undefined
      },
      // Card 2.0 `behaviors: callback` buttons land here. A returned value is
      // the callback response, so the asker can toast and refresh its card.
      'card.action.trigger': async (data: unknown) => {
        if (!this.options.onCardAction) return undefined
        try {
          return await this.options.onCardAction(data)
        } catch (error) {
          logger?.warn(`feishu-card: card action handler failed: ${error}`)
          return undefined
        }
      },
      // Message protection: a recalled message cannot be updated any more, so
      // the card that carried it must stop writing (every later call would be
      // accepted by Feishu and render nothing).
      'im.message.recalled_v1': (data: {
        event_id?: string
        message_id?: string
        chat_id?: string
      }) => {
        if (!data?.message_id) return undefined
        this.options.onMessageRecalled?.({ messageId: data.message_id, chatId: data.chat_id })
        return undefined
      },
    })

    this.ws = new Lark.WSClient({ appId, appSecret, domain: this.domain })
    // SDK v1.65+ requires passing the dispatcher to start(); constructing alone
    // no longer connects.
    await this.ws.start({ eventDispatcher: dispatcher })
    logger?.info('feishu-card: WebSocket connected')
  }

  private async handleEvent(data: {
    event_id?: string
    sender: { sender_id?: { open_id?: string }; sender_type: string }
    message: {
      message_id: string
      chat_id: string
      chat_type: string
      message_type: string
      content: string
      thread_id?: string
      root_id?: string
      parent_id?: string
      mentions?: { key: string; id?: { open_id?: string }; name: string }[]
    }
  }): Promise<void> {
    const message = data.message
    const openId = data.sender?.sender_id?.open_id
    if (!message.message_id || !message.chat_id || !openId) {
      this.options.logger?.debug('feishu-card: ignoring event without message/sender ids')
      return
    }

    const chatType = message.chat_type === 'group' ? 'group' : 'p2p'
    const type = message.message_type ?? 'unknown'

    // A rich-text post is text: flatten it and run the normal message path, so
    // commands, allowlists and session keys all behave the same.
    if (type === 'post') {
      const text = extractPostText(message.content ?? '')
      if (!text) {
        this.options.onUnsupported?.({ chatId: message.chat_id, chatType, type, senderOpenId: openId })
        return
      }
      await this.options.onMessage(
        toRawMessage({
          event_id: data.event_id,
          sender: data.sender,
          message: { ...message, message_type: 'text', content: JSON.stringify({ text }) },
        }) ?? {
          messageId: message.message_id,
          eventId: data.event_id ?? message.message_id,
          chatId: message.chat_id,
          chatType,
          senderOpenId: openId,
          senderType: data.sender?.sender_type,
          text,
          mentions: [],
        },
      )
      return
    }

    if (RESOURCE_TYPES.has(type)) {
      const { fileKey, fileName } = parseResourceContent(type, message.content ?? '')
      if (!fileKey) {
        this.options.onUnsupported?.({ chatId: message.chat_id, chatType, type, senderOpenId: openId })
        return
      }
      this.options.onAttachment?.({
        eventId: data.event_id ?? message.message_id,
        messageId: message.message_id,
        chatId: message.chat_id,
        chatType,
        senderOpenId: openId,
        senderType: data.sender?.sender_type,
        type,
        fileKey,
        fileName,
        mentions: (message.mentions ?? []).map((mention) => ({
          key: mention.key,
          openId: mention.id?.open_id,
          name: mention.name,
        })),
      })
      return
    }

    if (!SUPPORTED_TYPES.has(type)) {
      this.options.onUnsupported?.({
        chatId: message.chat_id,
        chatType,
        type,
        senderOpenId: openId,
        mentioned: (message.mentions?.length ?? 0) > 0,
      })
      return
    }

    const raw = toRawMessage({
      event_id: data.event_id,
      sender: data.sender,
      message: {
        ...message,
        message_type: message.message_type ?? 'unknown',
      },
    })
    if (!raw) {
      this.options.logger?.debug(`feishu-card: ignoring event for ${message.message_id}`)
      return
    }
    await this.options.onMessage(raw)
  }

  async stop(): Promise<void> {
    const ws = this.ws
    this.ws = undefined
    if (!ws) return
    try {
      // The SDK exposes close() on the underlying connection in some versions.
      const closable = ws as unknown as { close?: () => void }
      closable.close?.()
    } catch (error) {
      this.options.logger?.warn(`feishu-card: gateway stop failed: ${error}`)
    }
  }
}
