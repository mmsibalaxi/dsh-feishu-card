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
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { redact } from './redact.ts'
import { trace } from './trace.ts'

/** Marker key inside a button's callback value, so we ignore foreign actions. */
const APPROVAL_KEY = 'feishuCardApproval'

/** How long a prompt waits before failing closed (the turn still has its own cap). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** How long "always allow this tool here" survives. */
const DEFAULT_GRANT_TTL_MS = 24 * 60 * 60 * 1000

/** The narrow Feishu surface the asker needs (faked in tests). */
export interface ApprovalTransport {
  sendCard(chatId: string, card: unknown): Promise<string | undefined>
  updateCard(cardId: string, card: unknown): Promise<void>
}

/** What a person chose in the card. */
export type ApprovalChoice = 'once' | 'always' | 'deny'

/**
 * "Always allow" memory.
 *
 * Persisted because the annoyance it removes (the same tool asking every turn)
 * spans restarts, and TTL'd because a grant made in a hurry should not silently
 * outlive the task that justified it. Every auto-grant is traced.
 */
export class ApprovalMemory {
  private grants = new Map<string, number>()
  private loaded = false

  constructor(
    private readonly options: {
      file?: string
      ttlMs?: number
      now?: () => number
      log?: (message: string) => void
    } = {},
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)()
  }

  private get ttl(): number {
    return this.options.ttlMs ?? DEFAULT_GRANT_TTL_MS
  }

  /** `chatId \u0000 toolName` — one flat key keeps the file trivially readable. */
  private static key(chatId: string, tool: string): string {
    return `${chatId}\u0000${tool}`
  }

  /** Read the file once; a missing or corrupt file means "no grants". */
  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const file = this.options.file
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        grants?: { chatId?: unknown; tool?: unknown; expiresAt?: unknown }[]
      }
      for (const grant of raw.grants ?? []) {
        if (typeof grant.chatId !== 'string' || typeof grant.tool !== 'string') continue
        if (typeof grant.expiresAt !== 'number') continue
        this.grants.set(ApprovalMemory.key(grant.chatId, grant.tool), grant.expiresAt)
      }
    } catch {
      // Absent on first run, unreadable after a bad shutdown: both mean empty.
    }
    this.prune()
  }

  private prune(): void {
    const now = this.now
    for (const [key, expiresAt] of [...this.grants]) {
      if (expiresAt <= now) this.grants.delete(key)
    }
  }

  /** Does this chat already trust this tool? Expired grants are dropped here. */
  allowed(chatId: string, tool: string): boolean {
    this.ensureLoaded()
    const key = ApprovalMemory.key(chatId, tool)
    const expiresAt = this.grants.get(key)
    if (expiresAt === undefined) return false
    if (expiresAt <= this.now) {
      this.grants.delete(key)
      return false
    }
    return true
  }

  /** Grant one (chat, tool) pair for a TTL and persist it. */
  remember(chatId: string, tool: string): void {
    this.ensureLoaded()
    this.grants.set(ApprovalMemory.key(chatId, tool), this.now + this.ttl)
    this.save()
  }

  /** Every live grant, newest expiry last (panel/status display). */
  list(): { chatId: string; tool: string; expiresAt: number }[] {
    this.ensureLoaded()
    this.prune()
    return [...this.grants]
      .map(([key, expiresAt]) => {
        const [chatId = '', tool = ''] = key.split('\u0000')
        return { chatId, tool, expiresAt }
      })
      .sort((a, b) => a.expiresAt - b.expiresAt)
  }

  /** Drop every grant; returns how many were live. */
  forgetAll(): number {
    this.ensureLoaded()
    const count = this.grants.size
    this.grants.clear()
    this.save()
    return count
  }

  private save(): void {
    const file = this.options.file
    if (!file) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      // Write-then-rename: a crash mid-write must not leave a half file that
      // the next boot reads as "no grants" (a silent permission reset).
      const tmp = `${file}.tmp`
      writeFileSync(
        tmp,
        JSON.stringify({ version: 1, grants: this.list() }, null, 2),
        'utf8',
      )
      renameSync(tmp, file)
    } catch (error) {
      this.options.log?.(`approval memory save failed: ${String(error).slice(0, 160)}`)
    }
  }
}

interface PendingApproval {
  id: string
  chatId: string
  toolName: string
  reason?: string
  cardId?: string
  resolve: (choice: ApprovalChoice | undefined) => void
  timer: ReturnType<typeof setTimeout>
}

export interface FeishuApprovalsOptions {
  transport: ApprovalTransport
  timeoutMs?: number
  memory?: ApprovalMemory
  log?: (message: string) => void
}

export class FeishuApprovals {
  private readonly chats = new Map<string, string>()
  private readonly pendings = new Map<string, PendingApproval>()
  private readonly timeoutMs: number
  readonly memory: ApprovalMemory
  private disposed = false

