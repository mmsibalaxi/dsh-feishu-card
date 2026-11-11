export declare const BRIDGE_COMMANDS: readonly ["status", "new", "stop", "help", "model", "approvals"];
export type BridgeCommand = (typeof BRIDGE_COMMANDS)[number];
export interface ParsedInput {
    /** A bridge command, when the text is one. */
    command?: BridgeCommand;
    /** Remaining words after the command name. */
    args: string[];
    /** The text to send to the agent (unchanged when it is not a command). */
    text: string;
}
/** Split `/status now` into a command; anything else is agent input. */
export declare function parseInput(text: string): ParsedInput;
export interface StatusInput {
    connected: boolean;
    sessionKey: string;
    sessionId?: string;
    model?: string;
    dmPolicy: string;
    allowlist: readonly string[];
    groupPolicy: string;
    groupAllowlist: readonly string[];
    requireMentionInGroups: boolean;
    replyMode: string;
    sessions: number;
}
export declare function formatStatus(input: StatusInput): string;
export declare function formatHelp(): string;
/** One provider/model pair the bridge can route to. */
export interface ModelChoice {
    provider: string;
    model: string;
}
/**
 * Render `/model` (no argument = current) or apply `/model <provider/model>`.
 *
 * `apply` is the caller's job (it owns the config write), so this stays pure
 * and testable; it only formats what the user sees.
 */
export declare function formatModel(current: ModelChoice | undefined, requested?: string): string;
/** Confirmation text for /new and /stop. */
export declare function formatReset(done: boolean): string;
export declare function formatStop(done: boolean): string;
/** Renders an allowlist for diagnostics. */
export declare function formatAllowlist(ids: readonly string[]): string;
/**
 * Render `/approvals`, the human-visible half of "always allow".
 *
 * The seam has no grant store and no revocation call, so the list a person can
 * actually see and clear is the only thing standing between a hurried click and
 * a standing permission nobody remembers granting.
 */
export declare function formatApprovals(grants: readonly {
    chatId: string;
    tool: string;
    expiresAt: number;
}[], now: number, chatId?: string): string;
/** Confirmation for `/approvals clear`. */
export declare function formatApprovalsCleared(count: number): string;
