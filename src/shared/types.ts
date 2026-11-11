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

export const PLUGIN_ID = 'feishu-card'

export type Brand = 'feishu' | 'lark'
export type DmPolicy = 'open' | 'pairing' | 'allowlist' | 'disabled'
export type GroupPolicy = 'open' | 'allowlist' | 'disabled'
export type SessionScope = 'chat' | 'thread' | 'sender'
export type ReplyMode = 'streaming' | 'text'
/** Which bot/app-sent messages may drive the agent. */
export type BotPolicy = 'none' | 'mentions' | 'all'

/** Footer fields we know how to render. Order in the array is display order. */
export const FOOTER_FIELDS = ['status', 'model', 'context', 'elapsed', 'tokens'] as const
export type FooterField = (typeof FOOTER_FIELDS)[number]

export const DEFAULT_FOOTER_FIELDS: FooterField[] = ['status', 'model', 'context', 'elapsed']

export interface FeishuCardConfig {
  appId: string
  /** Secret. Marked `.role('secret')` so it is redacted on the wire. */
  appSecret: string
  brand: Brand
  dmPolicy: DmPolicy
  /** open_id allowlist for DMs. Empty = nobody (fail-closed) unless policy is open. */
  allowlist: string[]
  groupPolicy: GroupPolicy
  /** `oc_` chat_id allowlist. Empty = no group. */
  groupAllowlist: string[]
  /**
   * Optional per-person gate INSIDE the allowed groups (open_id list).
   * Empty = everyone in an allowed group may talk to the bot.
   */
  groupSenderAllowlist: string[]
  requireMentionInGroups: boolean
  respondToMentionAll: boolean
  sessionScope: SessionScope
  replyMode: ReplyMode
  footerFields: FooterField[]
  flushIntervalMs: number
  /** Model id for agents this bridge creates. Empty = follow the host default. */
  model: string
  /** Provider route for the model above. Empty = follow the host default. */
  provider: string
  /** Which bot-sent messages may drive the agent (hermes default: none). */
  allowBots: BotPolicy
  /** Model id → context window size in tokens. Overrides the built-in table. */
  contextWindows: Record<string, number>
  defaultWorkspace: string
  dedupTtlMs: number
  /** Hard cap on one agent turn; the agent is cancelled when it expires. */
  turnTimeoutMs: number
  /** Render the model's reasoning stream in the card's process panel. */
  showReasoning: boolean
  /** Show the collapsible process panel (tools/rounds/elapsed) on the card. */
  showPanel: boolean
  /** Keep the process panel expanded after the turn seals. */
  panelExpanded: boolean
}

export const CONFIG_DEFAULTS: Omit<FeishuCardConfig, 'appId' | 'appSecret'> = {
  brand: 'feishu',
  dmPolicy: 'allowlist',
  allowlist: [],
  groupPolicy: 'allowlist',
  groupAllowlist: [],
  groupSenderAllowlist: [],
  requireMentionInGroups: true,
  respondToMentionAll: false,
  sessionScope: 'chat',
  replyMode: 'streaming',
  footerFields: DEFAULT_FOOTER_FIELDS,
  // 100ms = the cadence the user's Hermes bridge flushes at. The old 200ms read
  // as "一行一行" because Feishu's own typewriter (15ms/char) then printed a
  // whole burst at once.
  flushIntervalMs: 100,
  model: '',
  provider: '',
  allowBots: 'none',
  contextWindows: {},
  defaultWorkspace: '',
  dedupTtlMs: 12 * 60 * 60 * 1000,
  turnTimeoutMs: 10 * 60 * 1000,
  showReasoning: false,
  // On by default: the panel is how a user sees a long turn is progressing.
  // Turn it off for a clean card whose only visible state is the answer.
  showPanel: true,
  panelExpanded: false,
}

/**
 * Parse a panel textarea (one id per line) into a clean id list.
 * Accepts `ou_xxx`, `oc_xxx`, `cli_xxx`, comments (`#`) and stray whitespace.
 */
export function parseIdList(text: string | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // Tolerate pasted "@name (ou_xxx)" or comma separated values.
    for (const token of line.split(/[,，;；\s]+/)) {
      const id = token.replace(/^[@<]/, '').replace(/[>)]$/, '').trim()
      if (id && !id.startsWith('#')) out.push(id)
    }
  }
  return [...new Set(out)]
}

/** Render an id list back into the textarea form. */
export function formatIdList(ids: readonly string[] | undefined): string {
  return (ids ?? []).join('\n')
}
