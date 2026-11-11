/**
 * Feishu's emoji key for "on it" (收到/马上处理), posted when the message arrives.
 *
 * Deliberately not DONE at this point: a check mark claims the work is finished.
 * Keys are Feishu's own camel-case enum values, not emoji characters.
 */
export declare const ACK_EMOJI = "OnIt";
/** The completed state: "received AND answered". */
export declare const DONE_EMOJI = "DONE";
/**
 * The interrupted state (user feedback 2026-11-11).
 *
 * A stopped turn must not claim ✅ — nothing was answered. `THINKING` renders as
 * the puzzled "hmm?" face, which reads as "this one stopped mid-thought". Verified
 * accepted by Feishu's reaction API; other candidates (`Shrug`, `GLANCE`) also
 * work if this one ever looks wrong.
 */
export declare const INTERRUPTED_EMOJI = "THINKING";
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
     * The OLD emoji is removed BEFORE the new one is added (user preference
     * 2026-11-11): the two states must never coexist, not even for the fraction of
     * a second an add-first order leaves them together. A message we never acked
     * still gets the final emoji — the earlier create may simply have failed.
     *
     * If adding the new one fails, the previous receipt is put back best-effort so
     * the message is not left with no reaction at all.
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
