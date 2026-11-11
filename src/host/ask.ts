/**
 * Feishu-side `ask_user_question`.
 *
 * The problem this solves: DSH ships a global `ask_user_question` tool whose
 * only surface is the desktop GUI. A bridge-created agent that calls it blocks
 * on a dialog the Feishu user cannot see — the turn hangs until somebody opens
 * Harness, and from Feishu it looks like the bot simply never answered.
 *
 * Registering our own tool in the agent's scope shadows the global one
 * ("scoped tools shadow globals", `dsh-tools`), so the question is delivered to
 * the chat instead. Two answer paths, deliberately:
 *
 *   - a button per option (Card 2.0 `behaviors: callback` → `card.action.trigger`)
 *   - the user's next chat message, which needs no extra console configuration
 *
 * The second path is the safety net: card callbacks only arrive once the
 * developer console subscribes to them, and until then buttons would silently
 * do nothing. The card says so explicitly.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { trace } from './trace.ts'

/** One question as the model states it. */
export interface AskQuestion {
  id: string
  question: string
  header?: string
  options?: { label: string; description?: string }[]
  multi_select?: boolean
}

/** One answer, in the shape the host tool reports. */
export interface AskAnswer {
  id: string
  selected: string[]
  custom?: string
}

/** The narrow Feishu surface the asker needs (faked in tests). */
export interface AskTransport {
  /** Send a card into a chat; resolves to the id later updates use. */
  sendCard(chatId: string, card: unknown): Promise<string | undefined>
  /** Replace a previously sent card's content. */
  updateCard(cardId: string, card: unknown): Promise<void>
}

export interface FeishuAskUserOptions {
  transport: AskTransport
  /** Auto-cancel a question nobody answered (default 5 minutes). */
  timeoutMs?: number
  log?: (message: string) => void
}

interface PendingAsk {
  id: string
  sessionId: string
  chatId: string
  questions: AskQuestion[]
  /**
   * Answers gathered so far, keyed by question id.
   *
   * A batch can carry several questions (dsh's own tool takes an array), and
   * the card renders all of them. The previous version drew only `questions[0]`
   * while handing the one clicked option back as the answer to EVERY question —
   * so a two-question ask silently returned a fabricated second answer.
   */
  answers: Map<string, AskAnswer & { done: boolean }>
  resolve: (answers: AskAnswer[]) => void
  cardId?: string
  timer: ReturnType<typeof setTimeout>
}

