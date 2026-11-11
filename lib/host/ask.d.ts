import type { Context } from '@deepseek-ai/cordis';
/** One question as the model states it. */
export interface AskQuestion {
    id: string;
    question: string;
    header?: string;
    options?: {
        label: string;
        description?: string;
    }[];
    multi_select?: boolean;
}
/** One answer, in the shape the host tool reports. */
export interface AskAnswer {
    id: string;
    selected: string[];
    custom?: string;
}
/** The narrow Feishu surface the asker needs (faked in tests). */
export interface AskTransport {
    /** Send a card into a chat; resolves to the id later updates use. */
    sendCard(chatId: string, card: unknown): Promise<string | undefined>;
    /** Replace a previously sent card's content. */
    updateCard(cardId: string, card: unknown): Promise<void>;
}
export interface FeishuAskUserOptions {
    transport: AskTransport;
    /** Auto-cancel a question nobody answered (default 5 minutes). */
    timeoutMs?: number;
    log?: (message: string) => void;
}
export declare class FeishuAskUser {
    private readonly options;
    private readonly pendings;
    private readonly timeoutMs;
    private disposed;
    constructor(options: FeishuAskUserOptions);
    /** Number of questions waiting for an answer (diagnostics). */
    get pendingCount(): number;
    /** Remember which chat owns a session, so a tool call can find its way home. */
    bind(sessionId: string, chatId: string): void;
    private readonly chats;
    /**
     * Register the Feishu asker in one agent's scope.
     *
     * Called from the bridge's `setup`, i.e. before the first prompt assembly, so
     * the tool exists for the whole agent lifetime.
     */
    registerTool(agentCtx: Context): void;
    /** Ask one batch of questions and wait for the user's answer. */
    private ask;
    /**
     * Answers in question order, with unanswered questions reported as empty.
     *
     * An empty `selected` is an honest "nobody answered this one"; inventing a
     * value (the old behaviour) is worse than saying nothing.
     */
    private collected;
    private unansweredQuestions;
    /**
     * Route a card button click to its pending question.
     *
     * Returns the callback response (toast + the refreshed card, so Feishu
     * re-renders immediately) or undefined when the click was not ours.
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
    /**
     * Answer a pending question with the user's next chat message.
     *
     * The message answers the FIRST question still waiting — not every question,
     * and not "the only one", so a multi-question ask can be finished by typing
     * two replies in a row.
     *
     * There is deliberately no "free-form mode" to enter first: while a question
     * is open, whatever the user types IS the answer. Gating this behind a button
     * (as an earlier revision did) sent the reply to the agent as a brand-new
     * turn, so the question was never answered and the card hung on its loading
     * state forever.
     *
     * @returns true when the message was consumed as an answer.
     */
    handleChatMessage(sessionId: string, text: string): boolean;
    /**
     * Replace a pending ask's card with its current state.
     *
     * Takes the ask object rather than an id: by the time a question is answered
     * it may already have left the map, and looking it up again would silently
     * skip the refresh (leaving a stale, still-clickable card behind).
     */
    private settle;
    /** Cancel every pending question (plugin shutdown). */
    dispose(): void;
}
/**
 * Build the question card (Card 2.0).
 *
 * Every question in the batch gets its own block, and only the unanswered ones
 * carry buttons — a card that keeps offering a choice the user already made is
 * how a stale card ends up being clicked twice.
 */
export declare function buildAskCard(pending: {
    id: string;
    questions: AskQuestion[];
    /** Collected answers; absent renders a pristine card. */
    answers?: Map<string, AskAnswer & {
        done: boolean;
    }>;
}, options?: {
    note?: string;
    settled?: boolean;
}): unknown;
/** Coerce whatever the model sent into our question shape. */
export declare function normalizeQuestions(input: unknown): AskQuestion[];
