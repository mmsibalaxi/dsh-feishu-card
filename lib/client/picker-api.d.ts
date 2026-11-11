/**
 * The panel's side of the id pickers: URL building and response parsing.
 *
 * Kept apart from the component so the wire contract is unit-tested without a
 * DOM. The routes themselves live on the Host (src/host/route.ts); the panel
 * reaches them same-origin, which is the whole reason this needs no secret and
 * survives CORS.
 */
export type PickerKind = 'people' | 'chats';
export interface PickerEntry {
    id: string;
    name: string;
    hint?: string;
}
export interface PickerResponse {
    entries: PickerEntry[];
    error?: string;
    /** Feishu's own authorization page, when the refusal named one. */
    applyUrl?: string;
}
export declare const DIRECTORY_PATH = "/api/feishu-card/directory";
export declare const RESOLVE_PATH = "/api/feishu-card/resolve";
export declare const MODELS_PATH = "/api/feishu-card/models";
export declare function directoryUrl(kind: PickerKind, query: string): string;
export declare function resolveUrl(ids: readonly string[]): string;
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
/** Coerce whatever came back into rows the list can render, never throwing. */
export declare function parseDirectory(payload: unknown): PickerResponse;
/** Coerce the model list the Host advertised. */
export declare function parseModels(payload: unknown): ModelCatalog;
/** `{ ok, names }` → id → display name. Unknown ids are simply absent. */
export declare function parseResolve(payload: unknown): Record<string, string>;