/** Marker key inside a button's callback value, so we ignore foreign actions. */
const ASK_KEY = 'feishuCardAsk'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export class FeishuAskUser {
  private readonly pendings = new Map<string, PendingAsk>()
  private readonly timeoutMs: number
  private disposed = false

  constructor(private readonly options: FeishuAskUserOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Number of questions waiting for an answer (diagnostics). */
  get pendingCount(): number {
    return this.pendings.size
  }

  /** Remember which chat owns a session, so a tool call can find its way home. */
  bind(sessionId: string, chatId: string): void {
    this.chats.set(sessionId, chatId)
  }

  private readonly chats = new Map<string, string>()

  /**
   * Register the Feishu asker in one agent's scope.
   *
   * Called from the bridge's `setup`, i.e. before the first prompt assembly, so
   * the tool exists for the whole agent lifetime.
   */
  registerTool(agentCtx: Context): void {
    const tools = agentCtx.get('tools') as
      | { register(definition: unknown): unknown }
      | undefined
    if (!tools) {
      this.options.log?.('ask_user_question: no tools service on the agent context')
      return
    }
    tools.register(
      defineTool({
        name: 'ask_user_question',
        description:
          '向用户提问以获取确认、选择或缺失信息。问题会以卡片形式发到当前飞书会话，' +
          '用户点击选项按钮或直接回复消息即可回答；没有选项时只能直接回复消息。',
        parameters: {
          questions: {
            type: 'array',
            required: true,
            description: '要问用户的问题列表。',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string', required: true, description: '问题 id' },
                question: { type: 'string', required: true, description: '问题正文' },
                header: { type: 'string', description: '可选短标题' },
                options: {
                  type: 'array',
                  description: '可选项；省略则用户直接回复消息。',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      label: { type: 'string', required: true },
                      description: { type: 'string' },
                    },
                  },
                },
                multi_select: { type: 'boolean', description: '是否允许多选' },
              },
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              answers: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    selected: { type: 'array', required: true, items: { type: 'string' } },
                    custom: { type: 'string' },
                  },
                },
              },
            },
          },
          render: (_args, value) =>
            [
              {
                type: 'text',
                text: JSON.stringify(value),
              },
            ] as ContentBlock[],
        },
        // A question blocks the turn, so two of them must never overlap.
        isConcurrencySafe: () => false,
        execute: async (args, exec) => {
          const agent = exec.agent
          const sessionId = readSessionId(agent)
          const chatId = sessionId ? this.chats.get(sessionId) : undefined
          if (!sessionId || !chatId) {
            throw new Error('ask_user_question 需要由飞书会话驱动的 agent')
          }
          const questions = normalizeQuestions(args.questions)
          if (questions.length === 0) throw new Error('ask_user_question 至少需要一个问题')
          const answers = await this.ask(sessionId, chatId, questions, exec.signal)
          return { answers }
        },
      }),
    )
  }

  /** Ask one batch of questions and wait for the user's answer. */
  private async ask(
    sessionId: string,
    chatId: string,
    questions: AskQuestion[],
    signal?: AbortSignal,
  ): Promise<AskAnswer[]> {
    const id = `ask_${Math.random().toString(36).slice(2, 10)}`
    const pending: PendingAsk = {
      id,
      sessionId,
      chatId,
      questions,
      answers: new Map(),
      resolve: () => undefined,
      timer: setTimeout(() => {
        this.pendings.delete(id)
        trace('ask-timeout', { askId: id, sessionId })
        void this.settle(pending, '⏰ 等待超时，已取消本次提问。')
        pending.resolve(this.collected(pending))
      }, this.timeoutMs),
    }
    pending.timer.unref?.()
    this.pendings.set(id, pending)

    const answered = new Promise<AskAnswer[]>((resolve) => {
      pending.resolve = resolve
    })

    signal?.addEventListener(
      'abort',
      () => {
        if (!this.pendings.has(id)) return
        this.pendings.delete(id)
        clearTimeout(pending.timer)
        trace('ask-aborted', { askId: id, sessionId })
        void this.settle(pending, '已停止。')
        pending.resolve(this.collected(pending))
      },
      { once: true },
    )

    try {
      pending.cardId = await this.options.transport.sendCard(chatId, buildAskCard(pending))
      trace('ask-sent', {
        askId: id,
        sessionId,
        chatId,
        cardId: pending.cardId ?? null,
        questions: questions.length,
      })
    } catch (error) {
      this.pendings.delete(id)
      clearTimeout(pending.timer)
      trace('ask-send-failed', { askId: id, error: String(error) })
      throw new Error(`提问卡片发送失败：${error instanceof Error ? error.message : String(error)}`)
    }

    return answered
  }

  /**
   * Answers in question order, with unanswered questions reported as empty.
   *
   * An empty `selected` is an honest "nobody answered this one"; inventing a
   * value (the old behaviour) is worse than saying nothing.
   */
  private collected(pending: PendingAsk): AskAnswer[] {
    return pending.questions.map((question) => {
      const answer = pending.answers.get(question.id)
      return answer
        ? { id: question.id, selected: [...answer.selected], ...(answer.custom ? { custom: answer.custom } : {}) }
        : { id: question.id, selected: [] }
    })
  }

  private unansweredQuestions(pending: PendingAsk): AskQuestion[] {
    return pending.questions.filter((question) => !pending.answers.get(question.id)?.done)
  }

  /**
   * Route a card button click to its pending question.
   *
   * Returns the callback response (toast + the refreshed card, so Feishu
   * re-renders immediately) or undefined when the click was not ours.
   */
  async handleCardAction(
    data: unknown,
  ): Promise<
    | { toast?: { type: string; content: string }; card?: { type: string; data: unknown } }
    | undefined
  > {
    const value = readActionValue(data)
    if (!value || value[ASK_KEY] !== 'select') return undefined
    const askId = typeof value.askId === 'string' ? value.askId : undefined
    const option = typeof value.option === 'string' ? value.option : undefined
    const questionId = typeof value.questionId === 'string' ? value.questionId : undefined
    const confirm = value.confirm === true
    const pending = askId ? this.pendings.get(askId) : undefined
    if (!pending || (!option && !confirm)) return undefined
    const question = pending.questions.find((candidate) =>
      questionId ? candidate.id === questionId : true,
    )
    if (!question) return undefined

    const current = pending.answers.get(question.id) ?? { id: question.id, selected: [], done: false }
    if (confirm) {
      if (current.selected.length === 0 && !current.custom) return undefined
      pending.answers.set(question.id, { ...current, done: true })
    } else if (option) {
      // A multi-select question toggles; a single-select one commits at once.
      const selected = question.multi_select
        ? current.selected.includes(option)
          ? current.selected.filter((item) => item !== option)
          : [...current.selected, option]
        : [option]
      pending.answers.set(question.id, {
        id: question.id,
        selected,
        done: question.multi_select ? false : true,
      })
    }

    const remaining = this.unansweredQuestions(pending)
    const note = confirm
      ? `✅ 已确认：${(pending.answers.get(question.id)?.selected ?? []).join('、')}`
      : `✅ 已选择：${(pending.answers.get(question.id)?.selected ?? []).join('、')}`
    const done = remaining.length === 0
    if (done) {
      this.pendings.delete(pending.id)
      clearTimeout(pending.timer)
      trace('ask-answered', { askId: pending.id, questions: pending.questions.length })
      void this.settle(pending, '✅ 已全部回答。')
      pending.resolve(this.collected(pending))
    } else {
      trace('ask-partial', { askId: pending.id, remaining: remaining.length })
      void this.settle(pending, note)
    }
    return {
      toast: { type: 'success', content: note },
      // `card` must be wrapped as `{type:'raw', data}` — a bare card object is
      // rejected, and Feishu then answers the click with its own error toast
      // even though the selection itself went through.
      card: { type: 'raw', data: buildAskCard(pending, { note, settled: done }) },
    }
  }

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
  handleChatMessage(sessionId: string, text: string): boolean {
    let target: PendingAsk | undefined
    for (const pending of this.pendings.values()) {
      if (pending.sessionId === sessionId) target = pending
    }
    if (!target) return false
    const question = this.unansweredQuestions(target)[0]
    if (!question) return false

    target.answers.set(question.id, { id: question.id, selected: [], custom: text, done: true })
    const remaining = this.unansweredQuestions(target)
    trace('ask-answered-message', {
      askId: target.id,
      length: text.length,
      remaining: remaining.length,
    })
    if (remaining.length === 0) {
      this.pendings.delete(target.id)
      clearTimeout(target.timer)
      void this.settle(target, `✏️ 已收到你的回答：${text}`)
      target.resolve(this.collected(target))
      return true
    }
    void this.settle(target, `✏️ 已记录这一题：${text}`)
    return true
  }

  /**
   * Replace a pending ask's card with its current state.
   *
   * Takes the ask object rather than an id: by the time a question is answered
   * it may already have left the map, and looking it up again would silently
   * skip the refresh (leaving a stale, still-clickable card behind).
   */
  private async settle(pending: PendingAsk, note: string): Promise<void> {
    if (!pending.cardId) return
    try {
      const settled = this.unansweredQuestions(pending).length === 0
      await this.options.transport.updateCard(
        pending.cardId,
        buildAskCard(pending, { note, settled }),
      )
      trace('ask-card-updated', { askId: pending.id, cardId: pending.cardId })
    } catch (error) {
      // A card that cannot be refreshed must not lose the answer — the callback
      // response carries the same card, so the user still sees the result.
      this.options.log?.(`ask card refresh failed for ${pending.id}: ${error}`)
      trace('ask-card-update-failed', { askId: pending.id, error: String(error) })
    }
  }

  /** Cancel every pending question (plugin shutdown). */
  dispose(): void {
    this.disposed = true
    for (const pending of this.pendings.values()) {
      clearTimeout(pending.timer)
      pending.resolve(this.collected(pending))
    }
    this.pendings.clear()
  }
}

