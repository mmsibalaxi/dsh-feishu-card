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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter';
export interface UsageReading {
    /** Occupancy numerator (tokens). */
    usedTokens?: number;
    /** Occupancy denominator (tokens); request-reported when available. */
    contextWindow?: number;
    usage?: TokenUsageProjection;
}
export declare function readUsage(ctx: Context, agent: Agent, fallbackWindow?: number): UsageReading;
