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

/** Well-known windows. Deliberately small: overrides cover the rest. */
const BUILT_IN: Record<string, number> = {
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'deepseek-v3': 65536,
  'deepseek-v3.1': 65536,
  'deepseek-flash': 65536,
  'deepseek-v4-flash': 65536,
  'deepseek-v4-pro': 131072,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1047576,
  'gpt-5': 400000,
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
  'claude-3-5-sonnet': 200000,
  'glm-4.6': 200000,
  'glm-5': 200000,
  'glm-5.3': 200000,
  'glm-5.3-flash': 200000,
  'qwen-max': 32768,
  'qwen-plus': 131072,
  'qwen3-max': 262144,
  'kimi-k2': 262144,
  'mimo-v2.5-pro': 1000000,
  'step-5-preview': 200000,
}

/**
 * Resolve a model's context window.
 *
 * Precedence: exact config override → built-in table → provider-prefix match
 * (e.g. `deepseek/foo` matches the `deepseek` entry) → undefined.
 */
export function resolveContextWindow(
  model: string | undefined,
  overrides: Record<string, number> = {},
): number | undefined {
  if (!model) return undefined
  const exact = overrides[model]
  if (typeof exact === 'number' && exact > 0) return exact
  const known = BUILT_IN[model]
  if (typeof known === 'number' && known > 0) return known

  const slash = model.lastIndexOf('/')
  if (slash > 0) {
    // `provider/model` — try the provider prefix first, then the bare model id.
    const prefix = model.slice(0, slash)
    const suffix = model.slice(slash + 1)
    const byPrefix = overrides[prefix] ?? BUILT_IN[prefix]
    if (typeof byPrefix === 'number' && byPrefix > 0) return byPrefix
    const bySuffix = overrides[suffix] ?? BUILT_IN[suffix]
    if (typeof bySuffix === 'number' && bySuffix > 0) return bySuffix
  }
  // Longest-prefix match against every known key: `deepseek-v4-flash-preview`
  // should use the `deepseek-v4-flash` window rather than nothing.
  let best: [length: number, window: number] | undefined
  for (const [key, value] of Object.entries({ ...BUILT_IN, ...overrides })) {
    if (model.startsWith(key) && value > 0 && (!best || key.length > best[0])) {
      best = [key.length, value]
    }
  }
  return best?.[1]
}

/** Exposed for the settings page's helper text. */
export function knownContextWindows(): Record<string, number> {
  return { ...BUILT_IN }
}
