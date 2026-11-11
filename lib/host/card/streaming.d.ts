/**
 * Streaming card controller.
 *
 * Wraps the CardKit v2.0 lifecycle for one turn:
 *   create (streaming_mode) → throttled partial updates → seal
 *
 * Everything Feishu-specific goes through the injected CardTransport, so the
 * flush timing, element updates and seal order are unit-tested without a
 * Feishu app. The real transport (Lark SDK) lives in card/transport.ts.
 */
import { buildFooterElement, type FooterInput, type SealReport } from './seal.ts';
import type { FooterField } from '../../shared/types.js';
export interface CardTransport {
    /** Send the initial card; returns the card id used by later calls. */
    createCard(chatId: string, card: unknown, replyToMessageId?: string): Promise<string>;
    updateCard(cardId: string, card: unknown, sequence: number): Promise<void>;
    batchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void>;
    settings(cardId: string, settings: unknown, sequence: number): Promise<void>;
}
export interface StreamingCardOptions {
    transport: CardTransport;
    chatId: string;
    /** Which footer fields to render, in display order. */
    footerFields: FooterField[];
    flushIntervalMs: number;
    /** Show the reasoning stream inside the process panel (hermes' opt-in). */
    showReasoning?: boolean;
    /** Keep the process panel expanded once the turn seals. */
    panelExpanded?: boolean;
    panelExpandedWhileRunning?: boolean;
    /** Live footer readings; called on create and on every flush. */
    footerSource?: () => FooterInput;
    /** Model shown in the panel's collapsed header. */
    panelModel?: () => string | undefined;
    /** Reasoning-round count for the panel's collapsed header. */
    panelRounds?: () => number;
    /** Message the card answers; the card is posted as a quoted reply. */
    replyToMessageId?: string;
    /**
     * Conversation this card belongs to. When set, the card carries a ⏹ 停止
     * button that reports back with this key, so the runtime can cancel exactly
     * this turn (and nothing else).
     */
    sessionKey?: string;
    /**
     * The person who opened this turn. Carried into the stop button's callback
     * value so the runtime can refuse a click from anybody else — Feishu renders
     * ONE card for the whole chat, so the restriction has to be enforced when the
     * button is pressed (2026-11-10).
     */
    stopOwnerOpenId?: string;
    /**
     * Called with the CardKit card id as soon as it exists, so the runtime can
     * find this card again when its message is recalled (message protection).
     */
    onCardId?: (cardId: string) => void;
    /**
     * Rewrites markdown image refs into Feishu `img_key`s before the card seals.
     * Best effort: a failure must never cost the answer.
     */
    resolveImages?: (text: string) => Promise<string>;
    /**
     * Delays before each seal attempt (first entry is "now").
     *
     * A finished card that never seals keeps its "still working" dots and a live
     * 停止 button forever, so the tail attempt is deliberately late: a network
     * hiccup that outlives ~3s usually clears well before 10s.
     */
    sealRetryDelaysMs?: number[];
    now?: () => number;
    log?: (message: string) => void;
}
export declare class StreamingCard {
    private readonly options;
    private cardId?;
    private sequence;
    /**
     * The answer, one entry per model step.
     *
     * A turn can make several requests (reasoning → tool call → answer). Each one
     * streams its own text and then settles with its own `assistant/message`, so
     * keeping ONE buffer meant every step REPLACED the previous step's words — the
     * card visibly rewrote itself (Hermes appends segments instead).
     */
    private segments;
    private reasoning;
    /** Tool calls in flight/done, with their durations. */
    private steps;
    /** What changed since the last write. Answer and panel flush on different clocks. */
    private answerDirty;
    private panelDirty;
    private timer?;
    /**
     * Content is frozen: the turn is over, so nothing new may be pushed.
     *
     * Separate from {@link sealed} on purpose. `sealed` means THE SEAL PLAN
     * LANDED. Conflating them is what left finished cards showing their "still
     * working" dots and a live 停止 button: the plan threw, `sealed` was already
     * true, and no retry was possible (live report 2026-11-10).
     */
    private closed;
    /** The seal plan was applied; the card can never change again. */
    private sealed;
    /** In-flight seal, shared by every concurrent caller. */
    private sealing?;
    /** Status requested before the card existed; applied by start(). */
    private pendingSeal?;
    /** Serialized card writes — see write(). */
    private writes;
    /** True once a batchUpdate carrying answer text was accepted by Feishu. */
    private answerWritten;
    /**
     * True once ANY batchUpdate was accepted.
     *
     * Distinguishes "the transport works, this seal hit a hiccup" (worth a late
     * retry) from "this card never accepted anything" (a misconfiguration no
     * retry will fix).
     */
    private wroteOk;
    private readonly startedAt;
    /**
     * Longest a tool-panel-only change may wait.
     *
     * Every write is a round trip and they are serialized, so a panel refresh that
     * rides the answer's clock competes with the text. Measured live (2026-11-10):
     * 72% of all card writes carried no new answer text, median gap between writes
     * 913ms, and the text advanced ~58 characters at a time. Two seconds keeps a
     * long tool-heavy turn from paying a full round trip per tool row.
     */
    static readonly PANEL_REFRESH_MS = 2000;
    constructor(options: StreamingCardOptions);
    /** Joined answer text across every step of this turn. */
    private get answer();
    /** Replace all answer text with one block (image rewriting at seal time). */
    private setAnswerText;
    /**
     * The answer split into card-sized parts.
     *
     * Part 0 streams on the live card; the rest is posted after the seal as
     * continuation cards. Splitting is deterministic, so part 0 only ever grows
     * while the live card is being written.
     */
    private answerParts;
    /** What the live card's answer element holds right now. */
    private answerForCard;
    /**
     * Post the remainder of a long answer as static cards.
     *
     * Not awaited: these are separate messages, not part of the seal, and a turn
     * must not wait on N more card creations. Each failure is logged and skipped —
     * a missing tail is better than a stuck turn.
     */
    private sendContinuations;
    private get dirty();
    /** Milliseconds since the card was created. */
    private elapsedMs;
    /** Create the card. Safe to call once; later calls are no-ops. */
    start(): Promise<void>;
    /**
     * Reasoning deltas.
     *
     * Collected always (the count is a real signal, and a later flush may want the
     * tail), rendered only when `showReasoning` is on — hermes gates it the same
     * way, because a wall of scratchpad text buries the answer.
     */
    pushReasoning(delta: string): void;
    pushAnswer(delta: string): void;
    /** Append to the step that is streaming right now. */
    private appendToSegment;
    /**
     * Start a new answer segment for the next model step.
     *
     * Called on `step/start`. Without it a multi-step turn's steps would concatenate
     * into one run-on paragraph; with it each step's text keeps its own paragraph
     * and, critically, its own authority (see {@link setAnswer}).
     */
    newSegment(): void;
    /**
     * Replace the CURRENT segment with the authoritative text of the step that
     * just settled.
     *
     * The live stream is a sequence of attempts (one per LLM request); the durable
     * `assistant/message` carries the authoritative text of the step that settled.
     * Only that segment is replaced — replacing the whole answer (the old
     * behaviour) made earlier steps' words disappear, which is what "文字回退" looked
     * like in the card.
     */
    setAnswer(text: string): void;
    pushTool(line: string): void;
    /**
     * Record a tool call starting. `at` is the event's own timestamp so the
     * duration measures the call, not our scheduling latency.
     *
     * Steps are indexed by call id, not by name: two `grep` calls can run at the
     * same time, and matching on the name merged them into one row, left the
     * second one spinning forever and computed 0ms for both.
     */
    toolStart(id: string, name: string, at: number, preview?: string): void;
    /** Close a tool call with its wall-clock duration (and its failure, if any). */
    toolEnd(id: string, at: number, ok?: boolean, error?: string): void;
    private readonly toolStartedAt;
    /** call id → index in `steps` (indices are stable: the array only grows). */
    private readonly stepIndex;
    get text(): string;
    /**
     * Whether this turn's answer actually reached Feishu as a card.
     *
     * "Reached" means a batchUpdate carrying the answer was accepted by Feishu —
     * not merely that a card id exists and text was buffered. The old definition
     * claimed delivery for a card whose every write failed (the message-id
     * fallback, or a missing CardKit scope), which suppressed the plain-text
     * fallback and left the user with a stuck card and no answer.
     */
    get delivered(): boolean;
    get id(): string | undefined;
    /**
     * Record that there is unsent content.
     *
     * Deliberately independent of `cardId`: deltas that arrive before the card
     * exists must survive until `start()` flushes them, otherwise the first
     * (often only) burst of text is dropped and the user gets an empty card.
     */
    private markAnswerDirty;
    private markPanelDirty;
    /**
     * Serialize every write to this card.
     *
     * `batchUpdate` rejects when two writes race (Feishu answers 300317
     * "sequence number compare failed"), and the timer's flush is fire-and-forget
     * — an unhandled rejection there takes the whole host process down. So all
     * writes (flush, seal) go through one chain, and nothing
     * escapes uncaught.
     */
    private write;
    /**
     * Throttled write of the dirty elements.
     *
     * The delay depends on WHAT changed: text gets the short clock (100ms by
     * default, the cadence the user's Hermes bridge uses), the process panel gets
     * a long one. Every flush is a round trip on one serialized chain, so letting
     * a tool row ride the text clock is what made the typewriter arrive in bursts.
     */
    private scheduleFlush;
    /**
     * Write whatever changed.
     *
     * Only the elements that actually changed are sent: a flush that carries no
     * text used to re-send the whole panel anyway, which is how half of all live
     * writes advanced nothing.
     */
    flush(): Promise<void>;
    /** flush(), serialized onto the card's write chain. */
    private flushQueued;
    /** Finish the turn: flush, refresh the footer, close streaming. */
    seal(input: {
        status: string;
        elapsed?: string;
    }): Promise<SealReport | undefined>;
    /**
     * Apply the seal plan, retrying the two transient failure classes.
     *
     * A seal is the ONE write that must land: until it does, a finished answer
     * keeps its "still working" dots and a live 停止 button, and nothing can push
     * a fix because the turn is over. `runSealPlan` already tolerates the
     * "already satisfied" codes; this adds
     *   - serialization on the write chain (a flush may still be in flight, and a
     *     concurrent batchUpdate answers 300317 "sequence number compare failed"),
     *   - up to two retries with fresh sequence numbers, for a network blip.
     */
    private sealWithRetry;
    /** The actual seal body, shared by every concurrent caller. */
    private runSeal;
    /** Interrupted turn: seal with the stopped status, keep whatever streamed. */
    abort(): Promise<SealReport | undefined>;
    /**
     * The card's message was recalled or deleted — stop writing to it.
     *
     * Feishu keeps accepting updates for a recalled card and renders nothing, so
     * every later flush is a wasted API call (and can burn the rate limit during
     * a long turn). hermes calls this the message-protection guard; without it a
     * user who recalls a runaway answer keeps paying for it invisibly.
     */
    markUnavailable(reason?: string): void;
    private buildFooter;
    private asApi;
}
/** 12.3s / 1m 39s — same shape as hermes' _format_elapsed. */
export declare function formatElapsed(ms: number): string;
export { buildFooterElement };
