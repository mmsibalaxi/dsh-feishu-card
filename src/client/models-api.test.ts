import { describe, expect, it } from 'vitest'
import { MODELS_PATH, parseModels } from './models-api.ts'

describe('MODELS_PATH', () => {
  it('is the same-origin route the Host mounts', () => {
    expect(MODELS_PATH).toBe('/api/feishu-card/models')
  })
})

describe('parseModels', () => {
  it('keeps usable choices and drops malformed ones', () => {
    const parsed = parseModels({
      ok: true,
      choices: [
        { provider: 'magpie', model: 'auto/step-5-preview', label: 'Step 5 Preview', contextWindow: 1000000 },
        { provider: 'magpie', model: '' },
        { model: 'no-provider' },
        null,
      ],
      fallback: { provider: 'magpie', model: 'auto/x' },
    })
    expect(parsed.choices).toEqual([
      { provider: 'magpie', model: 'auto/step-5-preview', label: 'Step 5 Preview', contextWindow: 1000000 },
    ])
    expect(parsed.fallback).toEqual({ provider: 'magpie', model: 'auto/x' })
  })

  it('falls back to the model id when the adapter named nothing', () => {
    expect(parseModels({ choices: [{ provider: 'p', model: 'm' }] }).choices[0].label).toBe('m')
  })

  it('carries the empty-catalog reason', () => {
    expect(parseModels({ choices: [], error: '宿主没有可选的模型' }).error).toBe('宿主没有可选的模型')
  })

  it('survives garbage', () => {
    expect(parseModels(null)).toEqual({ choices: [] })
    expect(parseModels({ choices: 'nope' })).toEqual({ choices: [] })
    expect(parseModels({ fallback: 'nope' })).toEqual({ choices: [] })
  })
})
