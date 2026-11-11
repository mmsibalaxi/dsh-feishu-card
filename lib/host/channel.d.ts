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
import type { RawMention } from './messages.ts';
/** Facts that hold for every message of one conversation. */
export interface ChannelFacts {
    chatId: string;
    chatType: 'p2p' | 'group';
    /** Bot display name, when the profile knows it. */
    botName?: string;
    /** Bot open_id, so the model can tell itself from the humans. */
    botOpenId?: string;
}
/** Facts that change per message. */
export interface MessageEnvelope {
    chatType: 'p2p' | 'group';
    senderOpenId: string;
    /** Resolved display name; absent when the app cannot read the directory. */
    senderName?: string;
    /** Other humans the sender @-ed in this message. */
    others?: readonly RawMention[];
    /** The message this one replies to, already fetched and flattened. */
    quote?: QuotedMessage;
}
export interface QuotedMessage {
    senderOpenId?: string;
    senderName?: string;
    /** Already flattened to readable text by the quote fetcher. */
    text: string;
}
/** How much of a quoted message reaches the prompt. */
export declare const MAX_QUOTE_CHARS = 2000;
/**
 * The system-prompt section describing the channel.
 *
 * Deliberately states the quoting/mention conventions too: a model that knows
 * `> 引用 …` is a citation will not answer it as if it were the new question.
 */
export declare function channelPrompt(facts: ChannelFacts): string;
/** `姓名 (ou_xxx)` / `姓名` / `ou_xxx`, whichever parts are known. */
export declare function personLabel(name: string | undefined, openId: string | undefined): string;
/**
 * Collapse a quoted body into one readable line and clamp it.
 *
 * A quote rides on EVERY later message of the thread, so an unbounded paste
 * would be paid for on every turn.
 */
export declare function flattenQuote(text: string): string;
/**
 * Prefix one user message with the sender, the mentions and the quoted text.
 *
 * @param text - the user's own words, already mention-stripped
 * @param envelope - who sent it, who else was mentioned, what it replies to
 * @returns the model-facing text; identical to `text` when nothing is known
 */
export declare function composeTurnText(text: string, envelope: MessageEnvelope): string;
