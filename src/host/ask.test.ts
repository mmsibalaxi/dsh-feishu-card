/**
 * Feishu ask-user: the question must reach Feishu and the answer must come
 * back from Feishu.
 *
 * Regression guard for the live bug where an agent called `ask_user_question`,
 * the desktop GUI popped the question dialog, and the Feishu chat saw nothing
 * at all — the turn hung until someone opened Harness.
 */
import { describe, expect, it, vi } from 'vitest'
import { FeishuAskUser, buildAskCard, normalizeQuestions, type AskTransport } from './ask.ts'

function fakeTransport() {
  const sent: { chatId: string; card: unknown }[] = []
  const updated: { cardId: string; card: unknown }[] = []
  const transport: AskTransport = {
    async sendCard(chatId, card) {
      sent.push({ chatId, card })
      return `card_${sent.length}`
    },
    async updateCard(cardId, card) {
      updated.push({ cardId, card })
    },
  }
  return { transport, sent, updated }
}

function makeAsker(over: { timeoutMs?: number } = {}) {
  const fake = fakeTransport()
  const asker = new FeishuAskUser({ transport: fake.transport, ...over })
  return { asker, fake }
}

/** A minimal agent context exposing only what registerTool touches. */
function fakeAgentCtx() {
  const registered: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }[] = []
  return {
    registered,
    ctx: {
      get: (name: string) =>
        name === 'tools'
          ? {
              register(definition: {
                name: string
                execute: (args: unknown, exec: unknown) => Promise<unknown>
              }) {
                registered.push(definition)
              },
            }
          : undefined,
    } as never,
  }
}

const QUESTION = {
  id: 'city',
  question: '哪个城市？',
  options: [{ label: '北京' }, { label: '上海' }, { label: '广州' }, { label: '深圳' }],
}

/** The ask id the asker minted, read back out of the card it just sent. */
function askIdOf(card: unknown): string {
  const elements = (
    card as {
      body: {
        elements: {
          element_id?: string
          columns?: { elements: { behaviors: { value: { askId: string } }[] }[] }[]
        }[]
      }
    }
  ).body.elements
  const options = elements.find((element) => element.element_id?.startsWith('ask_options'))
  const button = options?.columns?.[0]?.elements?.[0]
  return button!.behaviors[0].value.askId
}

/** The first button of question N, for a click that targets a specific one. */
function optionButton(card: unknown, questionIndex = 0, optionIndex = 0) {
  const elements = (
    card as {
      body: {
        elements: {
          element_id?: string
          columns?: { elements: { behaviors: { value: Record<string, unknown> }[] }[] }[]
        }[]
      }
    }
  ).body.elements
  const row = elements.find((element) => element.element_id === `ask_options_${questionIndex}`)
  return row?.columns?.[optionIndex]?.elements[0]
}

describe('normalizeQuestions', () => {
  it('keeps well-formed questions and drops junk', () => {
    expect(normalizeQuestions([QUESTION, { id: 'x' }, null, 'nope'])).toEqual([QUESTION])
  })

  it('treats a missing options list as free-form', () => {
    expect(normalizeQuestions([{ id: 'q', question: '说说看' }])).toEqual([
      { id: 'q', question: '说说看' },
    ])
  })
})

