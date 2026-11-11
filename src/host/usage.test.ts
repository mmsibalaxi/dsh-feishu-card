import { describe, expect, it } from 'vitest'
import { readUsage } from './usage.ts'

/** Minimal fake of the pieces readUsage touches. */
function fakeContext(values: Record<string, unknown> | undefined, throwOnSnapshot = false) {
  const service = {
    snapshot(_session: unknown, keys?: readonly string[]) {
      if (throwOnSnapshot) throw new Error('no projections')
      expect(keys).toEqual(['tokenUsage', 'contextPressure'])
      return { values: values ?? {} }
    },
  }
  // readUsage resolves the service through `ctx.get()` (the reflection layer's
  // inject-free read), so the fake must expose that entry point, not a property.
  return { get: (name: string) => (name === 'sessionProjections' ? service : undefined) }
}

const agent = { session: { id: 's1' } } as never

describe('readUsage', () => {
  it('reads occupancy and usage from the projections', () => {
    const reading = readUsage(fakeContext({
      tokenUsage: { uncachedInputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextPressure: { contextWindow: 1000000, pressureTokens: 30000, projectedTokens: 31100 },
    }) as never, agent)
    expect(reading.usedTokens).toBe(31100)
    expect(reading.contextWindow).toBe(1000000)
    expect(reading.usage?.outputTokens).toBe(340)
  })

  it('prefers projectedTokens over pressureTokens (live during a turn)', () => {
    const reading = readUsage(fakeContext({
      contextPressure: { pressureTokens: 30000, projectedTokens: 31250 },
    }) as never, agent)
    expect(reading.usedTokens).toBe(31250)
  })

  it('falls back to the supplied window when the projection has none', () => {
    const reading = readUsage(fakeContext({ contextPressure: { pressureTokens: 1000 } }) as never, agent, 65536)
    expect(reading.contextWindow).toBe(65536)
    expect(reading.usedTokens).toBe(1000)
  })

  it('degrades to nothing when the service is absent', () => {
    const reading = readUsage({ get: () => undefined } as never, agent)
    expect(reading).toEqual({})
  })

  it('degrades to nothing when the snapshot throws', () => {
    const reading = readUsage(fakeContext(undefined, true) as never, agent)
    expect(reading).toEqual({})
  })

  it('treats missing cells as capability absence', () => {
    const reading = readUsage(fakeContext({}) as never, agent, 65536)
    expect(reading.usedTokens).toBeUndefined()
    expect(reading.usage).toBeUndefined()
    expect(reading.contextWindow).toBe(65536)
  })
})