  constructor(private readonly options: FeishuApprovalsOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.memory = options.memory ?? new ApprovalMemory({ log: options.log })
  }

  /** Questions waiting for a click (diagnostics). */
  get pendingCount(): number {
    return this.pendings.size
  }

  /** Remember which chat owns a session, so a request can find its way home. */
  bind(sessionId: string, chatId: string): void {
    this.chats.set(sessionId, chatId)
  }

  /**
   * Answer this agent's approval requests through Feishu.
   *
   * Registered in the agent's own scope (so it only ever sees that agent's
   * requests) and prepended (so it runs before the app's GUI answerer).
   */
  register(agentCtx: Context): void {
    try {
      agentCtx.on(
        'approval/request',
        (req, next) => this.handleRequest(req, next),
        { prepend: true },
      )
    } catch (error) {
      // An old host without the approval seam: the GUI keeps its behaviour.
      this.options.log?.(`approval listener not installed: ${String(error).slice(0, 160)}`)
    }
  }

  /**
   * Decide one request: answer it here, or hand it to the next answerer.
   *
   * Public so the waterfall handler and the tests use the exact same path — a
   * private method reached only through a cordis event would be untestable
   * without a live host.
   */
  async handleRequest(
    req: { agent?: unknown; toolName?: unknown; reason?: unknown; signal?: AbortSignal },
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const sessionId = readSessionId(req.agent)
    const chatId = sessionId ? this.chats.get(sessionId) : undefined
    const toolName = typeof req.toolName === 'string' ? req.toolName : ''
    if (!chatId || !toolName) return next()

    if (this.memory.allowed(chatId, toolName)) {
      trace('approval-auto-allowed', { chatId, tool: toolName })
      return 'allowed-once'
    }

    const asked = await this.prompt(chatId, toolName, req)
    // Could not ask at all — let the next answerer (the GUI) try.
    if (asked === undefined) return next()
    return asked
  }

  /**
   * Post the prompt and wait for a click.
   *
   * @returns the outcome, or `undefined` when the card could not be sent (the
   *   caller delegates) — a timeout is `cancelled`, which is an honest answer.
   */
  private async prompt(
    chatId: string,
    toolName: string,
    req: { reason?: unknown; signal?: AbortSignal },
  ): Promise<ApprovalOutcome | undefined> {
    const id = `apr_${Math.random().toString(36).slice(2, 10)}`
    const reason = typeof req.reason === 'string' && req.reason ? req.reason : undefined
    let resolveChoice: (choice: ApprovalChoice | undefined) => void = () => undefined
    const answered = new Promise<ApprovalChoice | undefined>((resolve) => {
      resolveChoice = resolve
    })
    const pending: PendingApproval = {
      id,
      chatId,
      toolName,
      ...(reason ? { reason } : {}),
      resolve: resolveChoice,
      timer: setTimeout(() => {
        this.pendings.delete(id)
        trace('approval-timeout', { id, chatId, tool: toolName })
        void this.settle(pending, '⏰ 无人确认，已按拒绝处理。')
        pending.resolve(undefined)
      }, this.timeoutMs),
    }
    pending.timer.unref?.()
    this.pendings.set(id, pending)

    // The asking consumer can withdraw the question; a late click is discarded.
    req.signal?.addEventListener(
      'abort',
      () => {
        if (!this.pendings.has(id)) return
        this.pendings.delete(id)
        clearTimeout(pending.timer)
        trace('approval-withdrawn', { id, chatId })
        void this.settle(pending, '提问已撤回。')
        pending.resolve(undefined)
      },
      { once: true },
    )

    try {
      pending.cardId = await this.options.transport.sendCard(chatId, buildApprovalCard(pending))
    } catch (error) {
      this.pendings.delete(id)
      clearTimeout(pending.timer)
      trace('approval-send-failed', { id, chatId, error: String(error).slice(0, 160) })
      return undefined
    }
    trace('approval-asked', { id, chatId, tool: toolName, cardId: pending.cardId ?? null })

    const choice = await answered
    if (choice === undefined) return 'cancelled'
    if (choice === 'deny') return 'rejected'
    if (choice === 'always') {
      this.memory.remember(chatId, toolName)
      trace('approval-granted-always', { chatId, tool: toolName })
    }
    return 'allowed-once'
  }

