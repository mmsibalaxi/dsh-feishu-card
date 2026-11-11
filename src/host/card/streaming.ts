/**
 * Streaming card controller.
 *
 * Wraps the CardKit v2.0 lifecycle for one turn:
 *   create (streaming_mode) → throttled partial updates → seal
 *
 * Everything Feishu-specific goes through the injected CardTransport, so the
 * flush timing, element updates and seal order are unit-tested without a
 * Feishu app. The real transport (Lark SDK) lives in card/transport.ts.
 */
import {
  LOADING_ICON_ID,
  STOP_BUTTON_ID,
  buildFooterElement,
  buildSealPlan,
  runSealPlan,
  summaryFromAnswer,
  type CardApi,
  type FooterInput,
  type SealReport,
} from './seal.ts'
import {
  answerElement,
  buildStreamingCard,
  continuationCard,
  loadingIndicator,
  panelHeader,
  panelPlaceholder,
  panelUpdate,
  stopButtonRow,
  type PanelToolStep,
} from './builder.ts'
import { MORE_FOLLOWS_SUFFIX, sanitizeAnswer, splitAnswer } from './md.ts'
import { trace } from '../trace.ts'
import type { FooterField } from '../../shared/types.js'

export interface CardTransport {
  /** Send the initial card; returns the card id used by later calls. */
  createCard(chatId: string, card: unknown, replyToMessageId?: string): Promise<string>
  updateCard(cardId: string, card: unknown, sequence: number): Promise<void>
  batchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void>
  settings(cardId: string, settings: unknown, sequence: number): Promise<void>
}

export interface StreamingCardOptions {
  transport: CardTransport
  chatId: string
  /** Which footer fields to render, in display order. */
  footerFields: FooterField[]
  flushIntervalMs: number
  /** Show the reasoning stream inside the process panel (hermes' opt-in). */
  showReasoning?: boolean
  /** Keep the process panel expanded once the turn seals. */
  panelExpanded?: boolean
  panelExpandedWhileRunning?: boolean
  /**
   * Render the collapsible process panel at all (tools/rounds/elapsed).
   *
   * `false` produces a card whose only state is the answer, the "still working"
   * row and the stop button — the config lets a user turn the toolbar off
   * (2026-11-11).
   */
  showPanel?: boolean
  /** Live footer readings; called on create and on every flush. */
  footerSource?: () => FooterInput
  /** Model shown in the panel's collapsed header. */
  panelModel?: () => string | undefined
  /** Reasoning-round count for the panel's collapsed header. */
  panelRounds?: () => number
  /** Message the card answers; the card is posted as a quoted reply. */
  replyToMessageId?: string
  /**
   * Conversation this card belongs to. When set, the card carries a ⏹ 停止
   * button that reports back with this key, so the runtime can cancel exactly
   * this turn (and nothing else).
   */
  sessionKey?: string
  /**
   * The person who opened this turn. Carried into the stop button's callback
   * value so the runtime can refuse a click from anybody else — Feishu renders
   * ONE card for the whole chat, so the restriction has to be enforced when the
   * button is pressed (2026-11-10).
   */
  stopOwnerOpenId?: string
  /**
   * Called with the CardKit card id as soon as it exists, so the runtime can
   * find this card again when its message is recalled (message protection).
   */
  onCardId?: (cardId: string) => void
  /**
   * Rewrites markdown image refs into Feishu `img_key`s before the card seals.
   * Best effort: a failure must never cost the answer.
   */
  resolveImages?: (text: string) => Promise<string>
  /**
   * Delays before each seal attempt (first entry is "now").
   *
   * A finished card that never seals keeps its "still working" dots and a live
   * 停止 button forever, so the tail attempt is deliberately late: a network
   * hiccup that outlives ~3s usually clears well before 10s.
   */
  sealRetryDelaysMs?: number[]
  now?: () => number
  log?: (message: string) => void
}

