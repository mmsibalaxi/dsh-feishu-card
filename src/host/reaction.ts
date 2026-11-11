/**
 * The "I saw your message" reaction, and the "…and here is your answer" one.
 *
 * Why this exists (user feedback 2026-11-09: 收到消息要有回复的表情):
 * the first visible sign of a turn is a card, and the card costs two round
 * trips plus a first flush — on a slow model the sender stares at a silent chat
 * for seconds and has no way to tell "received" from "ignored". One emoji on
 * their own message is the cheapest honest receipt: no message, no card, and it
 * rides a permission the app already holds (`im:message.reactions:write_only`).
 *
 * The receipt is a STATE, not a sticker (user feedback 2026-11-10): once the
 * answer is out, 🫡 "on it" is a lie — the message must then carry ✅ (or nothing
 * at all, when the turn failed). So the reaction is replaced on settle, and the
 * emoji id Feishu returns from `create` is what makes the replacement possible.
 *
 * Best effort BY CONSTRUCTION: a missing scope, a recalled message or a rate
 * limit must never cost the answer, so every failure is a warning and a `false`.
 */
import * as Lark from '@larksuiteoapi/node-sdk'

/**
 * Feishu's emoji key for "on it" (收到/马上处理), posted when the message arrives.
 *
 * Deliberately not DONE at this point: a check mark claims the work is finished.
 * Keys are Feishu's own camel-case enum values, not emoji characters.
 */
export const ACK_EMOJI = 'OnIt'

/** The completed state: "received AND answered". */
export const DONE_EMOJI = 'DONE'

export interface ReactionOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
  logger?: { warn: (message: string) => void }
  /** Injection point for tests: the actual add call. */
  create?: (messageId: string, emojiType: string) => Promise<unknown>
  /** Injection point for tests: the actual remove call. */
  remove?: (messageId: string, reactionId: string) => Promise<unknown>
}

/** What one message currently carries, so it can be replaced. */
interface Placed {
  emoji: string
  /** Feishu's `reaction_id`; absent when the create call did not report one. */
  reactionId?: string
}

export class FeishuReactor {
  /** Bounded memory of messages we reacted to (redelivery and settle both hit it). */
  private readonly placed = new Map<string, Placed>()
  private readonly create: (messageId: string, emojiType: string) => Promise<unknown>
  private readonly remove: (messageId: string, reactionId: string) => Promise<unknown>

  constructor(private readonly options: ReactionOptions) {
    const client =
      options.create && options.remove
        ? undefined
        : new Lark.Client({
            appId: options.appId,
            appSecret: options.appSecret,
            domain: options.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
          })
    this.create =
      options.create ??
      ((messageId, emojiType) =>
        client!.im.v1.messageReaction.create({
          path: { message_id: messageId },
          data: { reaction_type: { emoji_type: emojiType } },
        }))
    this.remove =
      options.remove ??
      ((messageId, reactionId) =>
        client!.im.v1.messageReaction.delete({
          path: { message_id: messageId, reaction_id: reactionId },
        }))
  }

  private remember(messageId: string, placed: Placed): void {
    this.placed.set(messageId, placed)
    // Oldest-first eviction: a long-running host must not grow without bound.
    if (this.placed.size > 500) {
      const oldest = this.placed.keys().next()
      if (!oldest.done) this.placed.delete(oldest.value)
    }
  }

  /** Add one reaction, returning the id Feishu assigned (when it reports one). */
  private async add(messageId: string, emojiType: string): Promise<string | undefined> {
    const response = (await this.create(messageId, emojiType)) as
      | { data?: { reaction_id?: string } }
      | undefined
    return response?.data?.reaction_id
  }

  /**
   * React to one inbound message. Safe to call twice with the same id.
   *
   * @param messageId - the message the bot is answering
   * @param emojiType - Feishu emoji key; defaults to "on it"
   * @returns whether the reaction was accepted
   */
  async ack(messageId: string, emojiType: string = ACK_EMOJI): Promise<boolean> {
    if (!messageId) return false
    if (this.placed.has(messageId)) return false
    try {
      const reactionId = await this.add(messageId, emojiType)
      this.remember(messageId, { emoji: emojiType, ...(reactionId ? { reactionId } : {}) })
      return true
    } catch (error) {
      // A reaction is a courtesy. Log it where a maintainer can find it, and
      // let the turn run.
      this.options.logger?.warn(`feishu-card: reaction ${emojiType} on ${messageId} failed: ${error}`)
      return false
    }
  }

  /**
   * Turn the receipt into its final state (✅ by default) once the answer is out.
   *
   * Adds the new emoji BEFORE removing the old one, so the message never sits
   * with no reaction for a moment. A message we never acked still gets the final
   * emoji — the create may simply have failed earlier.
   *
   * @param messageId - the message that was answered
   * @param emojiType - final Feishu emoji key
   * @returns whether the final reaction is in place
   */
  async settle(messageId: string, emojiType: string = DONE_EMOJI): Promise<boolean> {
    if (!messageId) return false
    const previous = this.placed.get(messageId)
    if (previous?.emoji === emojiType) return true
    try {
      const reactionId = await this.add(messageId, emojiType)
      this.remember(messageId, { emoji: emojiType, ...(reactionId ? { reactionId } : {}) })
    } catch (error) {
      this.options.logger?.warn(`feishu-card: final reaction ${emojiType} on ${messageId} failed: ${error}`)
      // Keep whatever is already there: a stale "on it" beats no receipt at all.
      return false
    }
    if (previous?.reactionId) await this.drop(messageId, previous.reactionId)
    return true
  }

  /**
   * Remove the receipt entirely (the turn failed — "done" would be a lie).
   *
   * @param messageId - the message whose reaction should go away
   * @returns whether something was removed
   */
  async clear(messageId: string): Promise<boolean> {
    if (!messageId) return false
    const previous = this.placed.get(messageId)
    this.placed.delete(messageId)
    if (!previous?.reactionId) return false
    return this.drop(messageId, previous.reactionId)
  }

  /** Delete one reaction, best effort. */
  private async drop(messageId: string, reactionId: string): Promise<boolean> {
    try {
      await this.remove(messageId, reactionId)
      return true
    } catch (error) {
      // Already gone (the user removed it, or the message was recalled) and a
      // real failure look the same here, and neither is worth failing a turn.
      this.options.logger?.warn(`feishu-card: could not remove reaction on ${messageId}: ${error}`)
      return false
    }
  }

  /** What this message currently carries, for tests and diagnostics. */
  placedEmoji(messageId: string): string | undefined {
    return this.placed.get(messageId)?.emoji
  }
}