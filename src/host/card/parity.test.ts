import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildStreamingCard, answerElement } from './builder.ts'
import { LOADING_ICON_IMG_KEY, buildFooterElement, buildSealPlan } from './seal.ts'

/**
 * The card JSON must stay structurally identical to the user's working
 * hermes-lark-streaming implementation — that one is proven in production, and
 * Feishu rejects cards it does not recognise. The reference dump is produced by
 * `D:\workspace\.dsh-check\dump-hermes-card.py` (run with the Hermes venv).
 */
const REFERENCE = process.env.HERMES_CARD_JSON
  ? JSON.parse(readFileSync(process.env.HERMES_CARD_JSON, 'utf8'))
  : null

const refCard = REFERENCE ? (REFERENCE.find((b) => 'schema' in b) as never) : null
const refFooter = REFERENCE ? ((REFERENCE.find((b) => Array.isArray(b)) as unknown[])?.[1] as never) : null

describe('card shape parity with the working hermes implementation', () => {
  it('produces the same top-level shape', () => {
    const card = buildStreamingCard() as { schema: string; config: Record<string, unknown>; body: { elements: unknown[] } }
    expect(card.schema).toBe('2.0')
    // answer + panel, plus the footer pair when one is supplied. The two
    // clock-icon loading rows hermes ships are deliberately absent: they read
    // as duplication and the empty one outlived the turn.
    expect(card.body.elements.length).toBeGreaterThanOrEqual(2)
    if (refCard) {
      expect(card.config.streaming_mode).toBe(refCard.config.streaming_mode)
      expect(card.config.streaming_config).toEqual(refCard.config.streaming_config)
      expect(card.config.locales).toEqual(refCard.config.locales)
      // element ids, in order — the answer element and the panel must match;
      // the loading rows are ours to drop.
      const ours = (card.body.elements as { element_id?: string }[]).map((e) => e.element_id)
      const theirs = (refCard.body.elements as { element_id?: string }[]).map((e) => e.element_id)
      expect(ours).toEqual(ours.filter((id) => id !== undefined))
      expect(ours[0]).toBe(theirs[0])
      expect(ours.at(-1)).toBe(theirs.at(-1))
    }
  })

  it('ships the animated loading icon, and the panel sits above the divider', () => {
    const card = buildStreamingCard({
      footer: buildFooterElement({ status: '思考中' }),
    }) as {
      body: {
        elements: {
          element_id?: string
          icon?: { tag?: string; img_key?: string; size?: string }
        }[]
      }
    }
    const ids = card.body.elements.map((e) => e.element_id)
    // answer → panel → loading icon → divider → footer. The footer's status line
    // is the last thing on the card, the way hermes lays it out.
    expect(ids).toEqual([
      'answer_content',
      'agent_process_panel',
      'loading_icon',
      'footer_hr',
      'footer_status',
    ])
    // The indicator is hermes' `custom_icon` asset: the client animates it, so
    // the motion never depends on how often we flush.
    const indicator = card.body.elements.find((e) => e.element_id === 'loading_icon')
    expect(indicator?.icon?.tag).toBe('custom_icon')
    expect(indicator?.icon?.img_key).toBe(LOADING_ICON_IMG_KEY)
    expect(indicator?.icon?.size).toBe('16px 16px')
  })

  it('types out one character every 15ms with the fast strategy (hermes parity)', () => {
    // The perceived smoothness lives here: 4 chars per 70ms with `delay` made
    // answers appear in blocks. hermes prints 1 char per 15ms as fast as the
    // client allows, which reads as a continuous typewriter.
    const card = buildStreamingCard({}) as {
      config: {
        streaming_config: {
          print_frequency_ms: { default: number }
          print_step: { default: number }
          print_strategy: string
        }
      }
    }
    expect(card.config.streaming_config.print_frequency_ms.default).toBe(15)
    expect(card.config.streaming_config.print_step.default).toBe(1)
    expect(card.config.streaming_config.print_strategy).toBe('fast')
  })

  it('answer element carries every field hermes sets', () => {
    const el = answerElement('hi') as Record<string, unknown>
    expect(el).toMatchObject({
      tag: 'markdown',
      content: 'hi',
      text_align: 'left',
      text_size: 'normal_v2',
      margin: '0px 0px 0px 0px',
      element_id: 'answer_content',
    })
  })

  it('footer element carries content + i18n_content + notation size', () => {
    const el = buildFooterElement({
      status: '已完成',
      model: 'mimo-v2.5-pro',
      context: '31.1K/1.0M (3%)',
      elapsed: '54.6s',
    }) as Record<string, never>
    // Same field set hermes renders, in the same order; only the styling of the
    // status bar differs (coloured 💠 glyph, full-width gaps instead of `·`).
    expect(el.content).toBe('已完成　💠 mimo-v2.5-pro　31.1K/1.0M (3%)　54.6s')
    expect(el.text_size).toBe('notation')
    expect(el.i18n_content).toEqual({ zh_cn: el.content, en_us: el.content })
    if (refFooter) {
      expect(Object.keys(el).sort()).toEqual(Object.keys(refFooter).sort())
    }
  })

  it('the seal plan removes exactly the elements hermes removes', () => {
    const plan = buildSealPlan({
      panelContent: {},
      footer: { status: '已完成' },
      summary: 'x',
      footerPresent: true,
      removeElementIds: ['loading_icon', 'context_loading_hint'],
    })
    const removed = plan.batches
      .flatMap((b) => b)
      .filter((a) => a.action === 'delete_elements')
      .flatMap((a) => (a as { params: { element_ids: string[] } }).params.element_ids)
    expect(removed).toEqual(['loading_icon', 'context_loading_hint'])
  })

  it('panel placeholder matches hermes structurally', () => {
    const card = buildStreamingCard() as { body: { elements: Record<string, never>[] } }
    const panel = card.body.elements.find((e) => e.element_id === 'agent_process_panel')
    expect(panel).toMatchObject({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: { tag: 'plain_text', text_color: 'grey', text_size: 'notation' },
        icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined' },
        icon_position: 'right',
        icon_expanded_angle: -180,
      },
      border: { color: 'grey', corner_radius: '5px' },
      vertical_spacing: '4px',
      padding: '8px 8px 8px 8px',
    })
    expect(Array.isArray(panel!.elements)).toBe(true)
  })
})
