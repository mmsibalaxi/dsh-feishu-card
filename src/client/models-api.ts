/**
 * The panel's side of the one Host route it uses: the model list.
 *
 * Kept apart from the component so the wire contract is unit-tested without a
 * DOM. The route lives on the Host (src/host/route.ts); the panel reaches it
 * same-origin.
 */

export const MODELS_PATH = '/api/feishu-card/models'

/** One selectable model from the Host's adapter registry. */
export interface ModelChoice {
  provider: string
  model: string
  label: string
  contextWindow?: number
}

export interface ModelCatalog {
  choices: ModelChoice[]
  fallback?: { provider: string; model: string }
  error?: string
}

/** Coerce the model list the Host advertised. */
export function parseModels(payload: unknown): ModelCatalog {
  if (typeof payload !== 'object' || payload === null) return { choices: [] }
  const body = payload as { choices?: unknown; fallback?: unknown; error?: unknown }
  const choices: ModelChoice[] = []
  if (Array.isArray(body.choices)) {
    for (const raw of body.choices) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { provider?: unknown; model?: unknown; label?: unknown; contextWindow?: unknown }
      if (typeof row.provider !== 'string' || typeof row.model !== 'string' || !row.model) continue
      choices.push({
        provider: row.provider,
        model: row.model,
        label: typeof row.label === 'string' && row.label ? row.label : row.model,
        ...(typeof row.contextWindow === 'number' ? { contextWindow: row.contextWindow } : {}),
      })
    }
  }
  const fallback =
    typeof body.fallback === 'object' && body.fallback !== null
      ? (body.fallback as { provider?: unknown; model?: unknown })
      : undefined
  return {
    choices,
    ...(fallback && typeof fallback.provider === 'string' && typeof fallback.model === 'string'
      ? { fallback: { provider: fallback.provider, model: fallback.model } }
      : {}),
    ...(typeof body.error === 'string' && body.error ? { error: body.error } : {}),
  }
}
