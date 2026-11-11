/**
 * Bridge-side slash commands.
 *
 * These are answered by the bridge itself and never reach the agent, so a
 * `/status` in a busy group costs nothing. Unknown `/xxx` commands fall
 * through to DSH, which owns its own command runtime (`/compact`, `/goal`, …).
 */
import { formatIdList } from '../shared/types.js'

export const BRIDGE_COMMANDS = ['status', 'new', 'stop', 'help', 'model', 'approvals'] as const
export type BridgeCommand = (typeof BRIDGE_COMMANDS)[number]

export interface ParsedInput {
  /** A bridge command, when the text is one. */
  command?: BridgeCommand
  /** Remaining words after the command name. */
  args: string[]
  /** The text to send to the agent (unchanged when it is not a command). */
  text: string
}

const COMMAND_SET = new Set<string>(BRIDGE_COMMANDS)

/** Split `/status now` into a command; anything else is agent input. */
export function parseInput(text: string): ParsedInput {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return { args: [], text: trimmed }
  const [name, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean)
  if (name && COMMAND_SET.has(name)) {
    return { command: name as BridgeCommand, args, text: '' }
  }
  return { args: [], text: trimmed }
}

export interface StatusInput {
  connected: boolean
  sessionKey: string
  sessionId?: string
  model?: string
  dmPolicy: string
  allowlist: readonly string[]
  groupPolicy: string
  groupAllowlist: readonly string[]
  requireMentionInGroups: boolean
  replyMode: string
  sessions: number
}

export function formatStatus(input: StatusInput): string {
  const lines = [
    `连接：${input.connected ? '已连接' : '未连接'}`,
    `会话：${input.sessionKey}`,
    `session：${input.sessionId ?? '（尚未创建，下一条消息新建）'}`,
    `模型：${input.model ?? '跟随默认模型'}`,
    `私聊：${input.dmPolicy}（${input.allowlist.length} 个 open_id）`,
    `群聊：${input.groupPolicy}（${input.groupAllowlist.length} 个群）`,
    `群需 @：${input.requireMentionInGroups ? '是' : '否'}`,
    `回复模式：${input.replyMode}`,
    `本机会话数：${input.sessions}`,
  ]
  return lines.join('\n')
}

export function formatHelp(): string {
  return [
    '可用命令：',
    '/status — 查看连接、会话、模型与白名单状态',
    '/model — 查看当前模型；/model <provider/model> 切换本会话所用模型',
    '/new — 结束当前会话，下一条消息开新会话',
    '/stop — 停止当前正在跑的任务',
    '/approvals — 查看「本群总是允许」记住的工具；/approvals clear 全部撤销',
    '/help — 显示本帮助',
    '',
    '其它 / 开头的内容会交给 Harness 自己处理（如 /compact、/goal）。',
  ].join('\n')
}

/** One provider/model pair the bridge can route to. */
export interface ModelChoice {
  provider: string
  model: string
}

/**
 * Render `/model` (no argument = current) or apply `/model <provider/model>`.
 *
 * `apply` is the caller's job (it owns the config write), so this stays pure
 * and testable; it only formats what the user sees.
 */
export function formatModel(current: ModelChoice | undefined, requested?: string): string {
  if (!requested) {
    return current
      ? `当前模型：${current.provider}/${current.model}`
      : '当前模型：跟随默认模型。用 /model <provider/model> 指定，例如 /model magpie/auto-step-5-preview'
    }
  const slash = requested.indexOf('/')
  if (slash <= 0 || slash === requested.length - 1) {
    return `无法解析「${requested}」。格式：/model <provider/model>，例如 /model magpie/auto-step-5-preview`
  }
  const provider = requested.slice(0, slash)
  const model = requested.slice(slash + 1)
  return `已将模型切换为 ${provider}/${model}，下一条消息生效。`
}

/** Confirmation text for /new and /stop. */
export function formatReset(done: boolean): string {
  return done ? '已结束当前会话，下一条消息将开新会话。' : '当前没有活动会话。'
}

export function formatStop(done: boolean): string {
  return done ? '已停止当前任务。' : '当前没有正在跑的任务。'
}

/** Renders an allowlist for diagnostics. */
export function formatAllowlist(ids: readonly string[]): string {
  return ids.length ? formatIdList(ids) : '（空）'
}

/**
 * Render `/approvals`, the human-visible half of "always allow".
 *
 * The seam has no grant store and no revocation call, so the list a person can
 * actually see and clear is the only thing standing between a hurried click and
 * a standing permission nobody remembers granting.
 */
export function formatApprovals(
  grants: readonly { chatId: string; tool: string; expiresAt: number }[],
  now: number,
  chatId?: string,
): string {
  const scoped = chatId ? grants.filter((grant) => grant.chatId === chatId) : grants
  if (scoped.length === 0) {
    return '当前没有被记住的授权。审批卡片会照常询问。'
  }
  const hours = (expiresAt: number): string =>
    `${Math.max(1, Math.round((expiresAt - now) / 3_600_000))} 小时后过期`
  return [
    `已记住 ${scoped.length} 条「不再询问」授权：`,
    ...scoped.map((grant) => `· ${grant.tool}（${hours(grant.expiresAt)}）`),
    '',
    '用 /approvals clear 全部撤销。',
  ].join('\n')
}

/** Confirmation for `/approvals clear`. */
export function formatApprovalsCleared(count: number): string {
  return count > 0
    ? `已撤销 ${count} 条「不再询问」授权，之后会重新询问。`
    : '本来就没有被记住的授权。'
}
