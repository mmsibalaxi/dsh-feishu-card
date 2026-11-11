/**
 * The model list the settings panel's dropdown offers.
 *
 * The panel needs one control instead of two (provider + id), and it has to
 * offer what the Host can actually route. `ctx.llm` is the authority — it owns
 * the adapter registry — but `listModels` is not a `@Remote` method, so the
 * browser cannot call it directly. This runs on the Host and is published over
 * the same same-origin route the id pickers use (see route.ts).
 */
import type { Context } from '@deepseek-ai/cordis'

/** One selectable model. */
export interface ModelChoice {
  provider: string
  model: string
  /** Display name from the adapter, falling back to the id. */
  label: string
  contextWindow?: number
}

/** What the panel needs to render the dropdown. */
export interface ModelCatalog {
  choices: ModelChoice[]
  /** The Host's own default selection, shown as the "跟随默认模型" hint. */
  fallback?: { provider: string; model: string }
  error?: string
}

/** The slice of `ctx.llm` this reads. */
interface LlmLike {
  listProviders(): { provider: string; displayName?: string }[]
  listModels(provider: string): Promise<
    { provider: string; id: string; name?: string; contextWindow?: number }[]
  >
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
export async function readModelCatalog(ctx: Context): Promise<ModelCatalog> {
  const fallback = readFallback(ctx)
  const fromSettings = harvestFromSettings(ctx)
  const choices: ModelChoice[] = [...fromSettings]
  const seen = new Set(choices.map((choice) => encodeModelRoute(choice.provider, choice.model)))

  const llm = (ctx.get('llm') as LlmLike | undefined) ?? undefined
  if (llm) {
    try {
      for (const provider of llm.listProviders()) {
        let models: Awaited<ReturnType<LlmLike['listModels']>> = []
        try {
          models = await llm.listModels(provider.provider)
        } catch {
          continue
        }
        for (const model of models) {
          const key = encodeModelRoute(provider.provider, model.id)
          if (seen.has(key)) continue
          seen.add(key)
          choices.push({
            provider: provider.provider,
            model: model.id,
            label: model.name?.trim() || model.id,
            ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
          })
        }
      }
    } catch (error) {
      if (choices.length === 0) {
        return { choices, error: `读取模型列表失败：${String(error).slice(0, 160)}` }
      }
    }
  }

  if (choices.length === 0) {
    return {
      choices,
      fallback,
      error: llm
        ? '没有可选的模型（provider 可能还没配好密钥），请手动填写模型 id。'
        : '当前环境没有模型服务，只能手动填写模型 id。',
    }
  }
  return { choices, fallback }
}

/**
 * Harvest `providers.<route>.models[]` out of every settings namespace.
 *
 * The shape a configurable provider declares (see `llm.registerConfigurableProviders`),
 * read through the settings service the plugin already injects. Needs no
 * credential and no adapter, so it survives a dormant or half-configured
 * provider.
 */
export function harvestFromSettings(ctx: Context): ModelChoice[] {
  const settings = (ctx.get('settings') as
    | { describe(): { ns: string; value?: unknown }[] }
    | undefined)
  if (!settings) return []
  const out: ModelChoice[] = []
  let descriptors: { ns: string; value?: unknown }[] = []
  try {
    descriptors = settings.describe()
  } catch {
    return []
  }
  for (const descriptor of descriptors) {
    const value = descriptor.value as
      | { providers?: Record<string, { models?: unknown }> }
      | undefined
    const providers = value?.providers
    if (!providers || typeof providers !== 'object') continue
    for (const [provider, profile] of Object.entries(providers)) {
      const models = (profile as { models?: unknown } | undefined)?.models
      if (!Array.isArray(models)) continue
      for (const model of models) {
        if (typeof model !== 'object' || model === null) continue
        const row = model as { id?: unknown; name?: unknown; contextWindow?: unknown }
        if (typeof row.id !== 'string' || !row.id) continue
        out.push({
          provider,
          model: row.id,
          label: typeof row.name === 'string' && row.name ? row.name : row.id,
          ...(typeof row.contextWindow === 'number' ? { contextWindow: row.contextWindow } : {}),
        })
      }
    }
  }
  return out
}

/** The Host's default model selection, when a service owns one. */
function readFallback(ctx: Context): ModelCatalog['fallback'] {
  const service = ctx.get('agentDefaultModel') as
    | { currentSelection?(): { provider?: string; model?: string } | undefined }
    | undefined
  const selection = service?.currentSelection?.()
  if (!selection?.provider || !selection.model) return undefined
  return { provider: selection.provider, model: selection.model }
}

/** `provider\u0000model` — the value a `<option>` carries; a separator ids cannot contain. */
export function encodeModelRoute(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** Inverse of {@link encodeModelRoute}; undefined when the value is not a route. */
export function decodeModelRoute(value: string): { provider: string; model: string } | undefined {
  const at = value.indexOf('\u0000')
  if (at <= 0 || at === value.length - 1) return undefined
  return { provider: value.slice(0, at), model: value.slice(at + 1) }
}

/** Which option the current config selects, or '' for "follow the host". */
export function modelRouteOf(provider: string | undefined, model: string | undefined): string {
  if (!provider || !model) return ''
  return encodeModelRoute(provider, model)
}
