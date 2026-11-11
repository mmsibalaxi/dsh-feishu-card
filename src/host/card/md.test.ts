import { describe, expect, it } from 'vitest'
import {
  ANSWER_MAX_BYTES,
  clampUtf8,
  downgradeTables,
  escapeAsterisks,
  optimizeMarkdownStyle,
  sanitizeAnswer,
  splitAnswer,
} from './md.ts'

describe('splitAnswer', () => {
  it('leaves a short answer as one part', () => {
    expect(splitAnswer('短答案')).toEqual(['短答案'])
  })

  it('splits a long answer into byte-budgeted parts', () => {
    // Hermes' 分段+续卡: the tail used to be thrown away by clampUtf8.
    const text = '汉'.repeat(12000) // 36000 bytes
    const parts = splitAnswer(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(ANSWER_MAX_BYTES)
    }
    // Nothing lost, nothing duplicated.
    expect(parts.join('')).toBe(text)
  })

  it('prefers a paragraph boundary inside the window', () => {
    const head = '第一段\n\n'.repeat(700) // each block is 8 chars
    const text = `${head}${'尾巴'.repeat(10)}`
    const parts = splitAnswer(text, 2000)
    expect(parts[0]?.endsWith('\n\n')).toBe(true)
    expect(parts.join('')).toBe(text)
  })

  it('caps the number of cards a runaway answer may post', () => {
    const parts = splitAnswer('字'.repeat(60000), ANSWER_MAX_BYTES, 3)
    expect(parts).toHaveLength(3)
    // The last part is what the caller clamps; it may exceed the budget.
    expect(parts.join('')).toBe('字'.repeat(60000))
  })
})

describe('clampUtf8', () => {
  it('passes short text through untouched', () => {
    expect(clampUtf8('短', 13000)).toBe('短')
  })

  it('counts UTF-8 bytes, not characters', () => {
    // 5000 Chinese characters = 15000 bytes → over a 13000-byte budget.
    const text = '汉'.repeat(5000)
    const clamped = clampUtf8(text, 13000)
    expect(Buffer.byteLength(clamped, 'utf8')).toBeLessThanOrEqual(13000)
    expect(clamped.endsWith('…（内容过长已截断，防卡片溢出）…')).toBe(true)
    expect(clamped.startsWith('汉')).toBe(true)
  })

  it('keeps ASCII under the byte budget as well', () => {
    const clamped = clampUtf8('a'.repeat(20000), 13000)
    expect(clamped.length).toBeLessThan(20000)
    expect(clamped).toContain('已截断')
  })
})

describe('escapeAsterisks', () => {
  it('escapes an unpaired asterisk that Feishu would pair up', () => {
    expect(escapeAsterisks('2*4000+4*3000')).toBe('2\\*4000+4\\*3000')
  })

  it('leaves real bold alone', () => {
    expect(escapeAsterisks('**重点**')).toBe('**重点**')
  })

  it('leaves asterisks inside code alone', () => {
    expect(escapeAsterisks('`a*b*c`')).toBe('`a*b*c`')
    expect(escapeAsterisks('```\n2*3\n```')).toBe('```\n2*3\n```')
  })

  it('strips null bytes (they render as boxes in Feishu)', () => {
    expect(escapeAsterisks('a\x00b')).toBe('ab')
  })

  it('is idempotent', () => {
    const once = escapeAsterisks('2*4000 and **bold**')
    expect(escapeAsterisks(once)).toBe(once)
  })
})

describe('optimizeMarkdownStyle', () => {
  it('short-circuits plain short text', () => {
    expect(optimizeMarkdownStyle('好的')).toBe('好的')
  })

  it('demotes headings so they do not dominate the card', () => {
    expect(optimizeMarkdownStyle('# 标题\n\n正文'.padEnd(120, 'x'))).toContain('#### 标题')
  })

  it('collapses runs of blank lines', () => {
    const out = optimizeMarkdownStyle('a\n\n\n\n\nb'.padEnd(120, 'x'))
    expect(out).toContain('a\n\nb')
  })

  it('drops image refs we cannot resolve', () => {
    const text = '看 ![](https://x/y.png) 和 ![ok](img_abc)'.padEnd(120, 'x')
    const out = optimizeMarkdownStyle(text)
    expect(out).not.toContain('https://x/y.png')
    expect(out).toContain('img_abc')
  })

  it('keeps code blocks intact while demoting headings', () => {
    const text = '# T\n\n```\n# not a heading\n```\n'.padEnd(120, 'x')
    const out = optimizeMarkdownStyle(text)
    expect(out).toContain('```\n# not a heading\n```')
    expect(out).toContain('#### T')
  })
})

describe('downgradeTables', () => {
  const table = '| a | b |\n|---|---|\n| 1 | 2 |'

  it('keeps tables under the limit', () => {
    expect(downgradeTables(table, 20)).toBe(table)
  })

  it('degrades the overflow into lists', () => {
    const many = Array.from({ length: 25 }, (_, i) => `| c${i} | d |\n|---|---|\n| 1 | 2 |`).join('\n\n')
    const out = downgradeTables(many, 20)
    expect(out).toContain('• ')
    expect(out.match(/•/g)?.length).toBeGreaterThan(0)
    // The first `limit` tables stay as tables.
    expect(out.split('```').length).toBe(1)
    expect(out).toContain('| c0 | d |')
    expect(out).not.toContain('| c24 | d |')
  })

  it('passes text without pipes through', () => {
    expect(downgradeTables('no tables here', 1)).toBe('no tables here')
  })
})

describe('sanitizeAnswer', () => {
  it('runs the whole pipeline', () => {
    const out = sanitizeAnswer('结果：2*4000+4*3000\n\n\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('2\\*4000')
    expect(out).not.toContain('\n\n\n')
    expect(out).toContain('| a | b |')
  })

  it('never returns null bytes', () => {
    expect(sanitizeAnswer('a\x00*b')).not.toContain('\x00')
  })

  it('keeps `$&` / `$1` inside code blocks intact', () => {
    // Regression: code blocks are lifted out and restored with a string
    // replacement, and `$&` in a replacement means "the matched text" — so a
    // snippet containing `$&` came back as the placeholder itself.
    const source = '看这段：\n```js\nconst x = "$&" + "$1"\n```\n完'
    const out = sanitizeAnswer(source)
    expect(out).toContain('"$&" + "$1"')
    expect(out).not.toContain('___CB_')
  })
})
