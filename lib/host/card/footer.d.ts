/**
 * Footer value assembly and formatting.
 *
 * Target format (the user's hermes shape):
 *   已完成 · ⚕deepseek-chat · 31.1K/1.0M (3%) · 12.3s
 * with no cost field (explicitly removed by the user) and no duplicated stats
 * in the answer body.
 */
import type { FooterInput } from './seal.ts';
/** 1.2k / 8.0k / 31.1K / 1.0M — hermes' _compact(): always one decimal, `k` below 10k and `K` above. */
export declare function compactNumber(value: number): string;
/** `31.1K/1.0M (3%)`; returns undefined when there is nothing real to show. */
export declare function formatContext(used: number, window: number | undefined): string | undefined;
/**
 * Shorten a model id for the footer.
 *
 * A routing group spells its model `auto/step-5-preview`; the group prefix says
 * nothing to the person reading the card, so it is dropped. An explicit
 * `provider/model` keeps both halves, which do carry meaning.
 */
export declare function formatModel(model: string | undefined): string | undefined;
/** `↑ 1.2k ↓ 340` (+ cache when present). */
export declare function formatTokens(usage: {
    uncachedInputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}): string | undefined;
export interface FooterSource {
    status: string;
    model?: string;
    /** Occupancy numerator; usually the projection's projectedTokens. */
    usedTokens?: number;
    /** Denominator: the request-reported window, else the registry value. */
    contextWindow?: number;
    elapsedMs?: number;
    usage?: {
        uncachedInputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
    };
}
/**
 * Prompt-side occupancy from one usage sample: input plus cache traffic, no
 * output. This is hermes' `pressureFrom` — the only honest occupancy available
 * before the session projection has folded a `request/context` record, which is
 * exactly the window a live footer streams in.
 */
export declare function pressureTokens(usage: {
    uncachedInputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}): number;
/** Assemble a FooterInput from raw readings; missing pieces stay absent. */
export declare function buildFooterInput(source: FooterSource): FooterInput;
/** Same shape as StreamingCard.formatElapsed; kept local to avoid a cycle. */
export declare function formatElapsedMs(ms: number): string;