  /**
   * Route a card button click to its pending request.
   *
   * @returns the callback response (toast + refreshed card) or undefined when the
   *   click was not ours.
   */
  async handleCardAction(
    data: unknown,
  ): Promise<
    | { toast?: { type: string; content: string }; card?: { type: string; data: unknown } }
    | undefined
  > {
    const value = readActionValue(data)
    if (!value || value[APPROVAL_KEY] !== 'decide') return undefined
    const id = typeof value.approvalId === 'string' ? value.approvalId : undefined
    const action = value.action
    if (!id || (action !== 'once' && action !== 'always' && action !== 'deny')) return undefined
    const pending = this.pendings.get(id)
    if (!pending) return undefined

    this.pendings.delete(id)
    clearTimeout(pending.timer)
    const note =
      action === 'deny'
        ? '⛔ 已拒绝'
        : action === 'always'
          ? `♾ 已允许，且本群之后不再询问 ${pending.toolName}`
          : '✅ 已允许这一次'
    trace('approval-decided', { id, action, chatId: pending.chatId })
    void this.settle(pending, note, action)
    pending.resolve(action)
    return {
      toast: { type: action === 'deny' ? 'warning' : 'success', content: note },
      // `card` must be wrapped as `{type:'raw', data}`; a bare card object is
      // rejected and Feishu then shows its own error toast over ours.
      card: { type: 'raw', data: buildApprovalCard(pending, { note, settled: action }) },
    }
  }

  /** Redraw a prompt with its outcome, so a stale card cannot be clicked twice. */
  private async settle(
    pending: PendingApproval,
    note: string,
    settled?: ApprovalChoice,
  ): Promise<void> {
    if (!pending.cardId) return
    try {
      await this.options.transport.updateCard(
        pending.cardId,
        buildApprovalCard(pending, { note, ...(settled ? { settled } : {}) }),
      )
    } catch (error) {
      this.options.log?.(`approval card refresh failed for ${pending.id}: ${error}`)
    }
  }

  /** Withdraw every pending prompt (plugin shutdown). */
  dispose(): void {
    this.disposed = true
    for (const pending of this.pendings.values()) {
      clearTimeout(pending.timer)
      pending.resolve(undefined)
    }
    this.pendings.clear()
  }
}

/**
 * Build the approval card (Card 2.0).
 *
 * Three buttons rather than two: "allow once" is the safe default and "deny"
 * the safe exit, while "always" is the one that changes future behaviour — it is
 * worded to say so, because a person clicking it is granting a standing right.
 */
export function buildApprovalCard(
  pending: {
    toolName: string
    reason?: string
    id?: string
  },
  options: { note?: string; settled?: ApprovalChoice } = {},
): unknown {
  const settlements: Record<ApprovalChoice, string> = {
    once: '✅ 已允许这一次',
    always: '♾ 已允许（本群后续同类请求不再询问）',
    deny: '⛔ 已拒绝',
  }
  const lines = [`**需要你确认才能继续：\`${pending.toolName}\`**`]
  if (pending.reason) {
    // The reason comes from a hook and can quote a path or a token; masking it
    // costs nothing (`redact` is a no-op on prose) and this card is group-visible.
    lines.push('', redact(pending.reason).text)
  }
  lines.push('', '_飞书卡片拿不到工具参数，只能确认工具与原因。_')
  if (options.note) lines.push('', `**${options.note}**`)

  const elements: unknown[] = [
    {
      tag: 'markdown',
      element_id: 'approval_body',
      content: lines.join('\n'),
      i18n_content: { zh_cn: lines.join('\n'), en_us: lines.join('\n') },
    },
  ]

  const settled = options.settled
  if (settled) {
    elements.push({
      tag: 'markdown',
      element_id: 'approval_settled',
      content: settlements[settled],
      i18n_content: { zh_cn: settlements[settled], en_us: settlements[settled] },
    })
  } else {
    const buttons = [
      { action: 'once' as const, label: '✅ 允许一次', type: 'primary' },
      { action: 'always' as const, label: '♾ 本群总是允许', type: 'default' },
      { action: 'deny' as const, label: '⛔ 拒绝', type: 'danger' },
    ]
    elements.push({
      tag: 'column_set',
      element_id: 'approval_buttons',
      columns: buttons.map((button, index) => ({
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [
          {
            tag: 'button',
            element_id: `approval_button_${index}`,
            text: { tag: 'plain_text', content: button.label },
            type: button.type,
            behaviors: [
              {
                type: 'callback',
                value: {
                  [APPROVAL_KEY]: 'decide',
                  approvalId: pending.id ?? 'unknown',
                  action: button.action,
                },
              },
            ],
          },
        ],
      })),
    })
  }

  return {
    schema: '2.0',
    config: { locales: ['zh_cn', 'en_us'] },
    body: { elements },
  }
}

/** Pull `action.value` out of a card-action payload (v2 nests ids under context). */
function readActionValue(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined
  const action = (data as { action?: { value?: unknown } }).action
  const value = action?.value
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/** The agent's session id, whichever accessor this build exposes. */
function readSessionId(agent: unknown): string | undefined {
  if (!agent || typeof agent !== 'object') return undefined
  const direct = (agent as { id?: unknown }).id
  if (typeof direct === 'string' && direct) return direct
  const header = (agent as { session?: { header?: { id?: unknown } } }).session?.header?.id
  return typeof header === 'string' && header ? header : undefined
}