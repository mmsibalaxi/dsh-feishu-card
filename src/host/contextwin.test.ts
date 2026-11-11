import { describe, expect, it } from 'vitest'
import { knownContextWindows, resolveContextWindow } from './contextwin.ts'

describe('resolveContextWindow', () => {
  it('resolves built-in models', () => {
    expect(resolveContextWindow('deepseek-chat')).toBe(65536)
    expect(resolveContextWindow('claude-sonnet-4')).toBe(200000)
    expect(resolveContextWindow('mimo-v2.5-pro')).toBe(1000000)
  })

  it('prefers a config override over the built-in table', () => {
    expect(resolveContextWindow('deepseek-chat', { 'deepseek-chat': 131072 })).toBe(131072)
  })

  it('resolves provider-prefixed ids', () => {
    expect(resolveContextWindow('deepseek/deepseek-chat')).toBe(65536)
    expect(resolveContextWindow('custom/glm-5.3-flash')).toBe(200000)
  })

  it('falls back to the longest known prefix for unknown variants', () => {
    expect(resolveContextWindow('deepseek-v4-flash-preview')).toBe(65536)
    expect(resolveContextWindow('claude-sonnet-4-5-20260101')).toBe(200000)
  })

  it('returns undefined for a genuinely unknown model', () => {
    expect(resolveContextWindow('some-random-model')).toBeUndefined()
    expect(resolveContextWindow(undefined)).toBeUndefined()
  })

  it('ignores nonsense overrides', () => {
    expect(resolveContextWindow('deepseek-chat', { 'deepseek-chat': 0 })).toBe(65536)
    expect(resolveContextWindow('deepseek-chat', { 'deepseek-chat': -5 })).toBe(65536)
  })

  it('exposes the built-in table for the settings page', () => {
    const table = knownContextWindows()
    expect(table['deepseek-chat']).toBe(65536)
    expect(Object.keys(table).length).toBeGreaterThan(10)
  })
})
