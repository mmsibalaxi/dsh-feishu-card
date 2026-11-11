/**
 * Feishu's emoji key for "on it" (收到/马上处理), posted when the message arrives.
 *
 * Deliberately not DONE at this point: a check mark claims the work is finished.
 * Keys are Feishu's own camel-case enum values, not emoji characters.
 */
export declare const ACK_EMOJI = "OnIt";
/** The completed state: "received AND answered". */
export declare const DONE_EMOJI = "DONE";
export interface ReactionOptions {
    appId: string;
    appSecret: string;
    brand: 'feishu' | 'lark';
    logger?: {
        warn: (message: string) => void;
    };
    /** Injection point for tests: the actual add call. */
    create?: (messageId: string, emojiType: string) => Promise<unknown>;
    /** Injection point for tests: the actual remove call. */
    remove?: (messageId: string, reactionId: string) => Promise<unknown>;
}
export declare class FeishuReactor {
    private readonly options;
    /** Bounded memory of messages we reacted to (redelivery and settle both hit it). */
    private readonly placed;
    private readonly create;
    private readonly remove;
    constructor(options: ReactionOptions);
    private remember;
    /** Add one reaction, returning the id Feishu assigned (when it reports one). */
    private add;
    /**
     * React to one inbound message. Safe to call twice with the same id.
     *
     * @param messageId - the message the bot is answering
     * @param emojiType - Feishu emoji key; defaults to "on it"
     * @returns whether the reaction was accepted
     */
    ack(messageId: string, emojiType?: string): Promise<boolean>;
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
    settle(messageId: string, emojiType?: string): Promise<boolean>;
    /**
     * Remove the receipt entirely (the turn failed — "done" would be a lie).
     *
     * @param messageId - the message whose reaction should go away
     * @returns whether something was removed
     */
    clear(messageId: string): Promise<boolean>;
    /** Delete one reaction, best effort. */
    private drop;
    /** What this message currently carries, for tests and diagnostics. */
    placedEmoji(messageId: string): string | undefined;
}
