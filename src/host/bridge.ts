/**
 * Agent bridge: one DSH agent per Feishu conversation.
 *
 * Two reply paths, chosen per turn:
 *   - streaming card (replyMode=streaming): a StreamingCard is created for the
 *     chat and fed from the same `agent/assistant-stream` frames.
 *   - plain text (replyMode=text, or when the card path fails): the final
 *     assistant text is returned and the runtime sends it.
 *
 * M3 adds the context figure to the card's footer.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  type Agent,
  type AgentHandle,
  type AssistantStreamFrame,
  type ModelSelection,
} from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { channelPrompt, type ChannelFacts } from './channel.ts'
import { StreamingCard } from './card/streaming.ts'
import { trace } from './trace.ts'
import type { SessionStore } from './sessions.ts'

/** Turn timeout; TODO: expose in the panel. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000

/** Sent when a turn produced no assistant text at all. */
const NO_OUTPUT = '（本轮无输出）'

/** SessionId/MessageId are branded strings; our ids come from randomUUID. */
const asSessionId = (id: string) => id as unknown as SessionId
const asMessageId = (id: string) => id as unknown as MessageId

/**
 * Everything this agent's scoped prompt hook needs: the model route it was
 * created with and the Feishu facts of its conversation.
 */
interface SelectionRef {
  current: ModelSelection | undefined
  channel?: ChannelFacts
}

/**
 * Structural view of the core's live model handle (`agent.model`).
 *
 * Declared here because `@deepseek-ai/dsh-agent@0.2.1-rc.2` — the version this
 * plugin compiles against — does not put `model` on the public `Agent` type;
 * the running core (≥0.2.2) attaches an `AgentModel` instance at construction
 * and uses it for `applyConfiguredRoute()`. Present ⇒ we may switch routes.
 */
interface AgentModelHandle {
  select(next: ModelSelection): void
}

/**
 * Pin one agent's model route before its first step.
 *
 * `agentOptions` only seeds a *fresh* agent: a resumed session replays its
 * recorded `model/selection` projection, which wins over the options. So the
 * panel choice and `/model` need an explicit switch, and the only sanctioned
 * place is `agent.model.select()` **before** step preparation — never an
 * `agent/request` hook (see `installPromptModelVariables` below).
 *
 * Cores without `agent.model` have no such API; there the route stays whatever
 * the log/`agentOptions` says.
 */
function pinSelection(agent: Agent, selection: ModelSelection, log?: { warn(msg: string): void }): void {
  const model = (agent as unknown as { model?: AgentModelHandle }).model
  if (model === undefined) return
  try {
    model.select(selection)
  } catch (error) {
    // Never fail the turn over a route pin: the session's recorded model is
    // still valid, and the next rebuild will try again.
    log?.warn(`feishu-card: could not pin ${selection.provider}/${selection.model}: ${String(error)}`)
  }
}

/**
 * Contribute `{{provider}}` / `{{model}}` to the assembled prompt.
 *
 * Older cores take those variables from the prompt `variables` map, so the
 * plugin must supply them; newer cores already register them from the step's
 * model selection and the values here are identical, so this is safe on both.
 *
 * Deliberately NOT an `agent/request` hook. Since core 0.2.2 the request
 * envelope's provider/model is frozen by step preparation, and a hook that
 * rewrites it fails the whole turn with
 *
 *   agent/request proposed "<p>/<m>" after step preparation fixed "<p>/<m>";
 *   use agent.model.select() before step preparation
 *
 * `@deepseek-ai/dsh-agent@0.2.1-rc.2` implemented its `installModelSelection`
 * helper as exactly such an `agent/request` override, so calling it from this
 * plugin broke every Feishu turn as soon as the session's recorded selection
 * and the panel selection diverged (live failure 2026-11-09). Route changes now
 * happen only through `agentOptions` at create/resume — see `ensureAgent`.
 */
