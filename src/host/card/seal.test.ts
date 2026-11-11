import { describe, expect, it } from 'vitest'
import {
  CardApiError,
  CARDKIT_DUPLICATE_ID,
  CARDKIT_INSERT_TARGET_GONE,
  CARDKIT_STREAMING_CLOSED,
  buildFooterElement,
  buildSealPlan,
  runSealPlan,
  summaryFromAnswer,
  type CardApi,
  type SealAction,
} from './seal.ts'

const plan = (over: Partial<Parameters<typeof buildSealPlan>[0]> = {}) =>
  buildSealPlan({
    // Inner fields only, exactly what panelUpdate() produces.
    panelContent: { elements: [{ tag: 'markdown', content: 'done' }] },
    footer: { status: '已完成', model: 'deepseek-chat', context: '31.1K/1.0M (3%)', elapsed: '12.3s' },
    summary: '已完成',
    removeElementIds: ['loading_icon'],
    ...over,
  })

/** Records every call so tests can assert order and shape. */
function fakeApi(behaviour: (actions: unknown[], call: number) => void = () => undefined) {
  const calls: { actions: unknown[] }[] = []
  const api: CardApi = {
    async batchUpdate(_cardId, actions) {
      const index = calls.length
      calls.push({ actions })
      behaviour(actions, index)
    },
    async settings() {
      calls.push({ actions: ['settings'] })
    },
  }
  return { api, calls }
}

describe('buildFooterElement', () => {
  it('renders the status bar: coloured model glyph, full-width gaps, even weight', () => {
    const element = buildFooterElement({
      status: '已完成',
      model: 'step-5-preview',
      context: '18.4K/1.0M (2%)',
      elapsed: '5.7s',
    }) as { content: string; text_size: string; element_id: string }
    // No `·` separators: they read as stray periods at notation size. No bold:
    // the status must not shout over the metrics.
    expect(element.content).toBe('已完成　💠 step-5-preview　18.4K/1.0M (2%)　5.7s')
    expect(element.content).not.toContain('·')
    expect(element.content).not.toContain('**')
    expect(element.text_size).toBe('notation')
    expect(element.element_id).toBe('footer_status')
  })

  it('omits missing fields', () => {
    const element = buildFooterElement({ status: '运行中', elapsed: '35.6s' }) as { content: string }
    expect(element.content).toBe('运行中　35.6s')
  })

  it('paints a negative status red, and only the status', () => {
    // User feedback 2026-11-10: 已停止 should read as a warning, not as another
    // grey metric. 已完成 stays plain — it is not a warning.
    const stopped = buildFooterElement({
      status: '已停止',
      model: 'deepseek-v4.1-flash',
      elapsed: '9.6s',
    }) as { content: string }
    expect(stopped.content).toBe(
      "<font color='red'>已停止</font>　💠 deepseek-v4.1-flash　9.6s",
    )
    const failed = buildFooterElement({ status: '出错' }) as { content: string }
    expect(failed.content).toContain("<font color='red'>出错</font>")
    const done = buildFooterElement({ status: '已完成' }) as { content: string }
    expect(done.content).toBe('已完成')
  })

  it('ships the same text for both locales', () => {
    const element = buildFooterElement({ status: '思考中', model: 'x' }) as {
      i18n_content: { zh_cn: string; en_us: string }
    }
    expect(element.i18n_content.zh_cn).toBe(element.i18n_content.en_us)
  })
})

