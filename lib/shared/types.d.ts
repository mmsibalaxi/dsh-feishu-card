/**
 * Shared configuration contract between the host half and the browser half.
 *
 * The single source of truth is the plugin's cordis Config schema
 * (src/host/config.ts). The desktop plugin manager's settings service projects
 * the `.volatile()` fields of that schema into a form, and the browser card in
 * src/client drives `ctx.configForms.get('feishu-card')` to read/write it.
 *
 * Keep this file free of node/browser-only imports.
 */
export declare const PLUGIN_ID = "feishu-card";
export type Brand = 'feishu' | 'lark';
export type DmPolicy = 'open' | 'pairing' | 'allowlist' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'disabled';
export type SessionScope = 'chat' | 'thread' | 'sender';
export type ReplyMode = 'streaming' | 'text';
/** Which bot/app-sent messages may drive the agent. */
export type BotPolicy = 'none' | 'mentions' | 'all';
/** Footer fields we know how to render. Order in the array is display order. */
export declare const FOOTER_FIELDS: readonly ["status", "model", "context", "elapsed", "tokens"];
export type FooterField = (typeof FOOTER_FIELDS)[number];
export declare const DEFAULT_FOOTER_FIELDS: FooterField[];
export interface FeishuCardConfig {
    appId: string;
    /** Secret. Marked `.role('secret')` so it is redacted on the wire. */
    appSecret: string;
    brand: Brand;
    dmPolicy: DmPolicy;
    /** open_id allowlist for DMs. Empty = nobody (fail-closed) unless policy is open. */
    allowlist: string[];
    groupPolicy: GroupPolicy;
    /** `oc_` chat_id allowlist. Empty = no group. */
    groupAllowlist: string[];
    /**
     * Optional per-person gate INSIDE the allowed groups (open_id list).
     * Empty = everyone in an allowed group may talk to the bot.
     */
    groupSenderAllowlist: string[];
    requireMentionInGroups: boolean;
    respondToMentionAll: boolean;
    sessionScope: SessionScope;
    replyMode: ReplyMode;
    footerFields: FooterField[];
    flushIntervalMs: number;
    /** Model id for agents this bridge creates. Empty = follow the host default. */
    model: string;
    /** Provider route for the model above. Empty = follow the host default. */
    provider: string;
    /** Which bot-sent messages may drive the agent (hermes default: none). */
    allowBots: BotPolicy;
    /** Model id → context window size in tokens. Overrides the built-in table. */
    contextWindows: Record<string, number>;
    defaultWorkspace: string;
    dedupTtlMs: number;
    /** Hard cap on one agent turn; the agent is cancelled when it expires. */
    turnTimeoutMs: number;
    /** Render the model's reasoning stream in the card's process panel. */
    showReasoning: boolean;
    /** Keep the process panel expanded after the turn seals. */
    panelExpanded: boolean;
}
export declare const CONFIG_DEFAULTS: Omit<FeishuCardConfig, 'appId' | 'appSecret'>;
/**
 * Parse a panel textarea (one id per line) into a clean id list.
 * Accepts `ou_xxx`, `oc_xxx`, `cli_xxx`, comments (`#`) and stray whitespace.
 */
export declare function parseIdList(text: string | undefined): string[];
/** Render an id list back into the textarea form. */
export declare function formatIdList(ids: readonly string[] | undefined): string;
