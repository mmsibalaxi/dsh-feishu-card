/**
 * Footer value assembly and formatting.
 *
 * Target format (the user's hermes shape):
 *   已完成 · ⚕deepseek-chat · 31.1K/1.0M (3%) · 12.3s
 * with no cost field (explicitly removed by the user) and no duplicated stats
 * in the answer body.
 */
import type { FooterInput } from './seal.ts'

/** 1.2k / 8.0k / 31.1K / 1.0M — hermes' _compact(): always one decimal, `k` below 10k and `K` above. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`
  if (value < 1000000) return `${(value / 1000).toFixed(1)}K`
  return `${(value / 1000000).toFixed(1)}M`
}

/** `31.1K/1.0M (3%)`; returns undefined when there is nothing real to show. */
export function formatContext(used: number, window: number | undefined): string | undefined {
  if (!window || window <= 0 || used <= 0) return undefined
  const percent = Math.min(999, Math.round((used / window) * 100))
  return `${compactNumber(used)}/${compactNumber(window)} (${percent}%)`
}

/**
 * Shorten a model id for the footer.
 *
 * A routing group spells its model `auto/step-5-preview`; the group prefix says
 * nothing to the person reading the card, so it is dropped. An explicit
 * `provider/model` keeps both halves, which do carry meaning.
 */
export function formatModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  return model.startsWith('auto/') ? model.slice('auto/'.length) : model
}

/** `↑ 1.2k ↓ 340` (+ cache when present). */
export function formatTokens(usage: {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): string | undefined {
  const input = usage.uncachedInputTokens ?? 0
  const output = usage.outputTokens ?? 0
  if (!input && !output) return undefined
  const parts = [`↑ ${compactNumber(input)}`, `↓ ${compactNumber(output)}`]
  const cache = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  if (cache > 0) parts.push(`💾 ${compactNumber(cache)}`)
  return parts.join(' ')
}

export interface FooterSource {
  status: string
  model?: string
  /** Occupancy numerator; usually the projection's projectedTokens. */
  usedTokens?: number
  /** Denominator: the request-reported window, else the registry value. */
  contextWindow?: number
  elapsedMs?: number
  usage?: {
    uncachedInputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

/**
 * Prompt-side occupancy from one usage sample: input plus cache traffic, no
 * output. This is hermes' `pressureFrom` — the only honest occupancy available
 * before the session projection has folded a `request/context` record, which is
 * exactly the window a live footer streams in.
 */
export function pressureTokens(usage: {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): number {
  return (
    (usage.uncachedInputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  )
}

/** Assemble a FooterInput from raw readings; missing pieces stay absent. */
export function buildFooterInput(source: FooterSource): FooterInput {
  const footer: FooterInput = { status: source.status }
  if (source.model) footer.model = formatModel(source.model)
  // Occupancy: the projection's projected figure when it has one, else the
  // prompt-side pressure of the newest usage sample. Neither being available
  // means there is genuinely nothing to report — showing "0/200K" would be a
  // lie, so the field is dropped instead (hermes only prints real numbers).
  const used = source.usedTokens && source.usedTokens > 0
    ? source.usedTokens
    : source.usage
      ? pressureTokens(source.usage)
      : 0
  const context = formatContext(used, source.contextWindow)
  if (context) footer.context = context
  if (typeof source.elapsedMs === 'number') {
    footer.elapsed = formatElapsedMs(source.elapsedMs)
  }
  const tokens = source.usage ? formatTokens(source.usage) : undefined
  if (tokens) footer.tokens = tokens
  return footer
}

/** Same shape as StreamingCard.formatElapsed; kept local to avoid a cycle. */
export function formatElapsedMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}
