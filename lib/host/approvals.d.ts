/**
 * Feishu-side approval prompts.
 *
 * The gap this closes: `@deepseek-ai/dsh-user-approval` asks a human before a
 * sensitive tool runs, but its only interactive answerer is the desktop GUI's
 * dialog. A turn driven from Feishu therefore stalls on a window nobody is
 * looking at — the chat sees a card that never finishes.
 *
 * How this hooks in: `approval/request` is a **waterfall** event. A listener
 * returns an outcome to claim the request, or calls `next()` to delegate to the
 * next answerer (ultimately the GUI's). We register with `{ prepend: true }`
 * because the sibling order is registration order, not a priority mechanism: the
 * app bundle registers its answerer before any profile plugin loads, so without
 * `prepend` every request would be claimed before it reached us.
 *
 * Two deliberate limits, both from the seam's own contract:
 *
 *   - **No "allow always" outcome exists.** The vocabulary is closed
 *     (`allowed-once | rejected | cancelled | unavailable`). "Always" is
 *     therefore OUR memory, keyed by (chat, tool), with a TTL and a `/approvals`
 *     reset — see `ApprovalMemory`. It grants one request at a time; the seam
 *     still audits every decision.
 *   - **The request carries no tool arguments.** The card can say which tool and
 *     why, and nothing else: showing an imagined command line would be a lie.
 *
 * A failure to ASK (no transport, card rejected) delegates with `next()` instead
 * of answering `unavailable`: the GUI may still be able to ask, and failing
 * closed on our own plumbing error would block a turn the user could have
 * approved in two clicks.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval';
/** The narrow Feishu surface the asker needs (faked in tests). */
export interface ApprovalTransport {
    sendCard(chatId: string, card: unknown): Promise<string | undefined>;
    updateCard(cardId: string, card: unknown): Promise<void>;
}
/** What a person chose in the card. */
export type ApprovalChoice = 'once' | 'always' | 'deny';
/**
 * "Always allow" memory.
 *
 * Persisted because the annoyance it removes (the same tool asking every turn)
 * spans restarts, and TTL'd because a grant made in a hurry should not silently
 * outlive the task that justified it. Every auto-grant is traced.
 */
export declare class ApprovalMemory {
    private readonly options;
    private grants;
    private loaded;
    constructor(options?: {
        file?: string;
        ttlMs?: number;
        now?: () => number;
        log?: (message: string) => void;
    });
    private get now();
    private get ttl();
    /** `chatId \u0000 toolName` — one flat key keeps the file trivially readable. */
    private static key;
    /** Read the file once; a missing or corrupt file means "no grants". */
    private ensureLoaded;
    private prune;
    /** Does this chat already trust this tool? Expired grants are dropped here. */
    allowed(chatId: string, tool: string): boolean;
    /** Grant one (chat, tool) pair for a TTL and persist it. */
    remember(chatId: string, tool: string): void;
    /** Every live grant, newest expiry last (panel/status display). */
    list(): {
        chatId: string;
        tool: string;
        expiresAt: number;
    }[];
    /** Drop every grant; returns how many were live. */
    forgetAll(): number;
    private save;
}
export interface FeishuApprovalsOptions {
    transport: ApprovalTransport;
    timeoutMs?: number;
    memory?: ApprovalMemory;
    log?: (message: string) => void;
}
export declare class FeishuApprovals {
    private readonly options;
    private readonly chats;
    private readonly pendings;
    private readonly timeoutMs;
    readonly memory: ApprovalMemory;
    private disposed;
    constructor(options: FeishuApprovalsOptions);
    /** Questions waiting for a click (diagnostics). */
    get pendingCount(): number;
    /** Remember which chat owns a session, so a request can find its way home. */
    bind(sessionId: string, chatId: string): void;
    /**
     * Answer this agent's approval requests through Feishu.
     *
     * Registered in the agent's own scope (so it only ever sees that agent's
     * requests) and prepended (so it runs before the app's GUI answerer).
     */
    register(agentCtx: Context): void;
    /**
     * Decide one request: answer it here, or hand it to the next answerer.
     *
     * Public so the waterfall handler and the tests use the exact same path — a
     * private method reached only through a cordis event would be untestable
     * without a live host.
     */
    handleRequest(req: {
        agent?: unknown;
        toolName?: unknown;
        reason?: unknown;
        signal?: AbortSignal;
    }, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
    /**
     * Post the prompt and wait for a click.
     *
     * @returns the outcome, or `undefined` when the card could not be sent (the
     *   caller delegates) — a timeout is `cancelled`, which is an honest answer.
     */
    private prompt;
    /**
     * Route a card button click to its pending request.
     *
     * @returns the callback response (toast + refreshed card) or undefined when the
     *   click was not ours.
     */
    handleCardAction(data: unknown): Promise<{
        toast?: {
            type: string;
            content: string;
        };
        card?: {
            type: string;
            data: unknown;
        };
    } | undefined>;
    /** Redraw a prompt with its outcome, so a stale card cannot be clicked twice. */
    private settle;
    /** Withdraw every pending prompt (plugin shutdown). */
    dispose(): void;
}
/**
 * Build the approval card (Card 2.0).
 *
 * Three buttons rather than two: "allow once" is the safe default and "deny"
 * the safe exit, while "always" is the one that changes future behaviour — it is
 * worded to say so, because a person clicking it is granting a standing right.
 */
export declare function buildApprovalCard(pending: {
    toolName: string;
    reason?: string;
    id?: string;
}, options?: {
    note?: string;
    settled?: ApprovalChoice;
}): unknown;