function installPromptModelVariables(agentCtx: Context, selection: SelectionRef) {
  return agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    // The channel section is appended on every assembly (not registered once):
    // this listener is scoped to the agent, so the facts cannot leak into
    // another conversation, and `interpolate: false` keeps our literal text out
    // of `{{variable}}` expansion.
    const channel = selection.channel
    const sections = channel
      ? [
          ...assembled.sections,
          { name: 'feishu:channel', text: channelPrompt(channel), interpolate: false },
        ]
      : assembled.sections
    if (selected === undefined) return { ...assembled, sections }
    return {
      ...assembled,
      sections,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
}

/**
 * Fold one stream `usage` chunk into the turn's counters (last request wins).
 *
 * `inputTokens` is the *uncached* prompt of that request; the cached part rides
 * alongside, so prompt size is the sum — the same arithmetic the token-meter's
 * pressure fold uses.
 */
function recordUsage(target: TurnUsage, sample: unknown): void {
  if (!sample || typeof sample !== 'object') return
  const value = sample as Partial<Record<keyof TurnUsage, unknown>>
  const num = (key: keyof TurnUsage) => (typeof value[key] === 'number' ? (value[key] as number) : undefined)
  const inputTokens = num('inputTokens')
  const outputTokens = num('outputTokens')
  const cacheReadTokens = num('cacheReadTokens')
  const cacheWriteTokens = num('cacheWriteTokens')
  if (inputTokens !== undefined) target.inputTokens = inputTokens
  if (outputTokens !== undefined) target.outputTokens = outputTokens
  if (cacheReadTokens !== undefined) target.cacheReadTokens = cacheReadTokens
  if (cacheWriteTokens !== undefined) target.cacheWriteTokens = cacheWriteTokens
}

/** The slice of `session/event` we consume (durable session events). */
interface SessionEventLike {
  type: string
  /** Event timestamp, used for tool durations. */
  time?: number
  data?: unknown
}

/**
 * A one-line preview of what a tool was asked to do.
 *
 * hermes shows the command/query under each step; without it the panel is just
 * a list of tool names. Kept short — arguments can be an entire SQL statement.
 */
function toolPreview(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  let text = raw
  try {
    const parsed = JSON.parse(raw) as { command?: string; query?: string; path?: string; url?: string }
    text = parsed.command ?? parsed.query ?? parsed.path ?? parsed.url ?? raw
  } catch {
    // Not JSON: use it verbatim.
  }
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

/**
 * Text blocks of one assistant message, in order.
 *
 * A step's message carries reasoning, text and tool-call blocks; only the text
 * blocks are the answer. Reasoning and tool calls are already rendered through
 * the live stream and the process panel.
 */
export function assistantText(message: unknown): string {
  const content = (message as { content?: { type: string; text?: string }[] } | undefined)?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
}

/** How a turn ended, as far as the runtime needs to know. */
export type TurnEnd = 'completed' | 'stopped' | 'blocked' | 'timed-out'

export interface TurnResult {
  text: string
  model?: string
  timedOut: boolean
  /** True when the reply went out as a streaming card. */
  carded: boolean
  /**
   * True when a card exists at all (even if it carried no text).
   *
   * A stopped turn usually has an empty answer: the card still says 已停止, so
   * the runtime must NOT also post a "（本轮无输出）" message next to it
   * (2026-11-10). `carded` cannot express this — it means "text reached the
   * card".
   */
  cardCreated: boolean
  /** Why the turn ended; `stopped` means the user cancelled it. */
  reason: TurnEnd
}

export interface TurnRequest {
  sessionKey: string
  chatId: string
  text: string
  /** Message this turn answers; the reply quotes it. */
  replyToMessageId?: string
  /**
   * Who sent the message this turn answers. The stop button and `/stop` are
   * restricted to them, so a group member cannot cancel someone else's answer.
   */
  senderOpenId?: string
  /**
   * Channel facts for the system prompt. Absent means "unknown", which keeps the
   * prompt exactly as it was before the channel section existed.
   */
  chatType?: 'p2p' | 'group'
  /** Bot display name / open_id, when the host knows them. */
  botName?: string
  botOpenId?: string
}

interface LiveAgent {
  handle: AgentHandle
  sessionKey: string
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
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
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
  usage: TurnUsage
  /** Reasoning rounds completed in this turn. */
  rounds: number
  /** Conversation this turn belongs to (the card's stop button reports it). */
  sessionKey: string
  /**
   * The person whose message opened this turn.
   *
   * Only they may stop it (2026-11-10): in a group, one member cancelling
   * somebody else's long-running answer is a surprise, not a feature.
   */
  ownerOpenId?: string
}

export interface BridgeOptions {
  store: SessionStore
  /** Workspace for new sessions, read per session so a panel edit applies. */
  defaultWorkspace: () => string
  /**
   * Model route for agents this bridge creates, read per session so a panel
   * edit (or a `/model` switch) applies to the next session without a restart.
   * Absent = follow the host default.
   */
  model?: () => { provider: string; model: string } | undefined
  /**
   * Build the streaming card for one turn, or undefined when the reply is plain
   * text. Called per turn (not per runtime) so a panel switch between
   * streaming/text takes effect on the next message instead of at restart.
   */
  createCard?: (
    chatId: string,
    agent: Agent,
    state: TurnState,
    replyToMessageId?: string,
  ) => StreamingCard | undefined
  /**
   * Register a freshly created session in the workspace registry.
   *
   * `agents.create()` builds the session but leaves it unowned, so the GUI
   * lists it under an untitled group ("未命名") and cannot open its history.
   * The app's own creation path calls `workspace.attachSession()` right after
   * creating; we do the same.
   */
  attachWorkspace?: (sessionId: string, cwd: string) => Promise<void>
  /**
   * Feishu ask-user registry. Bound per session so the tool installed in
   * `setup` can find the chat a question belongs to; without it an agent that
   * calls `ask_user_question` blocks on the desktop GUI's dialog, which the
   * Feishu user cannot see or answer.
   */
  ask?: {
    bind(sessionId: string, chatId: string): void
    registerTool(agentCtx: Context): void
  }
  /** Hard cap on one turn; the agent is cancelled when it expires. */
  turnTimeoutMs?: number
}

export class FeishuBridge {
  private live = new Map<string, LiveAgent>()
  private queues = new Map<string, Promise<unknown>>()
  /** Session keys with a turn in flight (for /stop). */
  private running = new Set<string>()
  /**
   * Sessions whose persisted mapping is being dropped. `reset()` removes the
   * store entry asynchronously, so without this a message arriving in between
   * would resume the session we just abandoned.
   */
  private poisoned = new Set<string>()
  /**
   * Per-conversation model overrides set by `/model`.
   *
   * They live here, not in the plugin config, because `/model` is a
   * conversation-level command: writing the host's global default would retune
   * every other chat (and the GUI) as a side effect. An override is dropped when
   * the agent for that conversation is rebuilt, so the next turn gets it.
   */
  private modelOverrides = new Map<string, ModelSelection>()
  /** Sessions whose live agent uses a stale model and must be rebuilt. */
  private staleModel = new Set<string>()
  /** Sessions a user asked to stop; the footer must say 已停止, not 已完成. */
  private interrupted = new Set<string>()
  /**
   * Who opened each running turn.
   *
   * The card's stop button and `/stop` are restricted to this person: in a group,
   * cancelling somebody else's answer is a surprise, not a feature. Keyed by
   * session (not stored per agent) because ownership lasts exactly one turn.
   */
  private turnOwners = new Map<string, string>()
  /** Per-session turn settlers, so a stop can end the turn immediately. */
  private settlers = new Map<string, (status: string) => void>()

  constructor(
    private readonly ctx: Context,
    private readonly options: BridgeOptions,
  ) {}

  /** Serialize turns per conversation so a chat never runs two agents at once. */
  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(
      key,
      next.catch(() => undefined),
    )
    return next
  }

  async handleMessage(request: TurnRequest): Promise<TurnResult> {
    return this.enqueue(request.sessionKey, async () => {
      const live = await this.ensureAgent(request.sessionKey, request.chatId, request)
      this.running.add(request.sessionKey)
      if (request.senderOpenId) this.turnOwners.set(request.sessionKey, request.senderOpenId)
      try {
        return await this.runTurn(live.handle.agent, request)
      } finally {
        this.running.delete(request.sessionKey)
        this.turnOwners.delete(request.sessionKey)
        // A `/model` switch mid-turn could not swap the live agent (its model
        // is fixed at creation); rebuild it now that the turn has settled.
        if (this.staleModel.delete(request.sessionKey)) await this.dropLive(request.sessionKey)
      }
    })
  }

  /**
   * Who opened the turn running in this conversation right now.
   *
   * `undefined` when nothing is running — the caller then has nothing to
   * protect, and `/stop` may say "there is no task" instead of "not yours".
   */
  turnOwner(sessionKey: string): string | undefined {
    return this.turnOwners.get(sessionKey)
  }

  /**
   * Effective model selection for one conversation: `/model` override first,
   * then the panel's explicit route, then the host default.
   */
  private modelSelection(sessionKey?: string): ModelSelection | undefined {
    const override = sessionKey ? this.modelOverrides.get(sessionKey) : undefined
    if (override) return override
    const config = this.options.model?.()
    if (config?.provider && config.model) return { provider: config.provider, model: config.model }
    const service = this.ctx.get('agentDefaultModel') as
      | { currentSelection(): ModelSelection }
      | undefined
    return service?.currentSelection()
  }

  /**
   * Apply `/model <provider/model>` to one conversation.
   *
   * The live agent's model is fixed when it is created, so an idle session is
   * rebuilt immediately (its session log stays resumable) and a busy one is
   * flagged for rebuild the moment the turn settles.
   */
  async setModel(sessionKey: string, selection: ModelSelection): Promise<void> {
    this.modelOverrides.set(sessionKey, selection)
    if (this.running.has(sessionKey)) {
      this.staleModel.add(sessionKey)
      return
    }
    await this.dropLive(sessionKey)
  }

  /** Current `/model` override, for /status and /model without arguments. */
  modelOverride(sessionKey: string): ModelSelection | undefined {
    return this.modelOverrides.get(sessionKey)
  }

  /** Forget a conversation's live agent (the next message rebuilds it). */
  private async dropLive(sessionKey: string): Promise<void> {
    const live = this.live.get(sessionKey)
    if (!live) return
    this.live.delete(sessionKey)
    await live.handle.dispose().catch((error) => {
      this.ctx.logger.debug(`feishu-card: dropLive dispose failed for ${sessionKey}: ${error}`)
    })
  }

  /** What /status reports for one conversation. */
  describe(sessionKey: string): { sessionId?: string; model?: string; running: boolean } {
    const live = this.live.get(sessionKey)
    return {
      sessionId: live?.handle.agent.id,
      model: live?.handle.agent.options?.model,
      running: this.running.has(sessionKey),
    }
  }

  /** Forget the persisted session so the next message starts a fresh one. */
  async reset(sessionKey: string): Promise<boolean> {
    const had = this.live.has(sessionKey) || this.options.store.get(sessionKey) !== undefined
    // Mark it unusable synchronously: `store.remove` is an async write, so a
    // message arriving in between would otherwise resume the very session we
    // are dropping (an archived one blocks forever).
    this.poisoned.add(sessionKey)
    // `settleTurn: false` — reset is called from inside a finishing turn (the
    // blocked branch), whose own result must not be replaced by a stop.
    await this.stop(sessionKey, { settleTurn: false })
    await this.options.store.remove(sessionKey)
    return had
  }

  /** Resume the persisted session, or create a fresh one. */
  private async ensureAgent(
    sessionKey: string,
    chatId: string,
    channel?: TurnRequest,
  ): Promise<LiveAgent> {
    const existing = this.live.get(sessionKey)
    if (existing) return existing

    await this.options.store.load()
    const record = this.poisoned.has(sessionKey) ? undefined : this.options.store.get(sessionKey)
    const workspace = this.options.defaultWorkspace()
    const meta = { cwd: workspace || undefined }
    const selection = this.modelSelection(sessionKey)
    const agentOptions = selection
      ? {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: selection.reasoningEffort }),
        }
      : undefined
    const selectionRef: SelectionRef = {
      current: selection,
      ...(channel?.chatType === undefined
        ? {}
        : {
            channel: {
              chatId,
              chatType: channel.chatType,
              ...(channel.botName === undefined ? {} : { botName: channel.botName }),
              ...(channel.botOpenId === undefined ? {} : { botOpenId: channel.botOpenId }),
            } satisfies ChannelFacts,
          }),
    }

    /**
     * Creation-time composition of the agent's world. The prompt-variable
     * installer is what supplies `{{provider}}` / `{{model}}`; agentPresets
     * mounts the deployment's persona/tool preset. Both must exist before the
     * first prompt assembly, which is exactly what `setup` guarantees.
     *
     * The route itself does NOT travel through a hook: it rides `agentOptions`,
     * which the core applies with `agent.model.select()` before the first step.
     *
     * `agentPresets` is optional and read via `ctx.get()` for the same reason
     * as `agentDefaultModel` above: the agent's scoped context has its own
     * inject list, and a profile without the preset registry must not break
     * agent creation.
     *
     * The Feishu asker is installed here too, so it shadows the host's
     * GUI-bound `ask_user_question` for this agent's whole lifetime.
     */
    const setup = async (agentCtx: Context) => {
      trace('agent-setup', { sessionKey, hasSelection: Boolean(selection) })
      if (selection || selectionRef.channel) installPromptModelVariables(agentCtx, selectionRef)
      const presets = agentCtx.get('agentPresets') as
        | { mount(ctx: Context): Promise<unknown> }
        | undefined
      trace('agent-setup-presets', { sessionKey, hasPresets: Boolean(presets) })
      if (presets) {
        await presets.mount(agentCtx).catch((error) => {
          this.ctx.logger.warn(`feishu-card: agent preset mount failed for ${sessionKey}: ${error}`)
          trace('agent-setup-presets-failed', { sessionKey, error: String(error) })
        })
      }
      this.options.ask?.registerTool?.(agentCtx)
      trace('agent-setup-done', { sessionKey })
    }

    let handle: AgentHandle
    if (record) {
      try {
        // cwd lives in the persisted session; resume only re-opens it.
        handle = await this.ctx.agents.resume({
          resumeSessionId: asSessionId(record.sessionId),
          agentOptions,
          setup,
        })
        this.ctx.logger.info(`feishu-card: resumed session ${record.sessionId} for ${sessionKey}`)
      } catch (error) {
        this.ctx.logger.warn(`feishu-card: resume failed (${error}), creating a new session`)
        handle = await this.createAgent(meta, agentOptions, setup)
      }
    } else {
      handle = await this.createAgent(meta, agentOptions, setup)
    }

    // `agentOptions` only seeds a fresh agent; a resumed session replays its own
    // recorded selection and would ignore the panel/`/model` choice. Pin it now,
    // before the first step runs.
    if (selection) pinSelection(handle.agent, selection, this.ctx.logger)

    const live: LiveAgent = { handle, sessionKey }
    this.live.set(sessionKey, live)
    // A fresh session replaced the dropped one, so the poison is spent.
    this.poisoned.delete(sessionKey)
    // The asker needs session → chat to deliver a question; bind before the
    // first turn so a tool call can never arrive homeless.
    this.options.ask?.bind(handle.agent.id, chatId)
    // Own the session in the workspace registry, or the GUI files it under an
    // untitled group and cannot open its history.
    if (workspace) {
      await this.options
        .attachWorkspace?.(handle.agent.id, workspace)
        .catch((error) => {
          this.ctx.logger.debug(`feishu-card: workspace attach skipped: ${error}`)
        })
    }
    await this.options.store.put(sessionKey, {
      sessionId: handle.agent.id,
      workspace,
      updatedAt: Date.now(),
    })
    trace('agent-ready', {
      sessionKey,
      sessionId: handle.agent.id,
      provider: handle.agent.options?.provider ?? null,
      model: handle.agent.options?.model ?? null,
      workspace: workspace || null,
      resumed: Boolean(record),
    })
    return live
  }

  private async createAgent(
    meta: { cwd?: string },
    agentOptions?: { provider: string; model: string },
    setup?: (agentCtx: Context) => Promise<void>,
  ): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: asSessionId(randomUUID()),
      meta,
      agentOptions,
      setup,
    })
  }

  /** Submit one user message and resolve with the assistant's final text. */
  private runTurn(agent: Agent, request: TurnRequest): Promise<TurnResult> {
    const message: UserMessage = {
      id: asMessageId(randomUUID()),
      role: 'user',
      content: [{ type: 'text', text: request.text }],
      source: { kind: 'user' },
    }
    const model = agent.options?.model
    // Newest request's usage; the footer reads it live while the projection is
    // still empty, and the seal prefers the projection once it has folded.
    const state: TurnState = {
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      rounds: 0,
      sessionKey: request.sessionKey,
      ...(request.senderOpenId ? { ownerOpenId: request.senderOpenId } : {}),
    }
    // The card is posted as a reply to the message that triggered the turn, so
    // Feishu renders the "回复 XXX" quote header. `undefined` means this turn
    // replies as plain text (replyMode=text), decided per turn.
    const card = this.options.createCard?.(
      request.chatId,
      agent,
      state,
      request.replyToMessageId,
    )

    return new Promise<TurnResult>((resolve, reject) => {
      let buffer = ''
      let settled = false
      const toolNames = new Map<string, string>()

      const finish = (result: TurnResult) => {
        if (settled) return
        settled = true
        dispose()
        clearTimeout(timer)
        resolve(result)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        dispose()
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      const onFrame = ({ agent: source, frame }: { agent: Agent; frame: AssistantStreamFrame }) => {
        // Traced unfiltered first: a silently dropped frame is the single
        // hardest bridge bug to see from Feishu.
        trace('frame', {
          sessionKey: request.sessionKey,
          expected: agent.id,
          got: source?.id ?? null,
          frameType: frame.type,
          chunkType: frame.type === 'chunk' ? frame.chunk.type : null,
        })
        if (source.id !== agent.id) return
        // NOTE: `end` closes ONE ATTEMPT, not the turn. A multi-step turn
        // (reasoning → tool call → tool result → next request → answer) emits
        // start/end per LLM request, so sealing here sealed the card after the
        // first preamble and dropped the real answer. The turn boundary is the
        // durable `turn/end` session event (plus `agent/status: idle` below).
        if (frame.type !== 'chunk') return
        const chunk = frame.chunk
        switch (chunk.type) {
          case 'text-delta':
            buffer += chunk.text
            card?.pushAnswer(chunk.text)
            break
          case 'reasoning-delta':
            card?.pushReasoning(chunk.text)
            break
          case 'usage':
            // Last-wins: the newest request's usage is the current one, the
            // same replacement rule the token-meter projection applies.
            recordUsage(state.usage, chunk.usage)
            break
          case 'tool-call-delta': {
            // The first delta for an id carries the tool name; later ones only
            // carry argument fragments, which we deliberately do not render.
            const known = toolNames.get(String(chunk.id))
            if (!known && chunk.name) {
              toolNames.set(String(chunk.id), chunk.name)
              card?.pushTool(`🔧 ${chunk.name}`)
            }
            break
          }
          default:
            break
        }
      }
      /**
       * The durable turn boundary.
       *
       * `turn/end` is appended exactly once per turn, in the driver's `finally`,
       * after every attempt and tool result has settled — so it is the only
       * signal that means "this turn is over". Its `reason` distinguishes a
       * completed turn from an aborted or failed one, which is what lets the
       * user see the real error instead of a generic one.
       */
      const onSessionEvent = (subject: unknown, event: SessionEventLike) => {
        if (subject !== agent.session) return
        trace('session-event', { sessionKey: request.sessionKey, type: event.type })
        const at = typeof event.time === 'number' ? event.time : Date.now()
        const data = event.data as
          | {
              message?: unknown
              reason?: { kind?: string; error?: { message?: string } }
              callId?: string
              name?: string
              arguments?: string
              error?: { name?: string; code?: string; reason?: string }
            }
          | undefined
        if (event.type === 'assistant/message') {
          // Authoritative text for the step that just settled.
          const text = assistantText(data?.message)
          if (text) {
            buffer = text
            card?.setAnswer(text)
          }
          return
        }
        if (event.type === 'tool/call' && data?.name) {
          // Routed straight into THIS turn's card: a shared "current card"
          // pointer drew one chat's tools on another chat's card whenever two
          // conversations streamed at once.
          card?.toolStart(String(data.callId ?? ''), data.name, at, toolPreview(data.arguments))
          return
        }
        if (event.type === 'tool/result') {
          const isError = Boolean((data?.message as { isError?: boolean } | undefined)?.isError)
          const reason = data?.error?.reason ?? data?.error?.name
          card?.toolEnd(String(data?.callId ?? ''), at, !isError, isError ? (reason ?? '工具执行失败') : undefined)
          return
        }
        if (event.type === 'step/start') {
          state.rounds += 1
          // Each model step gets its own answer segment: without this a
          // multi-step turn's durable text replaced the previous step's words on
          // the card ("文字回退"), because `setAnswer` overwrote everything.
          card?.newSegment()
          return
        }
        if (event.type !== 'turn/end') return
        const reason = data?.reason
        if (reason?.kind === 'error') {
          void sealCard('出错').then(() =>
            fail(new Error(reason.error?.message ?? 'agent error')),
          )
          return
        }
        if (reason?.kind === 'aborted') {
          void sealCard('已停止').then(() => finish(turnResult(false, 'stopped')))
          return
        }
        if (reason?.kind === 'blocked') {
          // The host vetoed the step before any request ran. The archived-session
          // gate does this permanently, so resuming the same session would block
          // every later message too and the bridge would look dead. Drop the
          // mapping so the next message starts a fresh session, and say what
          // happened instead of the meaningless "（本轮无输出）".
          trace('turn-blocked', { sessionKey: request.sessionKey, sessionId: agent.id })
          void this.reset(request.sessionKey)
          void sealCard('已拦截').then(() =>
            finish({
              ...turnResult(false, 'blocked'),
              text: '这个会话已被 Harness 归档（或宿主拦截了本次请求），已自动开新会话，请再发一次。',
            }),
          )
          return
        }
        void sealCard('已完成').then(() => finish(turnResult(false)))
      }
      // Safety net: `agent/status: idle` means the driver drained, so the turn
      // is over even if no `turn/end` was observed (a profile without the
      // session service, or an event routing miss). Without this a frame-less
      // turn would hang until the timeout.
      const onStatus = ({ agent: source, status }: { agent: Agent; status: string }) => {
        trace('status', { sessionKey: request.sessionKey, expected: agent.id, got: source?.id ?? null, status })
        if (source.id !== agent.id || status !== 'idle') return
        // `/stop` disposes the agent, which drains it to idle — that is a stop,
        // not a completion, and the card must say so.
        const stopped = this.interrupted.delete(request.sessionKey)
        void sealCard(stopped ? '已停止' : '已完成').then(() =>
          finish(turnResult(false, stopped ? 'stopped' : 'completed')),
        )
      }
      const onError = ({ agent: source, error }: { agent: Agent; error?: unknown }) => {
        trace('agent-error', { sessionKey: request.sessionKey, error: String(error) })
        if (source.id !== agent.id) return
        void sealCard('出错').then(() =>
          fail(error instanceof Error ? error : new Error('agent error')),
        )
      }

      const disposeStream = this.ctx.on('agent/assistant-stream', onFrame)
      const disposeStatus = this.ctx.on('agent/status', onStatus)
      const disposeError = this.ctx.on('agent/error', onError)
      const disposeSession = this.ctx.on('session/event', onSessionEvent)
      const dispose = () => {
        disposeStream()
        disposeStatus()
        disposeError()
        disposeSession()
        this.settlers.delete(request.sessionKey)
      }

      // Lets `/stop` (or the card's ⏹ button) settle this turn deterministically.
      // Waiting for `turn/end` after a cancel is not reliable: disposing the
      // handle can swallow it, and the turn would then hang until the timeout.
      this.settlers.set(request.sessionKey, (status) => {
        // '已停止' comes from /stop and from the card's ◯ button — a cancel, not a
        // completion, so the runtime suppresses its "（本轮无输出）" fallback.
        void sealCard(status).then(() =>
          finish(turnResult(false, status === '已停止' ? 'stopped' : 'completed')),
        )
      })

      const timer = setTimeout(() => {
        // Cancelling the agent is not optional: without it the model keeps
        // generating, the per-session queue releases anyway, and the next
        // message starts a SECOND turn on the same session (two drivers, one
        // log, tokens burning to the end). Sealing the card alone only hides it.
        try {
          agent.cancel({ kind: 'hook', reason: 'feishu-card: turn timeout' })
        } catch (error) {
          trace('timeout-cancel-failed', { sessionKey: request.sessionKey, error: String(error) })
        }
        void card?.abort()
        finish(turnResult(true, 'timed-out'))
      }, this.options.turnTimeoutMs ?? TURN_TIMEOUT_MS)
      if (typeof timer.unref === 'function') timer.unref()

      /**
       * `carded` is a promise, not a fact: a card that was never created, or
       * that never actually received the answer, must not suppress the text
       * reply — the user has to get the answer somewhere. Claiming `carded` on a
       * broken card is how a turn ends with no reply at all.
       */
      const turnResult = (timedOut: boolean, reason: TurnEnd = 'completed'): TurnResult => ({
        text: timedOut && !buffer.trim()
          ? `（超过 ${Math.round((this.options.turnTimeoutMs ?? TURN_TIMEOUT_MS) / 60000)} 分钟未响应，已停止等待。可再发一条继续）`
          : buffer.trim() || NO_OUTPUT,
        model,
        timedOut,
        carded: Boolean(card?.delivered),
        cardCreated: Boolean(card?.id),
        reason,
      })

      const sealCard = async (status: string) => {
        if (!card) {
          trace('seal-skipped', { sessionKey: request.sessionKey, reason: 'no card' })
          return
        }
        try {
          // The card re-reads the runtime's footer source itself, so all the
          // bridge supplies is the final status.
          await card.seal({ status })
          trace('sealed', {
            sessionKey: request.sessionKey,
            status,
            cardId: card.id ?? null,
            answerLength: card.text.length,
          })
        } catch (error) {
          // A card that cannot be sealed must not lose the answer: the runtime
          // falls back to sending the text.
          this.ctx.logger.warn(`feishu-card: seal failed (${error}); falling back to text`)
          trace('seal-failed', { sessionKey: request.sessionKey, error: String(error) })
        }
      }

      // The card must exist before the turn can end. A turn that is blocked or
      // fails instantly (the archived-session gate, a prompt-assembly error)
      // finishes in milliseconds — long before two round trips to Feishu — and
      // a seal with no card is a silent no-op, leaving a card stuck on
      // "正在加载上下文…" forever. So: create first, then start the turn.
      // (Listeners are already registered, so nothing is missed meanwhile.)
      void (async () => {
        try {
          if (card) await card.start()
          trace('card-started', { sessionKey: request.sessionKey, cardId: card?.id ?? null })
        } catch (error) {
          this.ctx.logger.warn(`feishu-card: card start failed (${error}); falling back to text`)
          trace('card-start-failed', { sessionKey: request.sessionKey, error: String(error) })
        }
        try {
          agent.followup(message)
        } catch (error) {
          fail(error)
        }
      })()
    })
  }

  /**
   * Cancel and drop one conversation's agent (its session stays resumable).
   *
   * @param options.settleTurn - end the in-flight turn right away with 已停止.
   *   `false` when the caller is itself deciding how the turn ended.
   */
  async stop(sessionKey: string, options: { settleTurn?: boolean } = {}): Promise<boolean> {
    const live = this.live.get(sessionKey)
    const wasRunning = this.running.has(sessionKey)
    const settle = this.settlers.get(sessionKey)
    if (wasRunning) this.interrupted.add(sessionKey)
    this.running.delete(sessionKey)
    if (live) {
      // Cancel before disposing: dispose alone leaves the in-flight request to
      // be torn down implicitly, and `/stop` must settle the turn promptly so
      // the next message is not queued behind a ghost.
      try {
        live.handle.agent.cancel({ kind: 'user' })
      } catch (error) {
        this.ctx.logger.debug(`feishu-card: cancel failed for ${sessionKey}: ${error}`)
      }
      this.live.delete(sessionKey)
    }
    // Settle the promise directly when a turn is in flight; its own seal path
    // then says 已停止 and the runtime stops waiting on Feishu events.
    if (options.settleTurn !== false) settle?.('已停止')
    if (live) {
      await live.handle.dispose().catch((error) => {
        this.ctx.logger.warn(`feishu-card: dispose failed for ${sessionKey}: ${error}`)
      })
    }
    return wasRunning || Boolean(live)
  }

  async dispose(): Promise<void> {
    for (const key of [...this.live.keys()]) await this.stop(key)
  }
}