export class StreamingCard {
  private cardId?: string
  private sequence = 0
  /**
   * The answer, one entry per model step.
   *
   * A turn can make several requests (reasoning → tool call → answer). Each one
   * streams its own text and then settles with its own `assistant/message`, so
   * keeping ONE buffer meant every step REPLACED the previous step's words — the
   * card visibly rewrote itself (Hermes appends segments instead).
   */
  private segments: string[] = ['']
  private reasoning = ''
  /** Tool calls in flight/done, with their durations. */
  private steps: PanelToolStep[] = []
  /** What changed since the last write. Answer and panel flush on different clocks. */
  private answerDirty = false
  private panelDirty = false
  private timer?: ReturnType<typeof setTimeout>
  /**
   * Content is frozen: the turn is over, so nothing new may be pushed.
   *
   * Separate from {@link sealed} on purpose. `sealed` means THE SEAL PLAN
   * LANDED. Conflating them is what left finished cards showing their "still
   * working" dots and a live 停止 button: the plan threw, `sealed` was already
   * true, and no retry was possible (live report 2026-11-10).
   */
  private closed = false
  /** The seal plan was applied; the card can never change again. */
  private sealed = false
  /** In-flight seal, shared by every concurrent caller. */
  private sealing?: Promise<SealReport | undefined>
  /** Status requested before the card existed; applied by start(). */
  private pendingSeal?: string
  /** Serialized card writes — see write(). */
  private writes: Promise<unknown> = Promise.resolve()
  /** True once a batchUpdate carrying answer text was accepted by Feishu. */
  private answerWritten = false
  /**
   * True once ANY batchUpdate was accepted.
   *
   * Distinguishes "the transport works, this seal hit a hiccup" (worth a late
   * retry) from "this card never accepted anything" (a misconfiguration no
   * retry will fix).
   */
  private wroteOk = false
  private readonly startedAt: number

  /**
   * Longest a tool-panel-only change may wait.
   *
   * Every write is a round trip and they are serialized, so a panel refresh that
   * rides the answer's clock competes with the text. Measured live (2026-11-10):
   * 72% of all card writes carried no new answer text, median gap between writes
   * 913ms, and the text advanced ~58 characters at a time. Two seconds keeps a
   * long tool-heavy turn from paying a full round trip per tool row.
   */
  static readonly PANEL_REFRESH_MS = 2000

  constructor(private readonly options: StreamingCardOptions) {
    this.startedAt = (options.now ?? Date.now)()
  }

  /** Joined answer text across every step of this turn. */
  private get answer(): string {
    return this.segments
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('\n\n')
  }

  /** Replace all answer text with one block (image rewriting at seal time). */
  private setAnswerText(text: string): void {
    this.segments = [text]
  }

  /**
   * The answer split into card-sized parts.
   *
   * Part 0 streams on the live card; the rest is posted after the seal as
   * continuation cards. Splitting is deterministic, so part 0 only ever grows
   * while the live card is being written.
   */
  private answerParts(): string[] {
    return splitAnswer(this.answer)
  }

  /** What the live card's answer element holds right now. */
  private answerForCard(): string {
    const parts = this.answerParts()
    const head = sanitizeAnswer(parts[0] ?? '')
    return parts.length > 1 ? `${head}${MORE_FOLLOWS_SUFFIX}` : head
  }

  /**
   * Post the remainder of a long answer as static cards.
   *
   * Not awaited: these are separate messages, not part of the seal, and a turn
   * must not wait on N more card creations. Each failure is logged and skipped —
   * a missing tail is better than a stuck turn.
   */
  private async sendContinuations(parts: string[]): Promise<void> {
    for (const [index, part] of parts.entries()) {
      const content = sanitizeAnswer(part)
      if (!content.trim()) continue
      try {
        await this.options.transport.createCard(
          this.options.chatId,
          continuationCard(content, summaryFromAnswer(content, '续')),
        )
        trace('card-continuation', {
          cardId: this.cardId,
          part: index + 1,
          length: content.length,
        })
      } catch (error) {
        this.options.log?.(
          `continuation card ${index + 1} failed: ${String(error).slice(0, 160)}`,
        )
      }
    }
  }

