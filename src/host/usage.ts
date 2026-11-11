/**
 * Read per-session token usage and context occupancy from DSH's own
 * projections.
 *
 * Source: `@deepseek-ai/dsh-token-meter` folds two session-projection units —
 *   tokenUsage      → { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
 *   contextPressure → { contextWindow?, pressureTokens?, projectedTokens? }
 * `projectedTokens` is the sample plus the surface's movement since it was
 * taken, i.e. occupancy for the NEXT request — which is what makes a live
 * footer possible during a streaming turn.
 *
 * Everything here degrades to "unknown": a host without token-meter, or a
 * session whose projection cells have not been materialized yet, simply yields
 * no figures and the footer drops those fields.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'
import { trace } from './trace.ts'

export interface UsageReading {
  /** Occupancy numerator (tokens). */
  usedTokens?: number
  /** Occupancy denominator (tokens); request-reported when available. */
  contextWindow?: number
  usage?: TokenUsageProjection
}

/** Minimal face of the projections registry we depend on. */
interface ProjectionsFace {
  snapshot(
    session: unknown,
    keys?: readonly string[],
  ): { values: Record<string, unknown> }
}

export function readUsage(ctx: Context, agent: Agent, fallbackWindow?: number): UsageReading {
  // `ctx.get()`, not `ctx.sessionProjections`: the context proxy throws
  // "cannot get property ... without inject" for any service missing from the
  // plugin's inject list, and token-meter is an optional dependency here.
  const projections = ctx.get('sessionProjections') as ProjectionsFace | undefined
  if (!projections) {
    trace('usage-no-service', { fallbackWindow: fallbackWindow ?? null })
    return fallbackWindow ? { contextWindow: fallbackWindow } : {}
  }

  let values: Record<string, unknown>
  try {
    values = projections.snapshot(agent.session, ['tokenUsage', 'contextPressure']).values ?? {}
  } catch (error) {
    trace('usage-snapshot-failed', { error: String(error) })
    return fallbackWindow ? { contextWindow: fallbackWindow } : {}
  }

  const pressure = values.contextPressure as
    | { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }
    | undefined
  const usage = values.tokenUsage as TokenUsageProjection | undefined

  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow ?? fallbackWindow
  const reading: UsageReading = {
    usedTokens: typeof usedTokens === 'number' ? usedTokens : undefined,
    contextWindow: typeof contextWindow === 'number' ? contextWindow : undefined,
    usage: usage && typeof usage === 'object' ? usage : undefined,
  }
  trace('usage-reading', {
    usedTokens: reading.usedTokens ?? null,
    contextWindow: reading.contextWindow ?? null,
    fallbackWindow: fallbackWindow ?? null,
    hasPressure: Boolean(pressure),
    hasUsage: Boolean(usage),
    pressureKeys: pressure ? Object.keys(pressure) : [],
  })
  return reading
}
