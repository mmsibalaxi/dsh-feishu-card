import type { QuotedMessage } from './channel.ts';
export interface QuoteOptions {
    appId: string;
    appSecret: string;
    brand: 'feishu' | 'lark';
    logger?: {
        warn: (message: string) => void;
    };
    /**
     * Injection point for tests: the raw API call.
     *
     * `cardContent` asks Feishu for the card JSON itself
     * (`card_msg_content_type: 'user_card_content'`); without it an `interactive`
     * message carries only a "please upgrade your client" placeholder.
     */
    get?: (messageId: string, options?: {
        cardContent?: boolean;
    }) => Promise<unknown>;
}
/** Pull every text run out of a card JSON blob (best effort, nested anywhere). */
export declare function cardText(content: string): string;
/** The sender fields of one `im.v1.message.get` payload. */
export declare function senderOfPayload(payload: unknown): {
    senderOpenId?: string;
    senderName?: string;
};
/**
 * The `msg_type` of the first item, for branching (e.g. cards need a 2nd call).
 */
export declare function messageTypeOf(payload: unknown): string | undefined;
/**
 * Turn one `im.v1.message.get` payload into a quotable message.
 *
 * Pure so every message type can be tested without Feishu. Unknown types still
 * yield a label (`[视频]`, `[未知消息]`) — silence would let the model answer a
 * question it cannot see.
 */
export declare function parseQuotedMessage(payload: unknown): QuotedMessage | undefined;
export declare class FeishuQuoteFetcher {
    private readonly options;
    private readonly get;
    constructor(options: QuoteOptions);
    /**
     * Just the sender of one message.
     *
     * `contact/v3/users/{id}` is gated by the APP's 通讯录 data scope, so it answers
     * 41050 for everybody outside it — which is most of a group. The message itself
     * carries the display name (`with_sender_name`), and reading it needs only the
     * bot's normal message scope, so this is how a stranger gets a name
     * (2026-11-12: 机器人见过的人全是「未知用户」).
     */
    senderOf(messageId: string): Promise<{
        senderOpenId?: string;
        senderName?: string;
    }>;
    /**
     * Resolve one quoted message. Never throws: a quote is context, not a
     * prerequisite, and a failed lookup must not cost the turn.
     */
    fetch(messageId: string): Promise<QuotedMessage | undefined>;
}
