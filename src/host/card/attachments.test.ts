import { describe, expect, it } from 'vitest'
import {
  baseName,
  findLocalFiles,
  isLocalPath,
  stripFileLinks,
  toPath,
} from './attachments.ts'

describe('isLocalPath', () => {
  it('accepts windows absolute paths, both separators', () => {
    expect(isLocalPath('C:\\out\\report.csv')).toBe(true)
    expect(isLocalPath('D:/workspace/out/report.csv')).toBe(true)
  })

  it('accepts file:// targets', () => {
    expect(isLocalPath('file:///C:/out/report.csv')).toBe(true)
  })

  it('accepts a POSIX path only when it looks like a file', () => {
    expect(isLocalPath('/home/me/out/report.csv')).toBe(true)
    // A route is not a file — this was the false positive worth guarding.
    expect(isLocalPath('/open-apis/im/v1/messages')).toBe(false)
  })

  it('leaves urls and img_keys alone', () => {
    expect(isLocalPath('https://example.com/a.png')).toBe(false)
    expect(isLocalPath('img_v3_02abc')).toBe(false)
    expect(isLocalPath('oc_0000000000000000000000000000000a')).toBe(false)
  })
})

describe('toPath', () => {
  it('unwraps file:// and drops the leading slash before a drive letter', () => {
    expect(toPath('file:///C:/out/report.csv')).toBe('C:/out/report.csv')
    expect(toPath('file:///home/me/a.csv')).toBe('/home/me/a.csv')
  })

  it('decodes percent escapes without throwing on a malformed one', () => {
    expect(toPath('file:///C:/a%20b/c.csv')).toBe('C:/a b/c.csv')
    expect(toPath('file:///C:/a%zz/c.csv')).toBe('C:/a%zz/c.csv')
  })
})

describe('baseName', () => {
  it('takes the last segment for either separator', () => {
    expect(baseName('C:\\out\\report.csv')).toBe('report.csv')
    expect(baseName('/home/me/report.csv')).toBe('report.csv')
  })
})

describe('findLocalFiles', () => {
  it('finds file links and image links, tagged by kind', () => {
    const text = '见 ![图](C:\\out\\chart.png) 和 [报告](C:\\out\\report.csv)'
    const files = findLocalFiles(text)
    expect(files).toEqual([
      { path: 'C:\\out\\chart.png', label: '图', isImage: true },
      { path: 'C:\\out\\report.csv', label: '报告', isImage: false },
    ])
  })

  it('ignores remote urls and bare ids', () => {
    const text = '[a](https://x/y.png) ![b](img_v3_02abc)'
    expect(findLocalFiles(text)).toEqual([])
  })

  it('drops references whose file is missing', () => {
    const text = '[gone](C:\\out\\gone.csv) [here](C:\\out\\here.csv)'
    const files = findLocalFiles(text, { exists: (path) => path.endsWith('here.csv') })
    expect(files.map((file) => file.path)).toEqual(['C:\\out\\here.csv'])
  })

  it('deduplicates the same path and caps the count', () => {
    const twice = '[a](C:\\out\\a.csv) [a again](C:\\out\\a.csv)'
    expect(findLocalFiles(twice)).toHaveLength(1)

    const many = Array.from({ length: 9 }, (_, index) => `[f${index}](C:\\out\\f${index}.csv)`).join(' ')
    expect(findLocalFiles(many, { max: 3 })).toHaveLength(3)
  })

  it('falls back to the file name when the link has no label', () => {
    expect(findLocalFiles('[](C:\\out\\report.csv)')[0]?.label).toBe('report.csv')
  })
})

describe('stripFileLinks', () => {
  const files = [
    { path: 'C:\\out\\chart.png', label: '图', isImage: true },
    { path: 'C:\\out\\report.csv', label: '报告', isImage: false },
  ]

  it('replaces a file link with an attachment hint', () => {
    const text = '结果见 [报告](C:\\out\\report.csv)。'
    expect(stripFileLinks(text, files)).toBe('结果见 📎 报告。')
  })

  it('keeps image links so the image resolver can rewrite them', () => {
    const text = '![图](C:\\out\\chart.png)'
    expect(stripFileLinks(text, files)).toBe(text)
  })

  it('keeps links it was not told about', () => {
    const text = '[官网](https://example.com)'
    expect(stripFileLinks(text, files)).toBe(text)
  })

  it('is a no-op when no file was collected', () => {
    const text = '[报告](C:\\out\\report.csv)'
    expect(stripFileLinks(text, [])).toBe(text)
  })

  it('handles a file:// link the same way as a bare path', () => {
    const text = '[报告](file:///C:/out/report.csv)'
    expect(stripFileLinks(text, files)).toBe('📎 报告')
  })
})