  private get dirty(): boolean {
    return this.answerDirty || this.panelDirty
  }

  /** Milliseconds since the card was created. */
  private elapsedMs(): number {
    return (this.options.now ?? Date.now)() - this.startedAt
  }

  /** Create the card. Safe to call once; later calls are no-ops. */
  async start(): Promise<void> {
    if (this.cardId) return
    this.cardId = await this.options.transport.createCard(
      this.options.chatId,
      buildStreamingCard({
        panelExpanded: this.options.panelExpanded,
        showPanel: this.options.showPanel,
        panelModel: this.options.panelModel?.(),
        panelRounds: this.options.panelRounds?.(),
        panelToolCount: this.steps.length,
        panelElapsedMs: this.elapsedMs(),
        stopValue: this.options.sessionKey
          ? {
              feishuCardStop: 'stop',
              sessionKey: this.options.sessionKey,
              ...(this.options.stopOwnerOpenId
                ? { ownerOpenId: this.options.stopOwnerOpenId }
                : {}),
            }
          : undefined,
        // No footer while the turn runs: the status line is a result, so the
        // seal plan adds it together with the divider (footerPresent: false).
      }),
      this.options.replyToMessageId,
    )
    this.options.log?.(`streaming card created ${this.cardId}`)
    this.options.onCardId?.(this.cardId)
    trace('card-create', { chatId: this.options.chatId, cardId: this.cardId })
    // Text can arrive before the card exists (the model is often faster than
    // two round trips to Feishu). Marking dirty before start() is what makes
    // those deltas land instead of vanishing.
    if (this.dirty) await this.flushQueued()
    // A turn that ended while the card was being created asked for a seal we
    // could not perform yet; honour it now.
    const pending = this.pendingSeal
    this.pendingSeal = undefined
    if (pending !== undefined) await this.seal({ status: pending })
  }

  /**
   * Reasoning deltas.
   *
   * Collected always (the count is a real signal, and a later flush may want the
   * tail), rendered only when `showReasoning` is on — hermes gates it the same
   * way, because a wall of scratchpad text buries the answer.
   */
  pushReasoning(delta: string): void {
    if (this.closed || !delta) return
    this.reasoning += delta
    if (this.options.showReasoning) this.markPanelDirty()
  }

  pushAnswer(delta: string): void {
    if (this.closed || !delta) return
    this.appendToSegment(delta)
    this.markAnswerDirty()
  }

  /** Append to the step that is streaming right now. */
  private appendToSegment(delta: string): void {
    const last = this.segments.length - 1
    this.segments[last] = (this.segments[last] ?? '') + delta
  }

  /**
   * Start a new answer segment for the next model step.
   *
   * Called on `step/start`. Without it a multi-step turn's steps would concatenate
   * into one run-on paragraph; with it each step's text keeps its own paragraph
   * and, critically, its own authority (see {@link setAnswer}).
   */
  newSegment(): void {
    if (this.closed) return
    const last = this.segments[this.segments.length - 1] ?? ''
    // The first step usually opens with an empty segment: do not create blanks.
    if (last.trim().length === 0) return
    this.segments.push('')
  }

  /**
   * Replace the CURRENT segment with the authoritative text of the step that
   * just settled.
   *
   * The live stream is a sequence of attempts (one per LLM request); the durable
   * `assistant/message` carries the authoritative text of the step that settled.
   * Only that segment is replaced — replacing the whole answer (the old
   * behaviour) made earlier steps' words disappear, which is what "文字回退" looked
   * like in the card.
   */
  setAnswer(text: string): void {
    if (this.closed || !text) return
    const last = this.segments.length - 1
    this.segments[last] = text
    this.markAnswerDirty()
  }

  pushTool(line: string): void {
    if (this.closed || !line) return
    this.steps.push({ name: line })
    this.markPanelDirty()
  }