/**
 * Build the question card (Card 2.0).
 *
 * Every question in the batch gets its own block, and only the unanswered ones
 * carry buttons — a card that keeps offering a choice the user already made is
 * how a stale card ends up being clicked twice.
 */
export function buildAskCard(
  pending: {
    id: string
    questions: AskQuestion[]
    /** Collected answers; absent renders a pristine card. */
    answers?: Map<string, AskAnswer & { done: boolean }>
  },
  options: { note?: string; settled?: boolean } = {},
): unknown {
  const elements: unknown[] = []
  const collected = pending.answers ?? new Map<string, AskAnswer & { done: boolean }>()
  pending.questions.forEach((question, index) => {
    const prefix = pending.questions.length > 1 ? `**${index + 1}. ` : '**'
    const head = [question.header ? `**${question.header}**` : '', `${prefix}${question.question}**`]
      .filter(Boolean)
      .join('\n')
    const answer = collected.get(question.id)
    const choices = question.options ?? []
    const lines = [head]
    choices.forEach((choice, choiceIndex) => {
      const label = choiceIndex < 26 ? String.fromCharCode(65 + choiceIndex) : String(choiceIndex + 1)
      const mark = answer?.selected.includes(choice.label) ? '✅ ' : ''
      lines.push(`${mark}${label}. ${choice.label}`)
    })
    if (answer?.custom) lines.push(`✏️ ${answer.custom}`)
    if (choices.length === 0 && !answer?.done) {
      lines.push('', '直接回复消息输入你的答案。')
    }
    elements.push({
      tag: 'markdown',
      element_id: `ask_question_${index}`,
      content: lines.join('\n'),
      i18n_content: { zh_cn: lines.join('\n'), en_us: lines.join('\n') },
    })

    const answered = Boolean(answer?.done)
    if (answered || choices.length === 0) return
    const buttons: unknown[] = choices.map((choice, choiceIndex) => {
      const active = answer?.selected.includes(choice.label)
      return {
        tag: 'button',
        element_id: `ask_option_${index}_${choiceIndex}`,
        text: { tag: 'plain_text', content: choice.label.slice(0, 100) },
        // A multi-select keeps its picks visible by rendering them filled.
        type: active ? 'primary' : 'default',
        behaviors: [
          {
            type: 'callback',
            value: {
              [ASK_KEY]: 'select',
              askId: pending.id,
              questionId: question.id,
              option: choice.label,
            },
          },
        ],
      }
    })
    if (question.multi_select) {
      buttons.push({
        tag: 'button',
        element_id: `ask_confirm_${index}`,
        text: { tag: 'plain_text', content: '确认' },
        type: 'primary',
        behaviors: [
          {
            type: 'callback',
            value: {
              [ASK_KEY]: 'select',
              askId: pending.id,
              questionId: question.id,
              option: '确认',
              confirm: true,
            },
          },
        ],
      })
    }
    elements.push({
      tag: 'column_set',
      element_id: `ask_options_${index}`,
      columns: buttons.map((button) => ({
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [button],
      })),
    })
  })

  if (options.note) {
    elements.push({
      tag: 'markdown',
      element_id: 'ask_note',
      content: `**${options.note}**`,
      i18n_content: { zh_cn: `**${options.note}**`, en_us: `**${options.note}**` },
    })
  }

  return {
    schema: '2.0',
    config: { locales: ['zh_cn', 'en_us'] },
    body: { elements },
  }
}

/** Coerce whatever the model sent into our question shape. */
export function normalizeQuestions(input: unknown): AskQuestion[] {
  if (!Array.isArray(input)) return []
  const out: AskQuestion[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const question = typeof record.question === 'string' ? record.question : ''
    if (!id || !question) continue
    const options = Array.isArray(record.options)
      ? record.options
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return undefined
            const label = (entry as { label?: unknown }).label
            return typeof label === 'string' && label ? { label } : undefined
          })
          .filter((entry): entry is { label: string } => Boolean(entry))
      : []
    out.push({
      id,
      question,
      ...(typeof record.header === 'string' && record.header ? { header: record.header } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(record.multi_select === true ? { multi_select: true } : {}),
    })
  }
  return out
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