describe('buildAskCard', () => {
  it('renders one callback button per option, tagged with its question', () => {
    const card = buildAskCard({ id: 'ask_1', questions: [QUESTION] }) as {
      body: { elements: { tag: string; element_id?: string; columns?: { elements: unknown[] }[] }[] }
    }
    const options = card.body.elements.find((element) => element.element_id === 'ask_options_0')
    const buttons = options?.columns?.flatMap((column) => column.elements) as {
      element_id: string
      behaviors: { value: { option: string; askId: string; questionId: string } }[]
    }[]
    expect(buttons.map((button) => button.element_id)).toEqual([
      'ask_option_0_0',
      'ask_option_0_1',
      'ask_option_0_2',
      'ask_option_0_3',
    ])
    expect(buttons[0].behaviors[0].value).toEqual({
      feishuCardAsk: 'select',
      askId: 'ask_1',
      questionId: 'city',
      option: '北京',
    })
    // No "custom input" button: typing in the chat is always the free-form path.
    expect(card.body.elements.some((element) => element.element_id === 'ask_custom')).toBe(false)
  })

  it('renders EVERY question in the batch, each with its own buttons', () => {
    // Regression: only questions[0] used to be drawn, while the one clicked
    // option was returned as the answer to all of them.
    const second = { id: 'tests', question: '要不要补测试？', options: [{ label: '要' }, { label: '不要' }] }
    const card = buildAskCard({ id: 'ask_2', questions: [QUESTION, second] }) as {
      body: { elements: { element_id?: string }[] }
    }
    const ids = card.body.elements.map((element) => element.element_id)
    expect(ids).toContain('ask_question_0')
    expect(ids).toContain('ask_question_1')
    expect(ids).toContain('ask_options_0')
    expect(ids).toContain('ask_options_1')
  })

  it('drops the buttons of a question once it is answered', () => {
    const answers = new Map([['city', { id: 'city', selected: ['上海'], done: true }]])
    const card = buildAskCard({ id: 'ask_3', questions: [QUESTION], answers }) as {
      body: { elements: { element_id?: string }[] }
    }
    expect(card.body.elements.map((element) => element.element_id)).not.toContain('ask_options_0')
  })

  it('ships schema 2.0 with both locales, like the streaming card', () => {
    const card = buildAskCard({ id: 'ask_1', questions: [QUESTION] }) as {
      schema: string
      config: { locales: string[] }
    }
    expect(card.schema).toBe('2.0')
    expect(card.config.locales).toEqual(['zh_cn', 'en_us'])
  })
})