  /**
   * Record a tool call starting. `at` is the event's own timestamp so the
   * duration measures the call, not our scheduling latency.
   *
   * Steps are indexed by call id, not by name: two `grep` calls can run at the
   * same time, and matching on the name merged them into one row, left the
   * second one spinning forever and computed 0ms for both.
   */
  toolStart(id: string, name: string, at: number, preview?: string): void {
    if (this.closed || !name) return
    const existing = this.stepIndex.get(id)
    if (existing !== undefined) {
      const step = this.steps[existing]
      if (step) step.preview = preview ?? step.preview
      return
    }
    this.steps.push({ id, name, ms: undefined, preview })
    this.stepIndex.set(id, this.steps.length - 1)
    this.toolStartedAt.set(id, at)
    this.markPanelDirty()
  }

  /** Close a tool call with its wall-clock duration (and its failure, if any). */
  toolEnd(id: string, at: number, ok = true, error?: string): void {
    const startedAt = this.toolStartedAt.get(id)
    this.toolStartedAt.delete(id)
    const index = this.stepIndex.get(id)
    const step = index === undefined ? undefined : this.steps[index]
    const close = (target: PanelToolStep) => {
      target.ms = Math.max(0, at - (startedAt ?? at))
      target.completed = ok
      if (!ok && error) target.error = error
      this.markPanelDirty()
    }
    if (!step || step.ms !== undefined) {
      // A result with no matching start (the stream dropped the call frame):
      // still close the newest open row so the panel does not show a spinner
      // for something that already finished.
      const fallback = [...this.steps].reverse().find((candidate) => candidate.ms === undefined)
      if (!fallback) return
      close(fallback)
      return
    }
    close(step)
  }

  private readonly toolStartedAt = new Map<string, number>()
  /** call id → index in `steps` (indices are stable: the array only grows). */
  private readonly stepIndex = new Map<string, number>()

  get text(): string {
    return this.answer
  }

  /**
   * Whether this turn's answer actually reached Feishu as a card.
   *
   * "Reached" means a batchUpdate carrying the answer was accepted by Feishu —
   * not merely that a card id exists and text was buffered. The old definition
   * claimed delivery for a card whose every write failed (the message-id
   * fallback, or a missing CardKit scope), which suppressed the plain-text
   * fallback and left the user with a stuck card and no answer.
   */
  get delivered(): boolean {
    return Boolean(this.cardId) && this.answer.trim().length > 0 && this.answerWritten
  }

  get id(): string | undefined {
    return this.cardId
  }

  /**
   * Record that there is unsent content.
   *
   * Deliberately independent of `cardId`: deltas that arrive before the card
   * exists must survive until `start()` flushes them, otherwise the first
   * (often only) burst of text is dropped and the user gets an empty card.
   */
  private markAnswerDirty(): void {
    this.answerDirty = true
    this.scheduleFlush()
  }

  private markPanelDirty(): void {
    this.panelDirty = true
    this.scheduleFlush()
  }

