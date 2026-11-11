import { describe, expect, it } from 'vitest'
import {
  buildFooterInput,
  compactNumber,
  formatContext,
  formatElapsedMs,
  formatModel,
  formatTokens,
} from './footer.ts'

describe('compactNumber', () => {
  it('matches hermes formatting', () => {
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(320)).toBe('320')
    expect(compactNumber(1200)).toBe('1.2k')
    expect(compactNumber(8000)).toBe('8.0k')
    expect(compactNumber(31100)).toBe('31.1K')
    expect(compactNumber(1000000)).toBe('1.0M')
  })
})

describe('formatContext', () => {
  it('renders the hermes shape', () => {
    expect(formatContext(31100, 1000000)).toBe('31.1K/1.0M (3%)')
    expect(formatContext(65536, 65536)).toBe('65.5K/65.5K (100%)')
  })

  it('returns undefined without a window', () => {
    expect(formatContext(1000, undefined)).toBeUndefined()
    expect(formatContext(1000, 0)).toBeUndefined()
  })

  it('returns undefined when nothing has been used yet', () => {
    // A card created before the first request has no occupancy at all. Printing
    // "0/200K (0%)" there is what made the live footer look broken.
    expect(formatContext(0, 200000)).toBeUndefined()
  })
})

describe('formatTokens', () => {
  it('renders input/output and cache', () => {
    expect(formatTokens({ uncachedInputTokens: 1200, outputTokens: 340 })).toBe('↑ 1.2k ↓ 340')
    expect(
      formatTokens({ uncachedInputTokens: 1200, outputTokens: 340, cacheReadTokens: 8000 }),
    ).toBe('↑ 1.2k ↓ 340 💾 8.0k')
  })

  it('returns undefined when there is no usage', () => {
    expect(formatTokens({})).toBeUndefined()
  })
})

describe('formatElapsedMs', () => {
  it('matches the streaming card helper', () => {
    expect(formatElapsedMs(400)).toBe('400ms')
    expect(formatElapsedMs(4200)).toBe('4.2s')
    expect(formatElapsedMs(99000)).toBe('1m 39s')
  })
})

describe('buildFooterInput', () => {
  it('assembles the full hermes line', () => {
    const footer = buildFooterInput({
      status: '已完成',
      model: 'deepseek-chat',
      usedTokens: 31100,
      contextWindow: 1000000,
      elapsedMs: 12300,
      usage: { uncachedInputTokens: 1200, outputTokens: 340 },
    })
    expect(footer).toEqual({
      status: '已完成',
      model: 'deepseek-chat',
      context: '31.1K/1.0M (3%)',
      elapsed: '12.3s',
      tokens: '↑ 1.2k ↓ 340',
    })
  })

  it('omits fields it cannot compute (no cost, ever)', () => {
    const footer = buildFooterInput({ status: '已停止', elapsedMs: 35000 })
    expect(footer).toEqual({ status: '已停止', elapsed: '35.0s' })
    expect(Object.keys(footer)).not.toContain('cost')
  })

  it('omits the context percentage when the window is unknown', () => {
    const footer = buildFooterInput({ status: '已完成', usedTokens: 500, model: 'x' })
    expect(footer.context).toBeUndefined()
    expect(footer.model).toBe('x')
  })

  it('falls back to prompt-side pressure while the projection is empty', () => {
    // The streaming window: the session projection has folded nothing yet, so
    // the newest request's usage is the only occupancy that exists.
    const footer = buildFooterInput({
      status: '思考中',
      model: 'auto/step-5-preview',
      contextWindow: 1000000,
      usage: { uncachedInputTokens: 30000, outputTokens: 1100, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    expect(footer.context).toBe('30.0K/1.0M (3%)')
  })

  it('prefers the projection figure over the usage sample', () => {
    const footer = buildFooterInput({
      status: '已完成',
      usedTokens: 31100,
      contextWindow: 1000000,
      usage: { uncachedInputTokens: 30000, outputTokens: 1100 },
    })
    expect(footer.context).toBe('31.1K/1.0M (3%)')
  })

  it('prints nothing at all when there is no occupancy signal', () => {
    const footer = buildFooterInput({ status: '处理中', model: 'auto/step-5-preview' })
    // The routing-group prefix is noise on a card the user reads.
    expect(footer).toEqual({ status: '处理中', model: 'step-5-preview' })
  })

  it('drops a routing-group prefix but keeps an explicit provider', () => {
    expect(formatModel('auto/step-5-preview')).toBe('step-5-preview')
    expect(formatModel('magpie/auto/step-5-preview')).toBe('magpie/auto/step-5-preview')
    expect(formatModel(undefined)).toBeUndefined()
  })
})
