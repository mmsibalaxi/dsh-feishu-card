import type { Context } from '@deepseek-ai/cordis';
import { type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent';
import { StreamingCard } from './card/streaming.ts';
import type { SessionStore } from './sessions.ts';
import { type ResetPolicy } from './session-reset.ts';
/**
 * Text blocks of one assistant message, in order.
 *
 * A step's message carries reasoning, text and tool-call blocks; only the text
 * blocks are the answer. Reasoning and tool calls are already rendered through
 * the live stream and the process panel.
 */
export declare function assistantText(message: unknown): string;
/** How a turn ended, as far as the runtime needs to know. */
export type TurnEnd = 'completed' | 'stopped' | 'blocked' | 'timed-out';
export interface TurnResult {
    text: string;
    model?: string;
    timedOut: boolean;
    /** True when the reply went out as a streaming card. */
    carded: boolean;
    /**
     * True when a card exists at all (even if it carried no text).
     *
     * A stopped turn usually has an empty answer: the card still says 已停止, so
     * the runtime must NOT also post a "（本轮无输出）" message next to it
     * (2026-11-10). `carded` cannot express this — it means "text reached the
     * card".
     */
    cardCreated: boolean;
    /** Why the turn ended; `stopped` means the user cancelled it. */
    reason: TurnEnd;
}
export interface TurnRequest {
    sessionKey: string;
    chatId: string;
    text: string;
    /** Message this turn answers; the reply quotes it. */
    replyToMessageId?: string;
    /**
     * Who sent the message this turn answers. The stop button and `/stop` are
     * restricted to them, so a group member cannot cancel someone else's answer.
     */
    senderOpenId?: string;
    /**
     * Channel facts for the system prompt. Absent means "unknown", which keeps the
     * prompt exactly as it was before the channel section existed.
     */
    chatType?: 'p2p' | 'group';
    /** Bot display name / open_id, when the host knows them. */
    botName?: string;
    botOpenId?: string;
    /**
     * Set by the bridge (not the caller) when THIS turn had to start a new
     * session because the old one went stale. Prepended to the prompt so the
     * model knows why it has no context, and used for the card's hint.
     */
    resetNotice?: string;
}
/**
 * Live token counters for one turn, read by the card's footer source.
 *
 * The session projection only folds a usage sample once the assistant message
 * is durable, so during streaming the newest `usage` chunk is the only real
 * number available — which is exactly what hermes shows in its live footer.
 */
export interface TurnUsage {
    /** Uncached prompt tokens of the newest request. */
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/**
 * Per-turn state the card reads back live.
 *
 * It exists because the card's header and footer are rendered from inside the
 * card (on create and on every flush), while the numbers they show are owned by
 * the turn. Handing each card its OWN state object is what keeps two chats
 * streaming at the same time from borrowing each other's tool steps — the old
 * module-level `rounds` / `currentCard` globals did exactly that.
 */
export interface TurnState {
    /** Live token counters for the footer. */
    usage: TurnUsage;
    /** Reasoning rounds completed in this turn. */
    rounds: number;
    /** Conversation this turn belongs to (the card's stop button reports it). */
    sessionKey: string;
    /**
     * The person whose message opened this turn.
     *
     * Only they may stop it (2026-11-10): in a group, one member cancelling
     * somebody else's long-running answer is a surprise, not a feature.
     */
    ownerOpenId?: string;
    /**
     * Whether this turn is answering a group or a direct chat.
     *
     * Carried into the card so the runtime can arm secret masking for groups
     * only: a group card is archived and read by people who never ran the tool.
     */
    chatType?: 'p2p' | 'group';
}
export interface BridgeOptions {
    store: SessionStore;
    /** Workspace for new sessions, read per session so a panel edit applies. */
    defaultWorkspace: () => string;
    /**
     * Model route for agents this bridge creates, read per session so a panel
     * edit (or a `/model` switch) applies to the next session without a restart.
     * Absent = follow the host default.
     */
    model?: () => {
        provider: string;
        model: string;
    } | undefined;
    /**
     * Build the streaming card for one turn, or undefined when the reply is plain
     * text. Called per turn (not per runtime) so a panel switch between
     * streaming/text takes effect on the next message instead of at restart.
     */
    createCard?: (chatId: string, agent: Agent, state: TurnState, replyToMessageId?: string) => StreamingCard | undefined;
    /**
     * Register a freshly created session in the workspace registry.
     *
     * `agents.create()` builds the session but leaves it unowned, so the GUI
     * lists it under an untitled group ("未命名") and cannot open its history.
     * The app's own creation path calls `workspace.attachSession()` right after
     * creating; we do the same.
     */
    attachWorkspace?: (sessionId: string, cwd: string) => Promise<void>;
    /**
     * Feishu ask-user registry. Bound per session so the tool installed in
     * `setup` can find the chat a question belongs to; without it an agent that
     * calls `ask_user_question` blocks on the desktop GUI's dialog, which the
     * Feishu user cannot see or answer.
     */
    ask?: {
        bind(sessionId: string, chatId: string): void;
        registerTool(agentCtx: Context): void;
    };
    /**
     * Feishu-side approval prompts.
     *
     * Same binding contract as `ask`, for the same reason: the `approval/request`
     * listener is installed in `setup` (before the first prompt assembly) but the
     * chat it belongs to only exists once the session does. Without it a turn
     * driven from Feishu stalls on the desktop GUI's permission dialog.
     */
    approvals?: {
        bind(sessionId: string, chatId: string): void;
        register(agentCtx: Context): void;
    };
    /** Hard cap on one turn; the agent is cancelled when it expires. */
    turnTimeoutMs?: number | (() => number);
    /**
     * When a conversation starts over (idle gap / daily hour). Read per turn, so
     * a panel edit applies to the next message instead of the next restart.
     */
    resetPolicy?: () => ResetPolicy;
    /** Clock override for tests (the reset clocks are time-based). */
    now?: () => number;
}
export declare class FeishuBridge {
    private readonly ctx;
    private readonly options;
    private live;
    private queues;
    /** Session keys with a turn in flight (for /stop). */
    private running;
    /**
     * Sessions whose persisted mapping is being dropped. `reset()` removes the
     * store entry asynchronously, so without this a message arriving in between
     * would resume the session we just abandoned.
     */
    private poisoned;
    /**
     * Per-conversation model overrides set by `/model`.
     *
     * They live here, not in the plugin config, because `/model` is a
     * conversation-level command: writing the host's global default would retune
     * every other chat (and the GUI) as a side effect. An override is dropped when
     * the agent for that conversation is rebuilt, so the next turn gets it.
     */
    private modelOverrides;
    /**
     * Per conversation: the route this plugin considers authoritative, and where
     * that decision came from. `agent` means somebody switched the model elsewhere
     * (the chat UI) and the panel default must not stomp it back.
     */
    private routed;
    /** Last observed agent routes, to notice a switch made outside this plugin. */
    private seenRoute;
    /** The panel's route as of the previous turn, to tell a panel edit from a chat switch. */
    private lastConfigRoute;
    /** Sessions whose live agent uses a stale model and must be rebuilt. */
    private staleModel;
    /** Sessions a user asked to stop; the footer must say 已停止, not 已完成. */
    private interrupted;
    /**
     * Who opened each running turn.
     *
     * The card's stop button and `/stop` are restricted to this person: in a group,
     * cancelling somebody else's answer is a surprise, not a feature. Keyed by
     * session (not stored per agent) because ownership lasts exactly one turn.
     */
    private turnOwners;
    /** Per-session turn settlers, so a stop can end the turn immediately. */
    private settlers;
    constructor(ctx: Context, options: BridgeOptions);
    /** Serialize turns per conversation so a chat never runs two agents at once. */
    private enqueue;
    handleMessage(request: TurnRequest): Promise<TurnResult>;
    /**
     * Who opened the turn running in this conversation right now.
     *
     * `undefined` when nothing is running — the caller then has nothing to
     * protect, and `/stop` may say "there is no task" instead of "not yours".
     */
    turnOwner(sessionKey: string): string | undefined;
    /**
     * Effective model selection for one conversation: `/model` override first,
     * then the panel's explicit route, then the host default.
     */
    private modelSelection;
    /**
     * Apply `/model <provider/model>` to one conversation.
     *
     * The live agent's model is fixed when it is created, so an idle session is
     * rebuilt immediately (its session log stays resumable) and a busy one is
     * flagged for rebuild the moment the turn settles.
     */
    setModel(sessionKey: string, selection: ModelSelection): Promise<void>;
    /** Current `/model` override, for /status and /model without arguments. */
    modelOverride(sessionKey: string): ModelSelection | undefined;
    /**
     * Make the live agent use the route this conversation should be on now.
     *
     * Why this exists (2026-11-16): `agentOptions` only seeds a NEW agent. A chat
     * that already has one keeps its creation-time model, so changing the panel
     * default did nothing for it — and because `/new` was the only way users knew
     * to start over, that did not help either once an agent was live. A full dsh
     * restart was the only cure, which is exactly the report.
     *
     * Three rules, checked once per turn:
     *   1. a panel edit (the config route moved) wins — pin it, or rebuild the
     *      agent when the core has no live `agent.model` handle;
     *   2. a `/model` override wins over the panel;
     *   3. a model switched from the chat UI wins over the panel for that
     *      conversation until either of the first two changes again.
     */
    private enforceRoute;
    /** The panel's own route, as one comparable string ('' when it defers to the host). */
    private configRouteKey;
    /** Refresh the session's "last message" stamp (drives the idle reset clock). */
    private touchSession;
    /**
     * Drop a conversation's session when the reset policy says it is stale.
     *
     * Called at the head of every turn. A live agent holds the context in memory,
     * so the live one is disposed too — otherwise "new session" would still answer
     * with yesterday's thread.
     *
     * @returns the reason the conversation was reset, or undefined when kept
     */
    private rollSession;
    /** The turn cap in effect right now (a getter, so a panel edit applies at once). */
    private turnTimeout;
    /** Forget a conversation's live agent (the next message rebuilds it). */
    private dropLive;
    /** What /status reports for one conversation. */
    describe(sessionKey: string): {
        sessionId?: string;
        model?: string;
        running: boolean;
    };
    /** Forget the persisted session so the next message starts a fresh one. */
    reset(sessionKey: string): Promise<boolean>;
    /** Resume the persisted session, or create a fresh one. */
    private ensureAgent;
    private createAgent;
    /** Submit one user message and resolve with the assistant's final text. */
    private runTurn;
    /**
     * Cancel and drop one conversation's agent (its session stays resumable).
     *
     * @param options.settleTurn - end the in-flight turn right away with 已停止.
     *   `false` when the caller is itself deciding how the turn ended.
     */
    stop(sessionKey: string, options?: {
        settleTurn?: boolean;
    }): Promise<boolean>;
    dispose(): Promise<void>;
}
