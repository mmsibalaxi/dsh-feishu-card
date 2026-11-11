/**
 * The process panel's payload budget.
 *
 * Every panel flush re-sends the WHOLE panel, and it shares one serialized write
 * chain with the answer text. Measured live (2026-11-10): 72% of card writes
 * carried no new answer text and the median gap between writes was 913ms — a
 * 66-tool turn's panel is big enough that each refresh costs a visible round
 * trip. These caps are what keeps the panel from starving the typewriter.
 */
import { describe, expect, it } from 'vitest'
import { MAX_PANEL_PREVIEWS, MAX_PANEL_STEPS, panelElements, type PanelToolStep } from './builder.ts'

function steps(count: number): PanelToolStep[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    name: `tool_${index}`,
    ms: 10,
    preview: `preview ${index}`,
  }))
}

const json = (elements: unknown[]) => JSON.stringify(elements)

describe('panelElements', () => {
  it('renders every step of a normal turn', () => {
    const rendered = json(panelElements({ steps: steps(5) }))
    for (let index = 0; index < 5; index += 1) expect(rendered).toContain(`tool_${index}`)
    expect(rendered).not.toContain('前面还有')
  })

  it('folds the oldest steps away beyond the cap', () => {
    const rendered = json(panelElements({ steps: steps(MAX_PANEL_STEPS + 6) }))
    // The newest MAX_PANEL_STEPS survive; the rest is one summary row.
    expect(rendered).toContain(`…前面还有 6 步`)
    expect(rendered).toContain(`tool_${MAX_PANEL_STEPS + 5}`)
    expect(rendered).not.toContain('tool_0"')
  })

  it('keeps previews only on the newest rows (payload budget)', () => {
    const total = 10
    const rendered = json(panelElements({ steps: steps(total) }))
    // Newest MAX_PANEL_PREVIEWS keep theirs…
    for (let index = total - MAX_PANEL_PREVIEWS; index < total; index += 1) {
      expect(rendered).toContain(`preview ${index}`)
    }
    // …the older ones drop the detail but keep the row.
    expect(rendered).not.toContain('preview 0')
    expect(rendered).toContain('tool_0')
  })

  it('never drops an error, even on an old row', () => {
    const rows = steps(10)
    rows[0] = { ...rows[0]!, completed: false, error: 'boom' }
    const rendered = json(panelElements({ steps: rows }))
    expect(rendered).toContain('boom')
  })
})