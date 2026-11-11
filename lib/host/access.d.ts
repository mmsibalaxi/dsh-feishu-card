/**
 * Access control — the two gates.
 *
 * Semantics mirror the user's Hermes setup (see
 * references/hermes-footer-spec.md and the hermes dm-vs-group-allowlist note):
 * a chat-level gate (which group / DM) and a sender-level gate (which person),
 * evaluated in that order, both of which must pass.
 *
 * Fail-closed by default: `allowlist` policies with an empty list admit nobody,
 * and an unlisted group is silently ignored (no reply, no error message back).
 */
import type { DmPolicy, FeishuCardConfig, GroupPolicy } from '../shared/types.ts';
export type ChatType = 'p2p' | 'group';
export interface AccessRequest {
    chatType: ChatType;
    /** `oc_` chat id, or the p2p chat id for DMs. */
    chatId: string;
    /** `ou_` open id of the sender. */
    senderOpenId: string;
    /** Whether the message mentions the bot (after stripping mention syntax). */
    mentioned: boolean;
    /** True when the message only contains an @all mention. */
    mentionAllOnly: boolean;
    /** True when the sender is another app/bot (Feishu `sender_type`). */
    fromBot?: boolean;
}
export type DenyReason = 'mention-required' | 'bot-sender' | 'group-disabled' | 'group-not-allowed' | 'dm-disabled' | 'dm-not-allowed' | 'sender-not-allowed';
export type AccessDecision = {
    allowed: true;
} | {
    allowed: false;
    reason: DenyReason;
};
interface GateConfig {
    dmPolicy: DmPolicy;
    allowlist: readonly string[];
    groupPolicy: GroupPolicy;
    groupAllowlist: readonly string[];
    /**
     * Optional per-person gate inside allowed groups. Empty = no gate.
     *
     * This is deliberately separate from `allowlist`: one list that meant "who may
     * DM me" AND "who may speak in my groups" silently muted every colleague in
     * an allowed group the moment the owner added themselves for DMs.
     */
    groupSenderAllowlist?: readonly string[];
    requireMentionInGroups: boolean;
    respondToMentionAll: boolean;
    /** Bot-sent traffic policy; `none` (the hermes default) drops all of it. */
    allowBots?: 'none' | 'mentions' | 'all';
}
export declare function decideAccess(request: AccessRequest, config: GateConfig | FeishuCardConfig): AccessDecision;
/** Human-readable reason, for logs and `/status` diagnostics. */
export declare function describeDeny(reason: DenyReason): string;
export {};