describe('FeishuAskUser', () => {
  it('registers a tool that shadows the host GUI one', () => {
    const { asker } = makeAsker()
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    expect(agent.registered).toHaveLength(1)
    expect(agent.registered[0].name).toBe('ask_user_question')
  })

  it('delivers the question to the bound chat and resolves on a button click', async () => {
    const { asker, fake } = makeAsker()
    asker.bind('sess_1', 'oc_g1')
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    const tool = agent.registered[0]

    const pending = tool.execute(
      { questions: [QUESTION] },
      { agent: { id: 'sess_1' }, signal: new AbortController().signal },
    )
    // Let the card send settle.
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))
    expect(fake.sent[0].chatId).toBe('oc_g1')
    const askId = askIdOf(fake.sent[0].card)

    const response = await asker.handleCardAction({
      action: { value: { feishuCardAsk: 'select', askId, option: '上海' } },
    })
    expect(response?.toast?.content).toContain('上海')

    await expect(pending).resolves.toEqual({
      answers: [{ id: 'city', selected: ['上海'] }],
    })
    // The card is refreshed so a second click cannot answer again.
    expect(fake.updated).toHaveLength(1)
  })

  it('takes the next chat message as the answer, with no mode to enter', async () => {
    // Live bug: the message path was gated behind a "custom input" button, so a
    // user who simply typed the answer started a NEW TURN instead — the
    // question was never answered and its card hung on the loading state.
    const { asker, fake } = makeAsker()
    asker.bind('sess_1', 'oc_g1')
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    const tool = agent.registered[0]

    const pending = tool.execute(
      { questions: [QUESTION] },
      { agent: { id: 'sess_1' }, signal: new AbortController().signal },
    )
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))

    // Straight to typing — no button press first.
    expect(asker.handleChatMessage('sess_1', '北京')).toBe(true)

    await expect(pending).resolves.toEqual({
      answers: [{ id: 'city', selected: [], custom: '北京' }],
    })
  })

  it('ignores a chat message when no question is open', () => {
    const { asker } = makeAsker()
    expect(asker.handleChatMessage('sess_1', '随便说说')).toBe(false)
  })

  it('ignores card actions that are not ours', async () => {
    const { asker } = makeAsker()
    await expect(asker.handleCardAction({ action: { value: { other: 'x' } } })).resolves.toBeUndefined()
    await expect(asker.handleCardAction(undefined)).resolves.toBeUndefined()
  })

  it('echoes the settled card back so the pick is visible immediately', async () => {
    // A click used to produce only a toast: the card kept its buttons and no
    // "selected" state, so the user could not tell whether it registered.
    const { asker, fake } = makeAsker()
    asker.bind('sess_1', 'oc_g1')
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    const pending = agent.registered[0].execute(
      { questions: [QUESTION] },
      { agent: { id: 'sess_1' }, signal: new AbortController().signal },
    )
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))
    const askId = askIdOf(fake.sent[0].card)

    const response = await asker.handleCardAction({
      action: { value: { feishuCardAsk: 'select', askId, option: '北京' } },
    })
    expect(response?.toast?.content).toContain('北京')
    // `card` must be wrapped as {type:'raw', data} — a bare card object makes
    // Feishu answer the click with its own error toast even though the
    // selection itself went through.
    expect(response?.card).toEqual({ type: 'raw', data: expect.objectContaining({ schema: '2.0' }) })
    const echoed = JSON.stringify(response?.card?.data)
    expect(echoed).toContain('✅ A. 北京')
    expect(echoed).toContain('已选择：北京')
    expect(echoed).not.toContain('ask_options')
    expect(fake.updated).toHaveLength(1)
    await expect(pending).resolves.toEqual({
      answers: [{ id: 'city', selected: ['北京'] }],
    })
  })

  it('collects answers per question instead of copying one option into all', async () => {
    const second = { id: 'tests', question: '要不要补测试？', options: [{ label: '要' }, { label: '不要' }] }
    const { asker, fake } = makeAsker()
    asker.bind('sess_1', 'oc_g1')
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    const pending = agent.registered[0].execute(
      { questions: [QUESTION, second] },
      { agent: { id: 'sess_1' }, signal: new AbortController().signal },
    )
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))
    const card = fake.sent[0].card
    const askId = askIdOf(card)

    const first = optionButton(card, 0, 1)!.behaviors[0].value
    await asker.handleCardAction({ action: { value: first } })
    // Not resolved yet: the second question is still open.
    expect(asker.pendingCount).toBe(1)

    const secondValue = optionButton(card, 1, 0)!.behaviors[0].value
    await asker.handleCardAction({ action: { value: secondValue } })

    await expect(pending).resolves.toEqual({
      answers: [
        { id: 'city', selected: ['上海'] },
        { id: 'tests', selected: ['要'] },
      ],
    })
    expect(askId).toBeTruthy()
  })

  it('cancels a pending question when the turn is aborted', async () => {
    const { asker, fake } = makeAsker()
    asker.bind('sess_1', 'oc_g1')
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    const controller = new AbortController()
    const pending = agent.registered[0].execute(
      { questions: [QUESTION] },
      { agent: { id: 'sess_1' }, signal: controller.signal },
    )
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))
    controller.abort()
    // An unanswered question is reported as an empty selection — never as a
    // made-up answer.
    await expect(pending).resolves.toEqual({ answers: [{ id: 'city', selected: [] }] })
    expect(asker.pendingCount).toBe(0)
  })

  it('times out instead of hanging the turn forever', async () => {
    vi.useFakeTimers()
    try {
      const { asker, fake } = makeAsker({ timeoutMs: 1000 })
      asker.bind('sess_1', 'oc_g1')
      const agent = fakeAgentCtx()
      asker.registerTool(agent.ctx)
      const pending = agent.registered[0].execute(
        { questions: [QUESTION] },
        { agent: { id: 'sess_1' }, signal: new AbortController().signal },
      )
      await vi.advanceTimersByTimeAsync(10)
      expect(fake.sent).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toEqual({ answers: [{ id: 'city', selected: [] }] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to ask without a bound chat rather than blocking silently', async () => {
    const { asker } = makeAsker()
    const agent = fakeAgentCtx()
    asker.registerTool(agent.ctx)
    await expect(
      agent.registered[0].execute(
        { questions: [QUESTION] },
        { agent: { id: 'unknown' }, signal: new AbortController().signal },
      ),
    ).rejects.toThrow(/飞书会话/)
  })
})
