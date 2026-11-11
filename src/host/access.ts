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
import type { DmPolicy, FeishuCardConfig, GroupPolicy } from '../shared/types.ts'

export type ChatType = 'p2p' | 'group'

export interface AccessRequest {
  chatType: ChatType
  /** `oc_` chat id, or the p2p chat id for DMs. */
  chatId: string
  /** `ou_` open id of the sender. */
  senderOpenId: string
  /** Whether the message mentions the bot (after stripping mention syntax). */
  mentioned: boolean
  /** True when the message only contains an @all mention. */
  mentionAllOnly: boolean
  /** True when the sender is another app/bot (Feishu `sender_type`). */
  fromBot?: boolean
}

export type DenyReason =
  | 'mention-required'
  | 'bot-sender'
  | 'group-disabled'
  | 'group-not-allowed'
  | 'dm-disabled'
  | 'dm-not-allowed'
  | 'sender-not-allowed'

export type AccessDecision = { allowed: true } | { allowed: false; reason: DenyReason }

interface GateConfig {
  dmPolicy: DmPolicy
  allowlist: readonly string[]
  groupPolicy: GroupPolicy
  groupAllowlist: readonly string[]
  /**
   * Optional per-person gate inside allowed groups. Empty = no gate.
   *
   * This is deliberately separate from `allowlist`: one list that meant "who may
   * DM me" AND "who may speak in my groups" silently muted every colleague in
   * an allowed group the moment the owner added themselves for DMs.
   */
  groupSenderAllowlist?: readonly string[]
  requireMentionInGroups: boolean
  respondToMentionAll: boolean
  /** Bot-sent traffic policy; `none` (the hermes default) drops all of it. */
  allowBots?: 'none' | 'mentions' | 'all'
}

const has = (list: readonly string[], id: string) =>
  list.some((entry) => entry.trim() === id)

/** Mention requirement is the cheapest gate, so it runs first. */
function checkMention(request: AccessRequest, config: GateConfig): DenyReason | null {
  if (request.chatType !== 'group') return null
  if (!config.requireMentionInGroups) return null
  if (request.mentioned) return null
  if (request.mentionAllOnly && config.respondToMentionAll) return null
  return 'mention-required'
}

/** Which chats may talk to the bot at all. */
function checkChat(request: AccessRequest, config: GateConfig): DenyReason | null {
  if (request.chatType === 'group') {
    if (config.groupPolicy === 'disabled') return 'group-disabled'
    if (config.groupPolicy === 'allowlist' && !has(config.groupAllowlist, request.chatId)) {
      return 'group-not-allowed'
    }
    return null
  }
  if (config.dmPolicy === 'disabled') return 'dm-disabled'
  if (config.dmPolicy === 'allowlist' && !has(config.allowlist, request.senderOpenId)) {
    return 'dm-not-allowed'
  }
  // `pairing` needs the pairing-code flow (not implemented yet); until then it
  // behaves like allowlist so nobody sneaks in through an unwired policy.
  if (config.dmPolicy === 'pairing') return 'dm-not-allowed'
  return null
}

/**
 * Which people may talk to the bot, inside a chat that already passed the chat
 * gate. Each chat type has its own list on purpose (see GateConfig).
 */
function checkSender(request: AccessRequest, config: GateConfig): DenyReason | null {
  if (request.chatType === 'group') {
    const groupList = config.groupSenderAllowlist ?? []
    // Empty group-sender list = the group allowlist is the only gate, which is
    // what "允许的群" is supposed to mean.
    if (groupList.length === 0) return null
    return has(groupList, request.senderOpenId) ? null : 'sender-not-allowed'
  }
  // DM: `checkChat` already enforced the DM allowlist; a non-empty list here is
  // the same list, so nothing further to check.
  return null
}

/**
 * Bot traffic gate. Feishu does not echo our own outbound back as inbound, so
 * this is not about self-loops — it stops *other* apps' messages from driving
 * the agent (and covers a self-echo if one ever appears). The hermes default is
 * `none`: only `mentions` or `all` opt in.
 */
function checkBot(request: AccessRequest, config: GateConfig): DenyReason | null {
  if (!request.fromBot) return null
  const mode = config.allowBots ?? 'none'
  if (mode === 'all') return null
  if (mode === 'mentions' && request.mentioned) return null
  return 'bot-sender'
}

export function decideAccess(
  request: AccessRequest,
  config: GateConfig | FeishuCardConfig,
): AccessDecision {
  const reason =
    checkMention(request, config) ??
    checkBot(request, config) ??
    checkChat(request, config) ??
    checkSender(request, config)
  return reason ? { allowed: false, reason } : { allowed: true }
}

/** Human-readable reason, for logs and `/status` diagnostics. */
export function describeDeny(reason: DenyReason): string {
  switch (reason) {
    case 'mention-required':
      return '群里需要 @机器人 才响应'
    case 'group-disabled':
      return '群聊已被禁用（groupPolicy=disabled）'
    case 'group-not-allowed':
      return '该群不在群白名单内'
    case 'dm-disabled':
      return '私聊已被禁用（dmPolicy=disabled）'
    case 'dm-not-allowed':
      return '该用户不在私聊白名单内'
    case 'sender-not-allowed':
      return '该用户不在 open_id 白名单内'
    case 'bot-sender':
      return '机器人/应用发送的消息（allowBots=none）'
  }
}