describe('summaryFromAnswer', () => {
  it('previews the answer, not the status word', () => {
    // Feishu renders the summary in the chat list, so "已完成" made every
    // conversation preview identical (user feedback 2026-11-09).
    expect(summaryFromAnswer('江澈，本公司的同事（不是外部人员）', '已完成')).toBe(
      '江澈，本公司的同事（不是外部人员）',
    )
  })

  it('strips markdown so the preview reads as a sentence', () => {
    const summary = summaryFromAnswer(
      '## 结论\n**江澈** 是本公司的同事，见 [档案](https://x.y/z)\n\n- `ou_1` 对得上',
      '已完成',
    )
    expect(summary).toContain('江澈 是本公司的同事')
    expect(summary).not.toContain('##')
    expect(summary).not.toContain('**')
    expect(summary).not.toContain('https://')
    expect(summary).not.toContain('`')
    expect(summary).not.toContain('\n')
  })

  it('drops code fences (their first line previews as "bash")', () => {
    const summary = summaryFromAnswer('跑完了\n```bash\nnpm test\n```', '已完成')
    expect(summary).toBe('跑完了')
  })

  it('falls back to the status when the answer carries no prose', () => {
    expect(summaryFromAnswer('   ', '已停止')).toBe('已停止')
    expect(summaryFromAnswer('```\ncode only\n```', '已完成')).toBe('已完成')
  })

  it('keeps the preview short enough for a list row', () => {
    expect(summaryFromAnswer('字'.repeat(500), '已完成')).toHaveLength(60)
  })
})

describe('buildSealPlan', () => {
  it('orders panel → footer(add, insert_before dots) → per-id deletes', () => {
    const built = plan()
    expect(built.batches).toHaveLength(3)
    expect(built.batches[0][0]).toMatchObject({ action: 'partial_update_element' })
    const add = built.batches[1][0] as Extract<SealAction, { action: 'add_elements' }>
    expect(add.params.type).toBe('insert_before')
    // The dots row is the anchor: it is the last element before the footer.
    expect(add.params.target_element_id).toBe('loading_icon')
    expect(built.batches[2]).toEqual([
      { action: 'delete_elements', params: { element_ids: ['loading_icon'] } },
    ])
  })

  it('never groups deletes: one batch per id', () => {
    const built = plan({ removeElementIds: ['loading_icon', 'hint_1'] })
    const deletes = built.batches.filter((batch) => batch[0]?.action === 'delete_elements')
    expect(deletes).toHaveLength(2)
    expect(deletes.every((batch) => batch.length === 1)).toBe(true)
  })

  it('clamps the summary to 120 chars', () => {
    const built = plan({ summary: 'x'.repeat(300) })
    expect(built.summary).toHaveLength(120)
  })

  it('emits the real CardKit wire shape ({action, params})', () => {
    // Regression guard for the bug that made the card look dead: a flat
    // `{kind, element_id, content}` action is accepted by card.batchUpdate
    // (code=0, because `actions` is only ever parsed as JSON) and then does
    // nothing at all. The card sat on its initial state forever while every
    // call "succeeded".
    const shapes = plan().batches.flat().map((action) => Object.keys(action).sort())
    for (const keys of shapes) expect(keys).toEqual(['action', 'params'])
    const update = plan().batches[0][0] as Extract<SealAction, { action: 'partial_update_element' }>
    expect(Object.keys(update.params).sort()).toEqual(['element_id', 'partial_element'])
    // partial_element carries the element's INNER fields — no tag/element_id.
    expect(update.params.partial_element).not.toHaveProperty('element_id')
    expect(update.params.partial_element).not.toHaveProperty('tag')
  })
})

describe('runSealPlan — happy path', () => {
  it('runs every batch then closes streaming once', async () => {
    const { api, calls } = fakeApi()
    const report = await runSealPlan(api, 'card_1', plan(), 10)
    expect(report.footerAdded).toBe(true)
    expect(report.streamingClosed).toBe(true)
    expect(report.batchesRun).toBe(3)
    // last call is the settings (close_streaming) one
    expect(calls.at(-1)?.actions).toEqual(['settings'])
  })

  it('advances the sequence per call', async () => {
    const sequences: number[] = []
    const api: CardApi = {
      async batchUpdate(_c, _a, sequence) {
        sequences.push(sequence)
      },
      async settings(_c, _s, sequence) {
        sequences.push(sequence)
      },
    }
    await runSealPlan(api, 'card_1', plan(), 10)
    expect(sequences).toEqual([11, 12, 13, 14])
  })
})

