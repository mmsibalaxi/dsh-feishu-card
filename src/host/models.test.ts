import { describe, expect, it } from 'vitest'
import {
  decodeModelRoute,
  encodeModelRoute,
  harvestFromSettings,
  readModelCatalog,
} from './models.ts'
import type { Context } from '@deepseek-ai/cordis'

const ctxWith = (services: Record<string, unknown>): Context =>
  ({ get: (name: string) => services[name] }) as unknown as Context

const llm = (providers: string[], models: Record<string, any[]>) => ({
  listProviders: () => providers.map((provider) => ({ provider, displayName: provider })),
  listModels: async (provider: string) => models[provider] ?? [],
})

describe('readModelCatalog', () => {
  it('offers every advertised model from every provider', async () => {
    const catalog = await readModelCatalog(
      ctxWith({
        llm: llm(
          ['magpie', 'deepseek'],
          {
            magpie: [
              { provider: 'magpie', id: 'auto/step-5-preview', name: 'Step 5 Preview', contextWindow: 1000000 },
              { provider: 'magpie', id: 'auto/glm-5.3-flash', name: '' },
            ],
            deepseek: [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }],
          },
        ),
      }),
    )
    expect(catalog.choices).toEqual([
      { provider: 'magpie', model: 'auto/step-5-preview', label: 'Step 5 Preview', contextWindow: 1000000 },
      { provider: 'magpie', model: 'auto/glm-5.3-flash', label: 'auto/glm-5.3-flash' },
      { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Chat' },
    ])
    expect(catalog.error).toBeUndefined()
  })

  it('skips a provider whose adapter refuses, keeping the rest', async () => {
    const catalog = await readModelCatalog(
      ctxWith({
        llm: {
          listProviders: () => [{ provider: 'good' }, { provider: 'bad' }],
          listModels: async (provider: string) => {
            if (provider === 'bad') throw new Error('offline')
            return [{ provider: 'good', id: 'm1', name: 'M1' }]
          },
        },
      }),
    )
    expect(catalog.choices.map((c) => c.model)).toEqual(['m1'])
    expect(catalog.error).toBeUndefined()
  })

  it('carries the host default so the panel can label the empty option', async () => {
    const catalog = await readModelCatalog(
      ctxWith({
        llm: llm(['magpie'], { magpie: [{ provider: 'magpie', id: 'auto/x', name: 'X' }] }),
        agentDefaultModel: { currentSelection: () => ({ provider: 'magpie', model: 'auto/x' }) },
      }),
    )
    expect(catalog.fallback).toEqual({ provider: 'magpie', model: 'auto/x' })
  })

  it('has no fallback when the host default is unset or half-set', async () => {
    const base = {
      llm: llm(['magpie'], { magpie: [{ provider: 'magpie', id: 'auto/x', name: 'X' }] }),
    }
    expect((await readModelCatalog(ctxWith({ ...base, agentDefaultModel: {} }))).fallback).toBeUndefined()
    expect(
      (await readModelCatalog(ctxWith({ ...base, agentDefaultModel: { currentSelection: () => ({}) } }))).fallback,
    ).toBeUndefined()
    expect(
      (await readModelCatalog(ctxWith({ ...base, agentDefaultModel: { currentSelection: () => ({ provider: 'p' }) } })))
        .fallback,
    ).toBeUndefined()
  })

  it('reports why the list is empty instead of showing a bare dropdown', async () => {
    const catalog = await readModelCatalog(ctxWith({ llm: llm(['magpie'], {}) }))
    expect(catalog.choices).toEqual([])
    expect(catalog.error).toContain('没有可选的模型')
  })

  it('degrades to manual entry when no llm service exists', async () => {
    const catalog = await readModelCatalog(ctxWith({}))
    expect(catalog.choices).toEqual([])
    expect(catalog.error).toContain('没有模型服务')
  })

  it('falls back to the settings document when the adapter has no credential', async () => {
    // Verified live: pi-ai answers MISSING_CREDENTIAL with an empty list, so a
    // dormant profile would otherwise show an empty dropdown.
    const catalog = await readModelCatalog(
      ctxWith({
        llm: llm(['magpie'], { magpie: [] }),
        settings: {
          describe: () => [
            {
              ns: 'llm-pi-ai',
              value: {
                providers: {
                  magpie: {
                    models: [
                      { id: 'auto/step-5-preview', name: 'Step 5 Preview', contextWindow: 1000000 },
                      { id: 'auto/glm-5.3-flash', name: 'GLM-5.3-Flash' },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    )
    expect(catalog.choices).toEqual([
      { provider: 'magpie', model: 'auto/step-5-preview', label: 'Step 5 Preview', contextWindow: 1000000 },
      { provider: 'magpie', model: 'auto/glm-5.3-flash', label: 'GLM-5.3-Flash' },
    ])
    expect(catalog.error).toBeUndefined()
  })

  it('merges both sources without duplicating a model', async () => {
    const catalog = await readModelCatalog(
      ctxWith({
        llm: llm(['magpie'], {
          magpie: [
            { provider: 'magpie', id: 'auto/step-5-preview', name: 'Step 5 Preview' },
            { provider: 'magpie', id: 'auto/extra', name: 'Only the adapter knows' },
          ],
        }),
        settings: {
          describe: () => [
            { ns: 'llm-pi-ai', value: { providers: { magpie: { models: [{ id: 'auto/step-5-preview', name: 'Step 5 Preview' }] } } } },
          ],
        },
      }),
    )
    expect(catalog.choices.map((c) => c.model)).toEqual(['auto/step-5-preview', 'auto/extra'])
  })
})

describe('harvestFromSettings', () => {
  const ctx = (descriptors: unknown[]): Context =>
    ({ get: () => ({ describe: () => descriptors }) }) as unknown as Context

  it('reads providers.<route>.models[] and ignores every other shape', () => {
    const choices = harvestFromSettings(
      ctx([
        { ns: 'feishu-card', value: { appId: 'cli_x' } },
        { ns: 'llm-pi-ai', value: { providers: { magpie: { models: [{ id: 'm1', name: 'M1' }] } } } },
        { ns: 'other', value: { providers: { p: { models: 'not-an-array' } } } },
        { ns: 'broken', value: { providers: { p: { models: [{ id: '' }, null, { name: 'no id' }] } } } },
      ]),
    )
    expect(choices).toEqual([{ provider: 'magpie', model: 'm1', label: 'M1' }])
  })

  it('is empty when the settings service is absent or refuses', () => {
    expect(harvestFromSettings(({ get: () => undefined }) as unknown as Context)).toEqual([])
    expect(
      harvestFromSettings(
        ({
          get: () => ({
            describe: () => {
              throw new Error('nope')
            },
          }),
        }) as unknown as Context,
      ),
    ).toEqual([])
  })
})

describe('model route encoding', () => {
  it('round-trips a route', () => {
    const encoded = encodeModelRoute('magpie', 'auto/step-5-preview')
    expect(encoded).toBe('magpie\u0000auto/step-5-preview')
    expect(decodeModelRoute(encoded)).toEqual({ provider: 'magpie', model: 'auto/step-5-preview' })
  })

  it('rejects values that are not routes', () => {
    expect(decodeModelRoute('')).toBeUndefined()
    expect(decodeModelRoute('\u0000model')).toBeUndefined()
    expect(decodeModelRoute('provider\u0000')).toBeUndefined()
    expect(decodeModelRoute('no-separator')).toBeUndefined()
  })
})
