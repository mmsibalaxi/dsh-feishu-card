/**
 * The panel's side of the one Host route it uses: the model list.
 *
 * Kept apart from the component so the wire contract is unit-tested without a
 * DOM. The route lives on the Host (src/host/route.ts); the panel reaches it
 * same-origin.
 */
export declare const MODELS_PATH = "/api/feishu-card/models";
/** One selectable model from the Host's adapter registry. */
export interface ModelChoice {
    provider: string;
    model: string;
    label: string;
    contextWindow?: number;
}
export interface ModelCatalog {
    choices: ModelChoice[];
    fallback?: {
        provider: string;
        model: string;
    };
    error?: string;
}
/** Coerce the model list the Host advertised. */
export declare function parseModels(payload: unknown): ModelCatalog;
