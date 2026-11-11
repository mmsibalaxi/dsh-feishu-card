/**
 * Outbound image resolution: `![alt](https://…)` → `![alt](img_key)`.
 *
 * Regression guard for the silent-drop path: the card sanitiser removes any
 * image reference that is not already an `img_key`, so an answer that embedded
 * a chart URL reached Feishu with the image missing and no error anywhere.
 */
import { describe, expect, it } from 'vitest'
import { MAX_IMAGES_PER_ANSWER, createImageResolver } from './images.ts'

function fakeUploader() {
  const uploaded: string[] = []
  return {
    uploaded,
    upload: async (_bytes: Uint8Array, name: string) => {
      uploaded.push(name)
      return `img_v2_${uploaded.length}`
    },
  }
}

const bytes = async () => new Uint8Array([1, 2, 3])

describe('createImageResolver', () => {
  it('swaps an http image for its img_key', async () => {
    const { uploaded, upload } = fakeUploader()
    const resolve = createImageResolver({ upload, fetchBytes: bytes })
    const out = await resolve('看这个图：![销售趋势](https://cdn.example.com/chart.png)')
    expect(out).toContain('![销售趋势](img_v2_1)')
    expect(out).not.toContain('https://')
    expect(uploaded).toEqual(['chart.png'])
  })

  it('leaves text without images untouched', async () => {
    const { upload } = fakeUploader()
    const resolve = createImageResolver({ upload, fetchBytes: bytes })
    const text = '普通回答，没有图片'
    expect(await resolve(text)).toBe(text)
  })

  it('uploads a repeated URL only once', async () => {
    const { uploaded, upload } = fakeUploader()
    const resolve = createImageResolver({ upload, fetchBytes: bytes })
    await resolve('![a](https://x/1.png)')
    const out = await resolve('![b](https://x/1.png)')
    expect(uploaded).toHaveLength(1)
    expect(out).toContain('img_v2_1')
  })

  it('keeps the original reference when an upload fails (the sanitiser then drops it)', async () => {
    const resolve = createImageResolver({
      upload: async () => {
        throw new Error('upload boom')
      },
      fetchBytes: bytes,
    })
    const out = await resolve('![a](https://x/1.png)')
    expect(out).toContain('https://x/1.png')
  })

  it('caps how many images one answer may upload', async () => {
    const { uploaded, upload } = fakeUploader()
    const resolve = createImageResolver({ upload, fetchBytes: bytes })
    const refs = Array.from({ length: MAX_IMAGES_PER_ANSWER + 2 }, (_, i) => `![i${i}](https://x/${i}.png)`)
    await resolve(refs.join('\n'))
    expect(uploaded).toHaveLength(MAX_IMAGES_PER_ANSWER)
  })

  it('ignores non-http image targets (they are already keys or local)', async () => {
    const { uploaded, upload } = fakeUploader()
    const resolve = createImageResolver({ upload, fetchBytes: bytes })
    const text = '![a](img_v2_existing)'
    expect(await resolve(text)).toBe(text)
    expect(uploaded).toHaveLength(0)
  })
})
