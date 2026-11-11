/**
 * Real CardKit transport over the Lark SDK (v1.76 signatures verified against
 * node_modules/@larksuiteoapi/node-sdk/types/index.d.ts).
 *
 * One flow only — the one Feishu's own docs require ("create the card entity,
 * then send it"):
 *   cardkit.v1.card.create({ data: { type:'card_json', data } })   → card_id
 *   im.v1.message.create/reply(... content references the card_id ...)  → message
 *   cardkit.v1.card.update / batchUpdate / settings({ path:{card_id}, ... })
 *
 * NOTE there is deliberately NO "send the card JSON as the message content and
 * use the message_id as the card id" fallback (the hermes plugin's older path).
 * CardKit's `card_id` must come from `cardkit.card.create`; a message id is not
 * one, so every later `batchUpdate`/`settings` call fails — and because the
 * message itself *was* sent, `StreamingCard.delivered` used to read true and
 * suppress the plain-text fallback. The user ended up with an empty card stuck
 * on "处理中" and no answer at all. An honest error here lets the bridge fall
 * back to text, which is strictly better than a silent dead end.
 */
import * as Lark from '@larksuiteoapi/node-sdk'
import { CardApiError } from './seal.ts'
import type { CardTransport } from './streaming.ts'

export interface LarkCardTransportOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
  /**
   * Called once the card's message exists, with its message id.
   *
   * The card id (CardKit) and the message id (im) are different identifiers and
   * only the latter arrives in `im.message.recalled_v1` — which is what the
   * message-protection guard needs to know which card just disappeared.
   */
  onCardMessage?: (info: { cardId: string; messageId: string }) => void
  logger?: {
    warn: (message: string) => void
    info?: (message: string) => void
  }
}

export class LarkCardTransport implements CardTransport {
  private readonly client: Lark.Client

  constructor(private readonly options: LarkCardTransportOptions) {
    this.client = new Lark.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    })
  }

  /** Create the card entity, post it into the chat, return its card id. */
  async createCard(chatId: string, card: unknown, replyToMessageId?: string): Promise<string> {
    let cardId: string | undefined
    try {
      const created = await this.client.cardkit.v1.card.create({
        data: { type: 'card_json', data: JSON.stringify(card) },
      })
      cardId = readId(created?.data?.card_id)
    } catch (error) {
      throw toCardError('card.create', error)
    }
    if (!cardId) {
      throw new Error(
        'card.create returned no card_id — 检查应用是否已开通 CardKit（卡片）权限，或把回复模式改成纯文本',
      )
    }
    const messageId = await this.postCardMessage(
      chatId,
      JSON.stringify({ type: 'card', data: { card_id: cardId } }),
      replyToMessageId,
    )
    if (messageId) this.options.onCardMessage?.({ cardId, messageId })
    this.options.logger?.info?.(`feishu-card: card entity ${cardId} sent`)
    return cardId
  }

  /**
   * Post a card into the chat, as a reply when a message id is given.
   *
   * Replying makes Feishu render the "回复 XXX" quote header, so an answer is
   * visibly attached to the message it answers.
   */
  private async postCardMessage(
    chatId: string,
    content: string,
    replyToMessageId?: string,
  ): Promise<string | undefined> {
    if (replyToMessageId) {
      const sent = await this.client.im.v1.message.reply({
        path: { message_id: replyToMessageId },
        data: { msg_type: 'interactive', content },
      })
      return readId(sent?.data?.message_id ?? (sent?.data as { messageId?: string })?.messageId)
    }
    const sent = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'interactive', content },
    })
    return readId(sent?.data?.message_id ?? (sent?.data as { messageId?: string })?.messageId)
  }

  async updateCard(cardId: string, card: unknown, sequence: number): Promise<void> {
    await this.call(
      'update',
      this.client.cardkit.v1.card.update({
        data: { card: { type: 'card_json', data: JSON.stringify(card) }, sequence },
        path: { card_id: cardId },
      }),
    )
  }

  async batchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void> {
    await this.call(
      'batchUpdate',
      this.client.cardkit.v1.card.batchUpdate({
        data: { actions: JSON.stringify(actions), sequence },
        path: { card_id: cardId },
      }),
    )
  }

  async settings(cardId: string, settings: unknown, sequence: number): Promise<void> {
    await this.call(
      'settings',
      this.client.cardkit.v1.card.settings({
        data: { settings: JSON.stringify(settings), sequence },
        path: { card_id: cardId },
      }),
    )
  }

  /**
   * Turn a non-zero Feishu code into a CardApiError carrying that code, so the
   * seal executor can branch on 300309/300301/300314/300315.
   */
  private async call(operation: string, promise: Promise<unknown>): Promise<void> {
    let response: { code?: number; msg?: string } | undefined
    try {
      response = (await promise) as { code?: number; msg?: string }
    } catch (error) {
      throw toCardError(operation, error)
    }
    if (response && typeof response.code === 'number' && response.code !== 0) {
      throw new CardApiError(response.code, `${operation} failed: code=${response.code} msg=${response.msg}`)
    }
  }
}

/**
 * Normalize whatever the SDK rejected with into a CardApiError.
 *
 * A transport error without a numeric code (DNS, socket, timeout) stays a plain
 * Error on purpose: there is nothing to branch on, and the seal must fail loudly
 * so the bridge can fall back to a text reply.
 */
function toCardError(operation: string, error: unknown): Error {
  const code =
    (error as { code?: unknown })?.code ?? (error as { response?: { code?: unknown } })?.response?.code
  if (typeof code === 'number' && code !== 0) {
    return new CardApiError(code, `${operation} failed: code=${code} ${String(error).slice(0, 160)}`)
  }
  return error instanceof Error ? error : new Error(`${operation} failed: ${String(error)}`)
}

function readId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
