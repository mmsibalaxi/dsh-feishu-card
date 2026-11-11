/**
 * Model → context-window registry.
 *
 * The whole Feishu-bridge ecosystem is missing this primitive: hermes reads it
 * from config.yaml's custom_providers, every DSH bridge either omits the
 * percentage or hardcodes it. We ship a built-in table, let the panel override
 * it per model, and fall back to the request-reported window when the session
 * projection provides one (which it normally does).
 *
 * Values are tokens. Unknown models return undefined — callers then omit the
 * percentage rather than invent a number.
 */
/**
 * Resolve a model's context window.
 *
 * Precedence: exact config override → built-in table → provider-prefix match
 * (e.g. `deepseek/foo` matches the `deepseek` entry) → undefined.
 */
export declare function resolveContextWindow(model: string | undefined, overrides?: Record<string, number>): number | undefined;
/** Exposed for the settings page's helper text. */
export declare function knownContextWindows(): Record<string, number>;
