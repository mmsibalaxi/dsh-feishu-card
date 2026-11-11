import { describe, expect, it, vi } from 'vitest'
import { StreamingCard, formatElapsed, type CardTransport, type StreamingCardOptions } from './streaming.ts'
import type { FooterField } from '../../shared/types.js'
const FOOTER_FIELDS: FooterField[] = ['status', 'model', 'context', 'elapsed']
/** CardKit wire action: `{action, params}` (NOT flat `{kind, element_id, content}`). */
interface Action {
  action: string
  params: {
    element_id?: string
    partial_element?: { content?: string; text?: { content?: string } }
    element_ids?: string[]
  }
}

const idOf = (action: unknown): string | undefined => (action as Action).params?.element_id
const textOf = (action: unknown): string => (action as Action).params?.partial_element?.content ?? ''

function fakeTransport() {
  const created: unknown[] = []
  const batches: { actions: unknown[]; sequence: number }[] = []
  const settings: { settings: unknown; sequence: number }[] = []
  /** Message ids the card was posted as a reply to. */
  const replyTo: (string | undefined)[] = []
  const transport: CardTransport = {
    async createCard(_chatId, card, replyToMessageId) {
      created.push(card)
      replyTo.push(replyToMessageId)
      return 'card_1'
    },
    async updateCard() {},
    async batchUpdate(_cardId, actions, sequence) {
      batches.push({ actions, sequence })
    },
    async settings(_cardId, value, sequence) {
      settings.push({ settings: value, sequence })
    },
  }
  return { transport, created, batches, settings, replyTo }
}

function makeCard(over: Partial<StreamingCardOptions> = {}) {
  const fake = fakeTransport()
  const card = new StreamingCard({
    transport: fake.transport,
    chatId: 'oc_g1',
    footerFields: FOOTER_FIELDS,
    flushIntervalMs: 0,
    ...over,
  })
  return { card, fake }
}

describe('formatElapsed', () => {
  it('formats like hermes', () => {
    expect(formatElapsed(400)).toBe('400ms')
    expect(formatElapsed(4200)).toBe('4.2s')
    expect(formatElapsed(54600)).toBe('54.6s')
    expect(formatElapsed(99000)).toBe('1m 39s')
  })
})

/**
 * Every footer text the card ever wrote, oldest first.
 *
 * The footer does not exist until the turn seals — it arrives through
 * `add_elements` together with its divider — so this reads both patch actions
 * and added element arrays.
 */
function footerTexts(fake: ReturnType<typeof fakeTransport>): string[] {
  const out: string[] = []
  for (const batch of fake.batches) {
    for (const action of batch.actions as (Action & { params: { elements?: unknown[] } })[]) {
      if (idOf(action) === 'footer_status') out.push(textOf(action))
      for (const element of action.params?.elements ?? []) {
        const built = element as { element_id?: string; content?: string }
        if (built.element_id === 'footer_status') out.push(built.content ?? '')
      }
    }
  }
  return out
}

/** Last footer text written (patched or added). */
function lastFooter(fake: ReturnType<typeof fakeTransport>): string | undefined {
  return footerTexts(fake).at(-1)
}

/** Element ids the initial card shipped, in order. */
function createdIds(fake: ReturnType<typeof fakeTransport>): (string | undefined)[] {
  const card = fake.created[0] as { body: { elements: { element_id?: string }[] } }
  return card.body.elements.map((element) => element.element_id)
}

