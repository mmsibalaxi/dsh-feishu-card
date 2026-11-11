import { describe, expect, it } from 'vitest'
import { chunkText } from './sender.ts'

describe('chunkText', () => {
  it('returns a single chunk under the limit', () => {
    expect(chunkText('短消息', 3000)).toEqual(['短消息'])
  })

  it('splits on line boundaries when it can', () => {
    const text = Array.from({ length: 5 }, (_, i) => `第 ${i} 行`.padEnd(1200, 'x')).join('\n')
    const chunks = chunkText(text, 3000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true)
    expect(chunks.join('\n')).toBe(text)
  })

  it('hard-splits a single oversized line', () => {
    const chunks = chunkText('y'.repeat(7000), 3000)
    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true)
    expect(chunks.join('')).toBe('y'.repeat(7000))
  })

  it('treats empty text as one chunk', () => {
    expect(chunkText('', 3000)).toEqual([''])
  })
})