  /**
   * Serialize every write to this card.
   *
   * `batchUpdate` rejects when two writes race (Feishu answers 300317
   * "sequence number compare failed"), and the timer's flush is fire-and-forget
   * — an unhandled rejection there takes the whole host process down. So all
   * writes (flush, seal) go through one chain, and nothing
   * escapes uncaught.
   */
  private write<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writes.then(task, task)
    // Keep the chain alive but never let a failure escape unobserved.
    this.writes = next.catch(() => undefined)
    return next
  }

  /**
   * Throttled write of the dirty elements.
   *
   * The delay depends on WHAT changed: text gets the short clock (100ms by
   * default, the cadence the user's Hermes bridge uses), the process panel gets
   * a long one. Every flush is a round trip on one serialized chain, so letting
   * a tool row ride the text clock is what made the typewriter arrive in bursts.
   */
  private scheduleFlush(): void {
    if (this.closed) return
    // Without a card there is nothing to write to yet; `start()` picks the
    // pending dirty flags up as soon as the card exists.
    if (!this.cardId) return
    if (this.timer) return
    const delay = this.answerDirty
      ? this.options.flushIntervalMs
      : Math.max(this.options.flushIntervalMs, StreamingCard.PANEL_REFRESH_MS)
    this.timer = setTimeout(() => {
      this.timer = undefined
      // Fire-and-forget, so a rejection must be observed here or it takes the
      // host process down as an unhandled rejection.
      void this.write(() => this.flush()).catch(() => undefined)
    }, delay)
    // Never hold the process open for a card flush.
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  /**
   * Write whatever changed.
   *
   * Only the elements that actually changed are sent: a flush that carries no
   * text used to re-send the whole panel anyway, which is how half of all live
   * writes advanced nothing.
   */
  async flush(): Promise<void> {
    if (!this.cardId || !this.dirty || this.closed) return
    const answerDirty = this.answerDirty
    const panelDirty = this.panelDirty
    this.answerDirty = false
    this.panelDirty = false
    const actions: unknown[] = []
    if (answerDirty) {
      actions.push({
        action: 'partial_update_element',
        params: {
          element_id: 'answer_content',
          // INNER fields only — a full element object here is accepted by the
          // API and then silently ignored.
          partial_element: { content: this.answerForCard() },
        },
      })
    }
    if (panelDirty && this.options.showPanel !== false) {
      actions.push({
        action: 'partial_update_element',
        params: {
          element_id: 'agent_process_panel',
          // Tool steps with their durations — reasoning only when opted in.
          partial_element: panelUpdate({
            steps: this.steps,
            model: this.options.panelModel?.(),
            rounds: this.options.panelRounds?.(),
            elapsedMs: this.elapsedMs(),
            reasoning: this.options.showReasoning ? this.reasoning : undefined,
            expanded: this.options.panelExpandedWhileRunning,
          }),
        },
      })
    }
    if (actions.length === 0) return
    this.sequence += 1
    try {
      await this.options.transport.batchUpdate(this.cardId, actions, this.sequence)
      this.wroteOk = true
      // The answer element was part of this accepted batch, so it is on the
      // card now — this is what lets `delivered` mean something.
      if (answerDirty && this.answer.trim()) this.answerWritten = true
      trace('card-flush', {
        cardId: this.cardId,
        sequence: this.sequence,
        answerLength: answerDirty ? this.answer.length : 0,
        reasoningLength: this.reasoning.length,
        tools: this.steps.length,
        actions: actions.length,
      })
    } catch (error) {
      // A failed flush must not lose the buffered text: keep it dirty so the
      // next tick (and the seal) retry with the full answer.
      if (answerDirty) this.answerDirty = true
      if (panelDirty) this.panelDirty = true
      trace('card-flush-failed', { cardId: this.cardId, sequence: this.sequence, error: String(error) })
      throw error
    }
  }

  /** flush(), serialized onto the card's write chain. */
  private flushQueued(): Promise<void> {
    return this.write(() => this.flush())
  }

  /** Finish the turn: flush, refresh the footer, close streaming. */
  async seal(input: { status: string; elapsed?: string }): Promise<SealReport | undefined> {
    if (!this.cardId) {
      // A turn can end before the card exists (blocked/failed turns finish in
      // milliseconds). Remember the request so start() seals the moment the
      // card lands, instead of leaving a card stuck on its loading state.
      if (!this.sealed) this.pendingSeal = input.status
      return undefined
    }
    // Already sealed: nothing to do. NOT "already tried": a failed attempt must
    // stay retryable (see `closed`).
    if (this.sealed) return undefined
    // Re-entrancy: `turn/end` and `agent/status: idle` both fire for the same
    // turn, milliseconds apart. Sharing one promise keeps them from sending two
    // plans (a duplicate sequence is CardKit 300317).
    if (this.sealing) return this.sealing
    this.sealing = this.runSeal(input).finally(() => {
      // Cleared even on failure, so a later event (or the runtime's own retry)
      // can run the plan again.
      this.sealing = undefined
    })
    return this.sealing
  }

  /**
   * Apply the seal plan, retrying the two transient failure classes.
   *
   * A seal is the ONE write that must land: until it does, a finished answer
   * keeps its "still working" dots and a live 停止 button, and nothing can push
   * a fix because the turn is over. `runSealPlan` already tolerates the
   * "already satisfied" codes; this adds
   *   - serialization on the write chain (a flush may still be in flight, and a
   *     concurrent batchUpdate answers 300317 "sequence number compare failed"),
   *   - up to two retries with fresh sequence numbers, for a network blip.
   */
  private async sealWithRetry(cardId: string, plan: ReturnType<typeof buildSealPlan>): Promise<SealReport> {
    // The late tail attempt is only worth 10 seconds of a turn's lifetime when
    // this card has already accepted a write: then the failure is a hiccup. A
    // transport that never worked (no CardKit scope, wrong app) would just make
    // every turn wait 13 seconds for an outcome it cannot change.
    const delays =
      this.options.sealRetryDelaysMs ?? (this.wroteOk ? [0, 800, 2500, 10_000] : [0, 800, 2500])
    let lastError: unknown
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      const delay = delays[attempt] ?? 0
      if (delay > 0) await sleep(delay)
      // A recalled card is gone: stop retrying, nothing would render.
      if (this.sealed) break
      try {
        return await this.write(() =>
          runSealPlan(this.asApi(), cardId, plan, this.sequence, this.options.log),
        )
      } catch (error) {
        lastError = error
        this.options.log?.(
          `seal attempt ${attempt + 1}/${delays.length} failed: ${String(error).slice(0, 160)}`,
        )
        trace('card-seal-retry', { cardId, attempt: attempt + 1, error: String(error) })
        // Skip past every sequence the failed attempt may have used: reusing a
        // number is exactly the 300317 the retry is trying to escape.
        this.sequence += plan.batches.length + 2
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** The actual seal body, shared by every concurrent caller. */
  private async runSeal(input: { status: string; elapsed?: string }): Promise<SealReport | undefined> {
    const cardId = this.cardId
    if (!cardId) return undefined
    // Cancel the pending timer first, then write whatever is dirty: flush()
    // refuses to run once content is frozen, so that flag flips only afterwards.
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    // Images last: the answer is final by now, so the upload happens once and
    // the flushed text is the one the user keeps.
    if (this.options.resolveImages && this.answer.includes('![')) {
      try {
        const resolved = await this.options.resolveImages(this.answer)
        if (resolved !== this.answer) {
          // Image rewriting works on the joined text, so the segment split is
          // collapsed here — the answer is final at this point anyway.
          this.setAnswerText(resolved)
          this.answerDirty = true
        }
      } catch (error) {
        this.options.log?.(`image resolve failed: ${error}`)
      }
    }
    if (this.dirty) {
      // The final flush carries the last of the answer, but it must never be
      // the reason a card stays unsealed: retry it once, then go on. Until the
      // seal lands, the card keeps its dots and a live 停止 button.
      try {
        await this.flushQueued()
      } catch (error) {
        this.options.log?.(`final flush failed (${String(error).slice(0, 120)}); retrying once`)
        await sleep(300).catch(() => undefined)
        try {
          await this.flushQueued()
        } catch (retryError) {
          this.options.log?.(
            `final flush failed again (${String(retryError).slice(0, 120)}); sealing anyway`,
          )
        }
      }
    }
    this.closed = true

    // Re-read the live footer source so the final numbers are the freshest
    // ones; only the status (and an explicit elapsed) come from the caller.
    const source: FooterInput = this.options.footerSource?.() ?? { status: '' }
    const elapsed =
      input.elapsed ?? source.elapsed ?? formatElapsed((this.options.now ?? Date.now)() - this.startedAt)
    const footer = this.buildFooter({ ...source, status: input.status, elapsed })
    const plan = buildSealPlan({
      panelContent: this.options.showPanel === false
        ? undefined
        : panelUpdate({
            steps: this.steps,
            model: this.options.panelModel?.(),
            rounds: this.options.panelRounds?.(),
            elapsedMs: this.elapsedMs(),
            reasoning: this.options.showReasoning ? this.reasoning : undefined,
            // The sealed card keeps the panel open only when the user asked for it;
            // otherwise the answer gets the whole card, as hermes does.
            expanded: this.options.panelExpanded,
          }),
      footer,
      // The chat-list / notification preview carries the answer, not the status
      // word — a conversation list full of 已完成 says nothing about the reply.
      summary: summaryFromAnswer(this.answer, footer.status),
      // The loading icon is only a "still working" hint: it goes away on seal,
      // and so does the stop button — a sealed turn has nothing left to stop.
      removeElementIds: this.options.sessionKey
        ? [LOADING_ICON_ID, STOP_BUTTON_ID]
        : [LOADING_ICON_ID],
      // Nothing below the process panel exists yet: the footer (and its divider)
      // is created HERE, which is why the plan inserts it instead of patching.
      footerPresent: false,
    })
    const report = await this.sealWithRetry(cardId, plan)
    // Only now is the card really finished: content frozen AND the plan landed.
    this.sealed = true
    // A long answer used to be clamped here and the tail was simply lost. Post
    // the remainder as follow-up cards (fire-and-forget: separate messages).
    const parts = this.answerParts()
    if (parts.length > 1) void this.sendContinuations(parts.slice(1))
    this.options.log?.(
      `sealed card ${cardId}: footer=${report.footerAdded} closed=${report.streamingClosed}`,
    )
    trace('card-seal', {
      cardId,
      status: input.status,
      batches: report.batchesRun,
      closed: report.streamingClosed,
      satisfied: report.satisfied,
      answerLength: this.answer.length,
      reasoningLength: this.reasoning.length,
    })
    // The footer element ships with the card, so it is present by construction;
    // only its content could fail, which would have thrown above.
    return { ...report, footerAdded: true }
  }

  /** Interrupted turn: seal with the stopped status, keep whatever streamed. */
  async abort(): Promise<SealReport | undefined> {
    return this.seal({ status: '已停止' })
  }

  /**
   * The card's message was recalled or deleted — stop writing to it.
   *
   * Feishu keeps accepting updates for a recalled card and renders nothing, so
   * every later flush is a wasted API call (and can burn the rate limit during
   * a long turn). hermes calls this the message-protection guard; without it a
   * user who recalls a runaway answer keeps paying for it invisibly.
   */
  markUnavailable(reason = 'recalled'): void {
    if (this.sealed) return
    // A recalled card cannot be written to at all: freeze everything, and mark
    // it "sealed" so no retry loop keeps hammering a message that is gone.
    this.closed = true
    this.sealed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    trace('card-unavailable', { cardId: this.cardId, reason })
  }

  private buildFooter(input: FooterInput): FooterInput {
    const picked: FooterInput = { status: input.status }
    const target = picked as unknown as Record<string, unknown>
    for (const field of this.options.footerFields) {
      if (field === 'status') continue
      const value = input[field]
      if (value) target[field] = value
    }
    return picked
  }

  private asApi(): CardApi {
    return {
      batchUpdate: (cardId, actions, sequence) =>
        this.options.transport.batchUpdate(cardId, actions, sequence),
      settings: (cardId, settings, sequence) =>
        this.options.transport.settings(cardId, settings, sequence),
    }
  }
}

/**
 * Wait without holding the process open.
 *
 * Used between seal retries: a host that is shutting down must not be kept alive
 * by a card that is still trying to finish itself.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    ;(timer as { unref?: () => void }).unref?.()
  })
}

/** 12.3s / 1m 39s — same shape as hermes' _format_elapsed. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

export { buildFooterElement }
