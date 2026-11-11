/**
 * The model list the settings panel's dropdown offers.
 *
 * The panel needs one control instead of two (provider + id), and it has to
 * offer what the Host can actually route. `ctx.llm` is the authority — it owns
 * the adapter registry — but `listModels` is not a `@Remote` method, so the
 * browser cannot call it directly. This runs on the Host and is published over
 * the same same-origin route the id pickers use (see route.ts).
 */
import type { Context } from '@deepseek-ai/cordis';
/** One selectable model. */
export interface ModelChoice {
    provider: string;
    model: string;
    /** Display name from the adapter, falling back to the id. */
    label: string;
    contextWindow?: number;
}
/** What the panel needs to render the dropdown. */
export interface ModelCatalog {
    choices: ModelChoice[];
    /** The Host's own default selection, shown as the "跟随默认模型" hint. */
    fallback?: {
        provider: string;
        model: string;
    };
    error?: string;
}
/**
 * Read every advertised model from every registered provider.
 *
 * Two sources, because either alone can come back empty:
 *  - the adapter catalog (`ctx.llm.listModels`), which is the authority on what
 *    a provider can route, but returns `[]` when the provider's credential is
 *    unresolved (verified live: pi-ai answers MISSING_CREDENTIAL with an empty
 *    list rather than an error);
 *  - the settings document, where a configurable provider declares its models
 *    (`providers.<route>.models[]`) — no credential needed, and it is what the
 *    Host's own model picker shows.
 *
 * A provider whose adapter refuses is skipped rather than failing the whole
 * list: the dropdown should still offer the providers that do answer.
 */
export declare function readModelCatalog(ctx: Context): Promise<ModelCatalog>;
/**
 * Harvest `providers.<route>.models[]` out of every settings namespace.
 *
 * The shape a configurable provider declares (see `llm.registerConfigurableProviders`),
 * read through the settings service the plugin already injects. Needs no
 * credential and no adapter, so it survives a dormant or half-configured
 * provider.
 */
export declare function harvestFromSettings(ctx: Context): ModelChoice[];
/** `provider\u0000model` — the value a `<option>` carries; a separator ids cannot contain. */
export declare function encodeModelRoute(provider: string, model: string): string;
/** Inverse of {@link encodeModelRoute}; undefined when the value is not a route. */
export declare function decodeModelRoute(value: string): {
    provider: string;
    model: string;
} | undefined;
/** Which option the current config selects, or '' for "follow the host". */
export declare function modelRouteOf(provider: string | undefined, model: string | undefined): string;
