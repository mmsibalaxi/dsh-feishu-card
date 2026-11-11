/**
 * What the model knows about the Feishu conversation it is answering.
 *
 * Until 2026-11-09 the agent received one thing: the message text. No chat id,
 * no chat type, no sender, no idea that a message was a reply to something. The
 * user's own Hermes bridge injects all four (gateway/session.py, run_inbound.py),
 * and the gap showed up as real failures: "把这个群的日报汇总一下" had no chat to
 * look at, and "这条你再看下" quoted a message the model could not see.
 *
 * Two surfaces, on purpose:
 *   - {@link channelPrompt} → the SYSTEM prompt. chat_id/chat_type are facts about
 *     the conversation, true for every message in it.
 *   - {@link composeTurnText} → a header line on each USER message. Sender,
 *     mentions and the quoted text change per message, so they cannot live in a
 *     system prompt that is assembled once.
 */
import type { RawMention } from './messages.ts'

/** Facts that hold for every message of one conversation. */
export interface ChannelFacts {
  chatId: string
  chatType: 'p2p' | 'group'
  /** Bot display name, when the profile knows it. */
  botName?: string
  /** Bot open_id, so the model can tell itself from the humans. */
  botOpenId?: string
}

/** Facts that change per message. */
export interface MessageEnvelope {
  chatType: 'p2p' | 'group'
  senderOpenId: string
  /** Resolved display name; absent when the app cannot read the directory. */
  senderName?: string
  /** Other humans the sender @-ed in this message. */
  others?: readonly RawMention[]
  /** The message this one replies to, already fetched and flattened. */
  quote?: QuotedMessage
}

export interface QuotedMessage {
  senderOpenId?: string
  senderName?: string
  /** Already flattened to readable text by the quote fetcher. */
  text: string
}

/** How much of a quoted message reaches the prompt. */
export const MAX_QUOTE_CHARS = 2000

/**
 * The system-prompt section describing the channel.
 *
 * Deliberately states the quoting/mention conventions too: a model that knows
 * `> 引用 …` is a citation will not answer it as if it were the new question.
 */
export function channelPrompt(facts: ChannelFacts): string {
  const kind = facts.chatType === 'group' ? '群聊' : '单聊'
  const lines = [
    '# 飞书渠道',
    '你正在飞书（Lark）里和用户对话，不是一个终端会话。用户在飞书客户端读你的回复。',
    `- 会话类型：${kind}`,
    `- 会话 ID（chat_id）：${facts.chatId}`,
  ]
  if (facts.botName || facts.botOpenId) {
    const name = facts.botName ? facts.botName : '本机器人'
    lines.push(`- 机器人自身：${name}${facts.botOpenId ? `（open_id ${facts.botOpenId}）` : ''}`)
  }
  if (facts.chatType === 'group') {
    lines.push('- 群里只有明确 @ 到你的消息才会转给你；@ 别人不会触发你。')
  }
  lines.push(
    '- 每条消息前会有一行 `[发送人 …]`；如果用户 @ 了别人，还会有 `[同时提到 …]`。',
    '- 用户引用某条消息时，正文前会有 `> 引用 …：「原文」`，那是被引用的旧内容，不是这一轮的问题。',
    '- 回复直接给结论，不要复述这些标记。',
  )
  return lines.join('\n')
}

/** `姓名 (ou_xxx)` / `姓名` / `ou_xxx`, whichever parts are known. */
export function personLabel(name: string | undefined, openId: string | undefined): string {
  const person = name?.trim()
  const id = openId?.trim()
  if (person && id) return `${person} (${id})`
  if (person) return person
  if (id) return id
  return '未知'
}

/**
 * Collapse a quoted body into one readable line and clamp it.
 *
 * A quote rides on EVERY later message of the thread, so an unbounded paste
 * would be paid for on every turn.
 */
export function flattenQuote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= MAX_QUOTE_CHARS) return flat
  return `${flat.slice(0, MAX_QUOTE_CHARS)}…（引用过长，已截断）`
}

/**
 * Prefix one user message with the sender, the mentions and the quoted text.
 *
 * @param text - the user's own words, already mention-stripped
 * @param envelope - who sent it, who else was mentioned, what it replies to
 * @returns the model-facing text; identical to `text` when nothing is known
 */
export function composeTurnText(text: string, envelope: MessageEnvelope): string {
  const header: string[] = []
  const name = envelope.senderName?.trim()
  // A p2p chat has exactly one human, so a bare open_id there is pure noise;
  // in a group the sender is the whole point of the line.
  if (name || envelope.chatType === 'group') {
    header.push(
      `[发送人 ${personLabel(envelope.senderName, envelope.senderOpenId)}]`,
    )
  }
  const others = (envelope.others ?? [])
    .filter((mention) => mention.name || mention.openId)
    .map((mention) => personLabel(mention.name, mention.openId))
  if (others.length > 0) header.push(`[同时提到 ${others.join('、')}]`)
  if (envelope.quote) {
    const who = personLabel(envelope.quote.senderName, envelope.quote.senderOpenId)
    const quoted = flattenQuote(envelope.quote.text)
    if (quoted) header.push(`> 引用 ${who}：「${quoted}」`)
  }
  if (header.length === 0) return text
  return `${header.join('\n')}\n\n${text}`
}