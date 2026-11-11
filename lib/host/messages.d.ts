/**
 * Inbound message normalization — pure logic, no SDK types.
 *
 * Feishu delivers mentions as `@_user_1` placeholders inside the text plus a
 * parallel `mentions` array; we strip them, decide whether the bot was
 * mentioned, and derive the session key. Kept free of the Lark SDK so it is
 * unit-testable without a Feishu app.
 */
export interface RawMention {
    /** Placeholder token as it appears in the text, e.g. `_user_1` or `_all`. */
    key: string;
    openId?: string;
    name?: string;
}
export interface RawFeishuMessage {
    messageId: string;
    chatId: string;
    chatType: 'p2p' | 'group';
    senderOpenId: string;
    /** Feishu `sender.sender_type`: 'user', 'bot' or 'app'. */
    senderType?: string;
    /** Raw text as delivered, mention placeholders included. */
    text: string;
    mentions?: RawMention[];
    threadId?: string;
    /**
     * The message this one replies to (`parent_id`).
     *
     * Present on every quote-reply. NOT a thread marker — `root_id` is present on
     * ordinary quote replies too, which is why the thread fallback uses only
     * `thread_id` (see `toRawMessage`).
     */
    parentId?: string;
    /** Topic root (`root_id`); equals `parentId` outside a topic thread. */
    rootId?: string;
    /** Event id, used for redelivery dedup. */
    eventId: string;
}
/** A non-text message, reduced to what the media store needs. */
export interface RawFeishuAttachment {
    eventId: string;
    messageId: string;
    chatId: string;
    chatType: 'p2p' | 'group';
    senderOpenId: string;
    senderType?: string;
    /** Feishu `message_type`: image / file / audio / media. */
    type: string;
    fileKey?: string;
    fileName?: string;
    mentions?: RawMention[];
}
export interface NormalizedMessage {
    messageId: string;
    eventId: string;
    chatId: string;
    chatType: 'p2p' | 'group';
    senderOpenId: string;
    /** True when the sender is another app/bot (or ourselves). */
    fromBot: boolean;
    /** Text with mention placeholders removed and whitespace collapsed. */
    text: string;
    /** Whether the message mentions the bot. */
    mentioned: boolean;
    /** True when the only mention is an @all. */
    mentionAllOnly: boolean;
    /** Other people the sender @-ed (never the bot, never @all). */
    othersMentioned: RawMention[];
    threadId?: string;
    /** The message being quoted, when this one is a reply. */
    parentId?: string;
    rootId?: string;
    /** Key the session map uses (chat, thread or sender scope). */
    sessionKey: string;
}
/** Strip `@_user_1` style placeholders and collapse whitespace. */
export declare function stripMentions(text: string, mentions?: readonly RawMention[]): string;
/**
 * Flatten a Feishu rich-text (`post`) body into plain text.
 *
 * A post is `{title, content: [[{tag:'text'|'a'|'at'|'img'|...}]]}` — one inner
 * array per paragraph. Only the readable pieces are kept, and a link keeps its
 * href so the agent can still follow it. Returns '' for a shape we do not know,
 * which the caller treats as "unsupported" rather than as an empty message.
 */
export declare function extractPostText(content: string): string;
/**
 * Normalize one inbound message.
 *
 * `botOpenId` is the bot's OWN open_id. It decides what "mentioned" means: the
 * `mentions` array carries every @ in the message, so without the comparison a
 * group where colleagues @ each other would keep waking the agent up. When the
 * id is unknown (the bot-info call failed) we fall back to the old
 * "someone was mentioned" reading rather than silently muting the bot.
 */
export declare function normalizeInbound(raw: RawFeishuMessage, botOpenId?: string): NormalizedMessage;
/** Apply the configured session scope to a normalized message. */
export declare function sessionKeyFor(message: NormalizedMessage, scope: 'chat' | 'thread' | 'sender'): string;
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
export declare class Dedup {
    private readonly ttlMs;
    private readonly now;
    private readonly file?;
    private seen;
    private dirty;
    private loading?;
    private writing;
    /** Bumped per write, so tmp names never collide. */
    private tmpSeq;
    private flushTimer?;
    constructor(ttlMs: number, now?: () => number, file?: string | undefined);
    /** Read the persisted window. Safe to call repeatedly; the first call wins. */
    load(): Promise<void>;
    /** @returns true when the id is new (and records it), false on a replay. */
    check(id: string): boolean;
    private sweep;
    /**
     * Persist on the next tick rather than per message: a burst of events must
     * not turn into a burst of file writes.
     */
    private schedulePersist;
    private writeNow;
    /** Wait for any pending write (tests, shutdown). */
    flush(): Promise<void>;
    get size(): number;
}
