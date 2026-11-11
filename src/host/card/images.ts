/**
 * Outbound markdown images → Feishu `img_key`.
 *
 * A card renders `![alt](img_key)` but never `![alt](https://…)`: the URL form
 * is silently dropped by our own sanitiser (a bare external image does not load
 * inside a Feishu card). hermes solves this by downloading and re-uploading; so
 * do we, with three deliberate limits:
 *
 *   - only the first few images per answer (a chart-heavy answer must not turn
 *     into a burst of uploads that blows the card's time budget),
 *   - a cache keyed by URL (the same chart referenced twice uploads once),
 *   - any failure keeps the original text, which the sanitiser then drops —
 *     no broken image element, no thrown turn.
 */
import { fetchBytes } from '../media.ts'

/** `![alt](https://…)` — only absolute http(s) URLs are candidates. */
const RE_IMAGE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g

/** How many images one answer may upload. */
export const MAX_IMAGES_PER_ANSWER = 3

export interface ImageResolverOptions {
  upload(bytes: Uint8Array, name: string): Promise<string>
  fetchBytes?: (url: string, timeoutMs?: number) => Promise<Uint8Array>
  max?: number
  log?: (message: string) => void
}

/**
 * Build the resolver the streaming card calls before sealing.
 *
 * @returns a function that rewrites image references in place (best effort).
 */
export function createImageResolver(
  options: ImageResolverOptions,
): (text: string) => Promise<string> {
  const cache = new Map<string, string>()
  const fetch = options.fetchBytes ?? fetchBytes
  const max = options.max ?? MAX_IMAGES_PER_ANSWER

  return async (text) => {
    const urls = [...text.matchAll(RE_IMAGE)].map((match) => match[2]!)
    if (urls.length === 0) return text
    const unique = [...new Set(urls)].slice(0, max)
    const keys = new Map<string, string>()
    for (const url of unique) {
      const cached = cache.get(url)
      if (cached) {
        keys.set(url, cached)
        continue
      }
      try {
        const bytes = await fetch(url)
        const name = url.split('/').pop()?.split('?')[0] || 'image.png'
        const key = await options.upload(bytes, name)
        cache.set(url, key)
        keys.set(url, key)
      } catch (error) {
        options.log?.(`feishu-card: image upload failed for ${url}: ${error}`)
      }
    }
    if (keys.size === 0) return text
    return text.replace(RE_IMAGE, (whole, alt: string, url: string) => {
      const key = keys.get(url)
      return key ? `![${alt}](${key})` : whole
    })
  }
}