describe('runSealPlan — error codes', () => {
  it('300309 (streaming closed) keeps the structural work running', async () => {
    // First batch fails with "streaming closed"; the rest must still run and
    // close_streaming must be skipped.
    const { api } = fakeApi((_actions, index) => {
      if (index === 0) throw new CardApiError(CARDKIT_STREAMING_CLOSED, 'closed')
    })
    const report = await runSealPlan(api, 'card_1', plan(), 0)
    expect(report.streamingClosed).toBe(true)
    expect(report.footerAdded).toBe(true)
    expect(report.batchesRun).toBe(3)
  })

  it('300301 (duplicate id) counts as footer present', async () => {
    const { api } = fakeApi((_actions, index) => {
      if (index === 1) throw new CardApiError(CARDKIT_DUPLICATE_ID, 'dup')
    })
    const report = await runSealPlan(api, 'card_1', plan(), 0)
    expect(report.footerAdded).toBe(true)
    expect(report.satisfied).toContain(CARDKIT_DUPLICATE_ID)
  })

  it('300314 (delete of missing element) is satisfied, not fatal', async () => {
    const { api } = fakeApi((_actions, index) => {
      if (index === 2) throw new CardApiError(300314, 'missing')
    })
    const report = await runSealPlan(api, 'card_1', plan(), 0)
    expect(report.streamingClosed).toBe(true)
    expect(report.satisfied).toContain(300314)
  })

  it('300315 (insert_before target gone) retries the footer as an append', async () => {
    const addShapes: string[] = []
    const { api } = fakeApi((actions, index) => {
      const action = actions[0] as SealAction
      if (action.action !== 'add_elements') return
      addShapes.push(action.params.type === 'insert_before' ? action.params.target_element_id! : 'append')
      if (index === 1) throw new CardApiError(CARDKIT_INSERT_TARGET_GONE, 'target gone')
    })
    const report = await runSealPlan(api, 'card_1', plan(), 0)
    expect(report.footerAdded).toBe(true)
    // insert_before first, then the append retry
    expect(addShapes).toEqual(['loading_icon', 'append'])
  })

  it('append retry that also reports a duplicate is still a success', async () => {
    const { api } = fakeApi((_actions, index) => {
      if (index === 1) throw new CardApiError(CARDKIT_INSERT_TARGET_GONE, 'gone')
      if (index === 2) throw new CardApiError(CARDKIT_DUPLICATE_ID, 'dup')
    })
    const report = await runSealPlan(api, 'card_1', plan(), 0)
    expect(report.footerAdded).toBe(true)
  })

  it('an unknown code is fatal', async () => {
    const { api } = fakeApi((_actions, index) => {
      if (index === 0) throw new CardApiError(999999, 'boom')
    })
    await expect(runSealPlan(api, 'card_1', plan(), 0)).rejects.toThrow('boom')
  })

  it('tolerates a PLAIN Error carrying a code — the shape the real transport throws', () => {
    // Regression: the executor branched on `error instanceof CardApiError`
    // while the Lark transport threw `Object.assign(new Error(...), {code})`.
    // Every tolerance branch was therefore dead in production and the seal
    // threw on codes that mean "already done" — footer and panel updates lost.
    return (async () => {
      const { api } = fakeApi((_actions, index) => {
        if (index === 0) throw Object.assign(new Error('closed'), { code: CARDKIT_STREAMING_CLOSED })
        if (index === 1) throw Object.assign(new Error('dup'), { code: CARDKIT_DUPLICATE_ID })
      })
      const report = await runSealPlan(api, 'card_1', plan(), 0)
      expect(report.streamingClosed).toBe(true)
      expect(report.footerAdded).toBe(true)
      expect(report.satisfied).toEqual([CARDKIT_STREAMING_CLOSED, CARDKIT_DUPLICATE_ID])
    })()
  })

  it('reads the code out of a nested response object too', async () => {
    const { api } = fakeApi((_actions, index) => {
      if (index === 2) throw Object.assign(new Error('missing'), { response: { code: 300314 } })
    })
    const report = await runSealPlan(api, 'card_1', plan(), 0)
    expect(report.satisfied).toContain(300314)
  })
})