describe('StreamingCard', () => {
  it('creates a schema-2.0 streaming card', async () => {
    const { card, fake } = makeCard()
    await card.start()
    const built = fake.created[0] as { schema: string; config: { streaming_mode: boolean } }
    expect(built.schema).toBe('2.0')
    expect(built.config.streaming_mode).toBe(true)
    expect(card.id).toBe('card_1')
  })

  it('start() is idempotent', async () => {
    const { card, fake } = makeCard()
    await card.start()
    await card.start()
    expect(fake.created).toHaveLength(1)
  })

  it('flushes only what changed: a text delta sends the answer element alone', async () => {
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('hello ')
    card.pushAnswer('world')
    await card.flush()
    expect(fake.batches).toHaveLength(1)
    expect(fake.batches[0].sequence).toBe(1)
    const actions = fake.batches[0].actions as Action[]
    // No panel action: nothing changed there, and re-sending the whole panel on
    // every text delta is what made the typewriter arrive in bursts.
    expect(actions).toHaveLength(1)
    expect(actions.map(idOf)).toEqual(['answer_content'])
    expect(textOf(actions[0])).toContain('hello world')
  })

  it('a tool event sends the panel alone', async () => {
    const { card, fake } = makeCard()
    await card.start()
    card.toolStart('c1', 'web_search', 1000, '北京 天气')
    await card.flush()
    const actions = fake.batches[0].actions as Action[]
    expect(actions.map(idOf)).toEqual(['agent_process_panel'])
  })

  it('the panel rides a much slower clock than the text', async () => {
    // Text at 100ms, panel at 2s. Measured live (2026-11-10): 72% of card writes
    // carried no new text, median gap 913ms — a tool row must not keep taking a
    // round trip out of the typewriter's budget.
    vi.useFakeTimers()
    try {
      const { card, fake } = makeCard({ flushIntervalMs: 100 })
      await card.start()
      card.toolStart('c1', 'web_search', 1000)
      await vi.advanceTimersByTimeAsync(150)
      expect(fake.batches).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1900)
      expect(fake.batches).toHaveLength(1)
      card.pushAnswer('嗯')
      await vi.advanceTimersByTimeAsync(150)
      expect(fake.batches).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('posts the tail of a long answer as continuation cards instead of dropping it', async () => {
    // >13KB used to be silently clamped; Hermes splits the segments across cards.
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('汉'.repeat(8000)) // 24 KB → more than one card
    await card.flush()
    const flush = fake.batches.at(-1)?.actions as Action[]
    expect(textOf(flush[0])).toContain('已续到下一张卡片')

    await card.seal({ status: '已完成' })
    // Continuations are posted fire-and-forget: let them land.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.created.length).toBeGreaterThan(1)
    const continuation = JSON.stringify(fake.created[1])
    expect(continuation).toContain('汉')
    // A continuation is a static card, not another streaming one.
    expect(continuation).not.toContain('streaming_mode')
  })

  it('keeps every step: a later step adds a paragraph instead of rewriting the card', async () => {    // Multi-step turns used to replace the whole answer with the last step's
    // text, so the card visibly rewound (Hermes appends segments).
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('先查一下')
    card.setAnswer('先查一下')
    card.newSegment()
    card.pushAnswer('北京今天晴')
    card.setAnswer('北京今天晴')
    await card.flush()
    expect(textOf((fake.batches[0].actions as Action[])[0])).toContain('先查一下\n\n北京今天晴')
    expect(card.text).toBe('先查一下\n\n北京今天晴')
  })

  it('throttles flushes to one per interval', async () => {
    vi.useFakeTimers()
    try {
      const { card, fake } = makeCard({ flushIntervalMs: 500 })
      await card.start()
      card.pushAnswer('a')
      card.pushAnswer('b')
      await vi.advanceTimersByTimeAsync(600)
      expect(fake.batches).toHaveLength(1)
      card.pushAnswer('c')
      await vi.advanceTimersByTimeAsync(600)
      expect(fake.batches).toHaveLength(2)
      const last = fake.batches[1].actions as Action[]
      expect(textOf(last[0])).toContain('abc')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sanitizes the streamed answer (asterisk escaping survives the card)', async () => {
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('2*4000+4*3000')
    await card.flush()
    const actions = fake.batches[0].actions as Action[]
    expect(textOf(actions[0])).toContain('2\\*4000')
  })

  it('ships no footer while the turn runs — the status line is a result', async () => {
    // User feedback 2026-11-09: a running card printed 思考中 under the answer,
    // so the card looked busier than the thing it was showing. The footer (and
    // its divider) is now created by the seal plan, together with the status.
    const { card, fake } = makeCard({
      footerSource: () => ({ status: '处理中', model: 'deepseek-chat', context: '0/65.5K (0%)' }),
    })
    await card.start()
    expect(createdIds(fake)).toEqual(['answer_content', 'agent_process_panel', 'loading_icon'])
    expect(footerTexts(fake)).toEqual([])
  })

  it('posts the card as a quoted reply to the triggering message', async () => {
    // A reply makes Feishu render the "回复 XXX" header, so an answer is
    // visibly attached to the message it answers.
    const fake = fakeTransport()
    const card = new StreamingCard({
      transport: fake.transport,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
      replyToMessageId: 'om_trigger',
    })
    await card.start()
    expect(fake.replyTo).toEqual(['om_trigger'])
  })

  it('adds the footer (with its divider) on seal and closes streaming exactly once', async () => {
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('done')
    const report = await card.seal({ status: '已完成' })
    expect(report?.footerAdded).toBe(true)
    expect(report?.streamingClosed).toBe(true)
    expect(fake.settings).toHaveLength(1)
    // flush → panel refresh → add [divider, footer] → delete the dots row.
    const kinds = fake.batches.map((batch) => (batch.actions[0] as Action).action)
    expect(kinds).toEqual([
      'partial_update_element',
      'partial_update_element',
      'add_elements',
      'delete_elements',
    ])
    const added = fake.batches[2].actions as (Action & {
      params: { type?: string; target_element_id?: string; elements?: { element_id?: string }[] }
    })[]
    // Inserted before the loading icon, which still exists at this point: the
    // deletes run in later batches on purpose (a grouped delete whose sibling
    // is already gone takes the whole batch down).
    expect(added[0].params.type).toBe('insert_before')
    expect(added[0].params.target_element_id).toBe('loading_icon')
    expect(added[0].params.elements?.map((element) => element.element_id)).toEqual([
      'footer_hr',
      'footer_status',
    ])
    expect(lastFooter(fake)).toContain('已完成')
  })

  it('footer honours the configured field list and order', async () => {
    const { card, fake } = makeCard({
      footerFields: ['status', 'elapsed'],
      footerSource: () => ({ status: '思考中', model: 'should-not-show', context: 'nope' }),
    })
    await card.start()
    // Nothing is rendered while the turn runs.
    expect(footerTexts(fake)).toEqual([])
    await card.seal({ status: '已完成' })
    // Only the configured fields appear, at even weight.
    expect(lastFooter(fake)).toContain('已完成')
    expect(lastFooter(fake)).not.toContain('should-not-show')
    expect(lastFooter(fake)).not.toContain('思考中')
  })

  it('seal() is idempotent', async () => {
    const { card, fake } = makeCard()
    await card.start()
    await card.seal({ status: '已完成' })
    await card.seal({ status: '已完成' })
    expect(fake.settings).toHaveLength(1)
  })

  it('abort() seals with the stopped status and keeps streamed text', async () => {
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('partial answer')
    await card.abort()
    expect(lastFooter(fake)).toContain('已停止')
  })

  it('ignores pushes after sealing', async () => {
    const { card, fake } = makeCard()
    await card.start()
    await card.seal({ status: '已完成' })
    const before = fake.batches.length
    card.pushAnswer('late text')
    await card.flush()
    expect(fake.batches.length).toBe(before)
  })

  // ── the two regressions that produced a card with no answer ──
  it('deltas that arrive before start() are not lost', async () => {
    // The model is routinely faster than two round trips to Feishu, so text
    // can land before the card exists. start() must flush what is pending.
    const { card, fake } = makeCard()
    card.pushAnswer('第一段')
    card.pushAnswer('第二段')
    expect(card.delivered).toBe(false)
    await card.start()
    expect(card.delivered).toBe(true)
    expect(fake.batches).toHaveLength(1)
    const actions = fake.batches[0].actions as Action[]
    expect(textOf(actions[0])).toContain('第一段第二段')
  })

  it('delivered needs the card AND a batch that actually carried the answer', async () => {
    // "delivered" drives the text fallback. It must mean "the answer is on the
    // card", not "a card id exists and text was buffered" — the old reading let
    // a card whose every write failed suppress the text reply entirely.
    const { card } = makeCard()
    expect(card.delivered).toBe(false)
    await card.start()
    expect(card.delivered).toBe(false)
    card.pushAnswer('答案')
    expect(card.delivered).toBe(false)
    await card.flush()
    expect(card.delivered).toBe(true)
  })

  it('delivered stays false when the flush never lands', async () => {
    const fake = fakeTransport()
    const broken: CardTransport = {
      ...fake.transport,
      async batchUpdate() {
        throw new Error('cardkit says no')
      },
    }
    const card = new StreamingCard({
      transport: broken,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
    })
    await card.start()
    card.pushAnswer('重要答案')
    await expect(card.flush()).rejects.toThrow(/cardkit says no/)
    expect(card.delivered).toBe(false)
    // …so the caller still sends the answer as plain text.
  })

  it('a failed flush keeps the answer dirty so the next one retries', async () => {
    // Without this, one rejected batchUpdate silently drops the buffered text
    // and every later flush writes a stale (empty) answer.
    const fake = fakeTransport()
    let failNext = true
    const flaky: CardTransport = {
      ...fake.transport,
      async batchUpdate(_cardId, actions, sequence) {
        if (failNext) {
          failNext = false
          throw Object.assign(new Error('batchUpdate failed: code=300309'), { code: 300309 })
        }
        return fake.transport.batchUpdate(_cardId, actions, sequence)
      },
    }
    const card = new StreamingCard({
      transport: flaky,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
    })
    await card.start()
    card.pushAnswer('重要答案')
    await expect(card.flush()).rejects.toThrow(/300309/)
    // The buffered text survived the failure.
    expect(card.text).toBe('重要答案')
    await card.flush()
    expect(fake.batches).toHaveLength(1)
    const actions = fake.batches[0].actions as Action[]
    expect(textOf(actions[0])).toContain('重要答案')
  })

  it('renders tool steps with durations in the panel, no reasoning', async () => {
    // The user asked for a lean panel: the reasoning scratchpad must not be
    // rendered (hermes gates it behind `show_reasoning`).
    const fake = fakeTransport()
    const card = new StreamingCard({
      transport: fake.transport,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
      panelModel: () => 'step-5-preview',
    })
    await card.start()
    card.pushReasoning('用户问天气，我需要先查一下…')
    card.toolStart('c1', 'web_search', 1000, '北京 天气')
    card.toolEnd('c1', 3200)
    card.toolStart('c2', 'web_fetch', 3200, 'https://m.tianqi.com/…')
    await card.flush()

    const panel = (fake.batches[0].actions as Action[]).find(
      (action) => idOf(action) === 'agent_process_panel',
    )
    const body = JSON.stringify(panel?.params.partial_element)
    // Tools are in, each with its duration; the reasoning text is nowhere.
    expect(body).toContain('web_search')
    expect(body).toContain('web_fetch')
    expect(body).toContain('2.2s')
    expect(body).not.toContain('我需要先查一下')
    expect(body).not.toContain('思考')
    // The collapsed header carries model + rounds + tools + elapsed; the model
    // glyph is the coloured 💠 (a monochrome ✦ cannot be coloured in a
    // plain_text header — user feedback 2026-11-09).
    expect(body).toContain('💠 step-5-preview')
    expect(body).toContain('🫧 0')
    expect(body).toContain('✨ 2')
    // partial_element must not carry a tag (Feishu forbids changing it).
    expect(panel?.params.partial_element).not.toHaveProperty('tag')
  })

  it('a rejected write never escapes as an unhandled rejection', async () => {
    // The timer's flush is fire-and-forget, so a re-thrown transport error
    // became an unhandled rejection and took the whole host process down:
    //   dsh: fatal load failure: batchUpdate failed: code=300317
    //     at async StreamingCard.flush
    const rejections: unknown[] = []
    const onRejection = (error: unknown) => rejections.push(error)
    process.on('unhandledRejection', onRejection)
    try {
      const transport: CardTransport = {
        async createCard() {
          return 'card_x'
        },
        async updateCard() {},
        async batchUpdate() {
          throw Object.assign(new Error('batchUpdate failed: code=300317'), { code: 300317 })
        },
        async settings() {},
      }
      const card = new StreamingCard({
        transport,
        chatId: 'oc_g1',
        footerFields: FOOTER_FIELDS,
        flushIntervalMs: 0,
        // Every write fails in this test; keep the seal's backoff out of it.
        sealRetryDelaysMs: [0, 0],
      })
      await card.start()
      card.pushAnswer('会崩的这句话')
      // Let the timer fire and the write chain settle.
      await new Promise((resolve) => setTimeout(resolve, 30))
      // The buffered text is kept for a retry, not lost.
      expect(card.text).toBe('会崩的这句话')
      // Sealing must still run (it awaits the same chain); the bridge wraps
      // seal() in a try/catch, so a throw here is expected and contained.
      await card.seal({ status: '已完成' }).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('serializes concurrent writes so sequences never collide', async () => {
    // 300317 "sequence number compare failed" is Feishu's answer when two
    // writes race; all card writes go through one chain to prevent it.
    const seen: number[] = []
    const transport: CardTransport = {
      async createCard() {
        return 'card_s'
      },
      async updateCard() {},
      async batchUpdate(_cardId, _actions, sequence) {
        seen.push(sequence)
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
      async settings() {},
    }
    const card = new StreamingCard({
      transport,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
    })
    await card.start()
    card.pushAnswer('a')
    card.pushAnswer('b')
    await Promise.all([card.flush(), card.flush(), card.flush()])
    expect(seen).toEqual([...seen].sort((x, y) => x - y))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('two concurrent seals run the plan once (300317 regression)', async () => {
    // `turn/end` and `agent/status: idle` both fire for the same turn, a few
    // milliseconds apart. `sealed` only flips after an await, so both used to
    // run the plan and the second sent a duplicate sequence — CardKit answers
    // 300317 and the seal fails, leaving the card unsealed.
    const fake = fakeTransport()
    const card = new StreamingCard({
      transport: fake.transport,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
    })
    await card.start()
    card.pushAnswer('答案')
    const [first, second] = await Promise.all([
      card.seal({ status: '已完成' }),
      card.seal({ status: '已完成' }),
    ])
    expect(first?.streamingClosed).toBe(true)
    expect(second).toBe(first)
    expect(fake.settings).toHaveLength(1)
    const sequences = fake.batches.map((batch) => batch.sequence)
    expect(new Set(sequences).size).toBe(sequences.length)
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
  })

  // ── the "finished card still shows 思考中 + 停止" regression (2026-11-10) ──

  it('retries the seal when one batch fails, so the dots and stop button still go', async () => {
    // Live symptom: the answer was complete but the loading icon and ◯ 停止 were
    // still on the card, because the seal plan threw once and `sealed` had
    // already been set — nothing could ever try again.
    const fake = fakeTransport()
    let failures = 1
    const flaky: CardTransport = {
      ...fake.transport,
      async batchUpdate(_cardId, actions, sequence) {
        if (failures > 0) {
          failures -= 1
          throw Object.assign(new Error('batchUpdate failed: code=300317'), { code: 300317 })
        }
        return fake.transport.batchUpdate(_cardId, actions, sequence)
      },
    }
    const card = new StreamingCard({
      transport: flaky,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
      sealRetryDelaysMs: [0, 0],
    })
    await card.start()
    card.pushAnswer('答案')
    const report = await card.seal({ status: '已完成' })
    expect(report?.streamingClosed).toBe(true)
    // The deletes that remove the dots/stop eventually went through.
    const removed = fake.batches
      .flatMap((batch) => batch.actions as Action[])
      .filter((action) => action.action === 'delete_elements')
      .flatMap((action) => action.params.element_ids ?? [])
    expect(removed).toContain('loading_icon')
    // And the retry never reused a sequence number.
    const sequences = fake.batches.map((batch) => batch.sequence)
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('stays retryable when every seal attempt fails', async () => {
    const fake = fakeTransport()
    let failing = true
    const flaky: CardTransport = {
      ...fake.transport,
      async batchUpdate(_cardId, actions, sequence) {
        if (failing) throw Object.assign(new Error('code=300317'), { code: 300317 })
        return fake.transport.batchUpdate(_cardId, actions, sequence)
      },
    }
    const card = new StreamingCard({
      transport: flaky,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
      // No backoff in a test: the retry count is what matters here.
      sealRetryDelaysMs: [0],
    })
    await card.start()
    card.pushAnswer('答案')
    await expect(card.seal({ status: '已完成' })).rejects.toThrow(/300317/)
    // `sealed` must NOT be sticky: a later event (or the bridge's fallback) can
    // try again, which is the whole point.
    failing = false
    const report = await card.seal({ status: '已完成' })
    expect(report?.streamingClosed).toBe(true)
  })

  it('a seal requested before the card exists is honoured by start()', async () => {
    // A blocked turn ends in milliseconds; without this the card was created
    // afterwards and stayed on "正在加载上下文…" forever.
    const fake = fakeTransport()
    const card = new StreamingCard({
      transport: fake.transport,
      chatId: 'oc_g1',
      footerFields: FOOTER_FIELDS,
      flushIntervalMs: 0,
    })
    await expect(card.seal({ status: '已拦截' })).resolves.toBeUndefined()
    await card.start()
    expect(lastFooter(fake)).toContain('已拦截')
    // Streaming is closed, so the card is not stuck in its loading state.
    expect(fake.settings).toHaveLength(1)
  })

  it('stays quiet while waiting (the loading icon animates client-side), then deletes it on seal', async () => {
    // The indicator is a Feishu-hosted animated icon, so waiting costs nothing:
    // no dots ticker, no card write, no sequence to race the answer flush.
    vi.useFakeTimers()
    try {
      const fake = fakeTransport()
      const card = new StreamingCard({
        transport: fake.transport,
        chatId: 'oc_g1',
        footerFields: FOOTER_FIELDS,
        flushIntervalMs: 0,
      })
      await card.start()
      await vi.advanceTimersByTimeAsync(2500)
      expect(fake.batches).toHaveLength(0)

      card.pushAnswer('北京今天晴')
      await vi.advanceTimersByTimeAsync(2000)
      expect(fake.batches).toHaveLength(1)
      const flush = fake.batches[0].actions as Action[]
      expect(flush.map(idOf)).toEqual(['answer_content'])
      expect(textOf(flush[0])).toContain('北京今天晴')
      expect(lastFooter(fake)).toBeUndefined()

      // Sealing removes the loading icon (and nothing else, without a session).
      await card.seal({ status: '已完成' })
      const deletes = fake.batches
        .flatMap((batch) => batch.actions as Action[])
        .filter((action) => action.action === 'delete_elements')
      expect(deletes.map((action) => action.params.element_ids)).toEqual([['loading_icon']])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ships a stop button when it knows its conversation, and removes it on seal', async () => {
    const { card, fake } = makeCard({ sessionKey: 'oc_g1', stopOwnerOpenId: 'ou_a' } as never)
    await card.start()
    const initial = JSON.stringify(fake.created[0])
    expect(initial).toContain('stop_row')
    expect(initial).toContain('feishuCardStop')
    // The button carries the owner so the runtime can refuse someone else's
    // click (Feishu renders one card for the whole chat).
    expect(initial).toContain('"ownerOpenId":"ou_a"')
    // Bottom-right: a weighted spacer column pushes the button to the edge.
    const row = (fake.created[0] as {
      body: { elements: { element_id?: string; columns?: { width?: string; elements?: unknown[] }[] }[] }
    }).body.elements.find((element) => element.element_id === 'stop_row')
    expect(row?.columns?.map((column) => column.width)).toEqual(['weighted', 'auto'])
    // A red hollow circle, not the blue ⏹ square: `danger` is what colours it.
    const button = row?.columns?.[1]?.elements?.[0] as {
      type?: string
      text?: { content?: string }
    }
    expect(button.type).toBe('danger')
    expect(button.text?.content).toBe('◯ 停止')
    await card.seal({ status: '已完成' })
    const deletes = fake.batches.flatMap((batch) =>
      (batch.actions as Action[]).filter((action) => action.action === 'delete_elements'),
    )
    const removed = deletes.flatMap((action) =>
      action.action === 'delete_elements' ? action.params.element_ids : [],
    )
    expect(removed).toContain('stop_row')
  })

  it('seals with the answer as the card summary, not the status word', async () => {
    // Feishu shows `config.summary` in the chat list and the notification. It
    // used to be the status ("已完成"), so every conversation preview said the
    // same nothing (user feedback 2026-11-09).
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('## 结论\n**江澈**，本公司的同事（不是外部人员）\n\n- 详情见下一节')
    await card.seal({ status: '已完成' })
    const written = fake.settings[0].settings as {
      config: { summary: { content: string }; streaming_mode: boolean }
    }
    expect(written.config.streaming_mode).toBe(false)
    expect(written.config.summary.content).toContain('江澈')
    expect(written.config.summary.content).not.toContain('已完成')
    expect(written.config.summary.content).not.toContain('**')
    expect(written.config.summary.content.length).toBeLessThanOrEqual(60)
  })

  it('stops writing once the card was recalled', async () => {
    const { card, fake } = makeCard()
    await card.start()
    card.pushAnswer('第一段')
    await card.flush()
    const before = fake.batches.length

    card.markUnavailable('recalled')
    card.pushAnswer('第二段')
    await card.flush()
    expect(fake.batches.length).toBe(before)
    // Sealing a recalled card is a no-op too: nothing would render anyway.
    await card.seal({ status: '已完成' })
    expect(fake.batches.length).toBe(before)
  })
})
