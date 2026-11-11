import { describe, expect, it } from 'vitest'
import { decodeModelRoute, encodeModelRoute, modelRouteLabel, modelRouteOf } from './model-route.ts'

describe('modelRouteOf', () => {
  it('is empty when either half is missing, which means "follow the host"', () => {
    expect(modelRouteOf('', '')).toBe('')
    expect(modelRouteOf('magpie', '')).toBe('')
    expect(modelRouteOf('', 'auto/x')).toBe('')
    expect(modelRouteOf(undefined, undefined)).toBe('')
  })

  it('encodes a complete pair', () => {
    expect(modelRouteOf('magpie', 'auto/step-5-preview')).toBe('magpie\u0000auto/step-5-preview')
  })
})

describe('decodeModelRoute', () => {
  it('round-trips', () => {
    const value = modelRouteOf('magpie', 'auto/step-5-preview')
    expect(decodeModelRoute(value)).toEqual({ provider: 'magpie', model: 'auto/step-5-preview' })
  })

  it('rejects the empty option and malformed values', () => {
    expect(decodeModelRoute('')).toBeUndefined()
    expect(decodeModelRoute('plain')).toBeUndefined()
    expect(decodeModelRoute('\u0000model')).toBeUndefined()
    expect(decodeModelRoute('provider\u0000')).toBeUndefined()
  })

  it('keeps a model id that itself contains a slash', () => {
    expect(decodeModelRoute('magpie\u0000auto/step-5-preview')).toEqual({
      provider: 'magpie',
      model: 'auto/step-5-preview',
    })
  })
})

describe('encodeModelRoute / modelRouteLabel', () => {
  it('uses a separator no route or model id can contain', () => {
    expect(encodeModelRoute('a', 'b/c')).toBe('a\u0000b/c')
    expect(modelRouteLabel('magpie', 'auto/step-5-preview')).toBe('magpie/auto/step-5-preview')
  })
})
