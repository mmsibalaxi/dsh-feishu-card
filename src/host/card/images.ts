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
 *
 * A **local** image takes the same road from the other end: the agent that
 * plotted a chart writes `![趋势](C:\out\chart.png)` and the bytes are already
 * on disk, so there is nothing to fetch — only to upload.
 */
import { fetchBytes } from '../media.ts'
import { baseName, isLocalPath, toPath } from './attachments.ts'

/** `![alt](target)` — every target; `isLocalPath`/the http check decide which. */
const RE_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

/** How many images one answer may upload. */
export const MAX_IMAGES_PER_ANSWER = 3

export interface ImageResolverOptions {
  upload(bytes: Uint8Array, name: string): Promise<string>
  fetchBytes?: (url: string, timeoutMs?: number) => Promise<Uint8Array>
  /** Read a local image; absent = local images are left untouched. */
  readLocal?: (path: string) => Promise<Uint8Array>
  max?: number
  log?: (message: string) => void
}

/** Only the targets this module can turn into an `img_key`. */
function isCandidate(target: string): boolean {
  return /^https?:\/\//.test(target) || isLocalPath(target)
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
  const fetch_ = options.fetchBytes ?? fetchBytes
  const max = options.max ?? MAX_IMAGES_PER_ANSWER

  const load = async (target: string): Promise<Uint8Array> => {
    if (isLocalPath(target)) {
      const readLocal = options.readLocal
      if (!readLocal) throw new Error('local images are not supported here')
      return readLocal(toPath(target))
    }
    return fetch_(target)
  }

  return async (text) => {
    const targets = [...text.matchAll(RE_IMAGE)]
      .map((match) => match[2]!)
      .filter(isCandidate)
    if (targets.length === 0) return text
    const unique = [...new Set(targets)].slice(0, max)
    const keys = new Map<string, string>()
    for (const target of unique) {
      const cached = cache.get(target)
      if (cached) {
        keys.set(target, cached)
        continue
      }
      try {
        const bytes = await load(target)
        const name = isLocalPath(target)
          ? baseName(toPath(target))
          : (target.split('/').pop()?.split('?')[0] || 'image.png')
        const key = await options.upload(bytes, name)
        cache.set(target, key)
        keys.set(target, key)
      } catch (error) {
        options.log?.(`feishu-card: image upload failed for ${target}: ${error}`)
      }
    }
    if (keys.size === 0) return text
    return text.replace(RE_IMAGE, (whole, alt: string, target: string) => {
      const key = keys.get(target)
      return key ? `![${alt}](${key})` : whole
    })
  }
}