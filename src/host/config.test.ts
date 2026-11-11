import { describe, expect, it } from 'vitest'
import Config, { readConfig } from './config.ts'

const base = { appId: 'cli_test', appSecret: 'secret' }

/** Mirror what cordis hands a plugin: `.volatile()` fields are references. */
function volatile<T>(value: T) {
  return {
    get: () => value,
    set: (next: T) => {
      value = next
    },
    [Symbol.for('cosmokit.volatile.write')]: () => undefined,
  }
}

const rawConfig = (over: Record<string, unknown> = {}) => ({
  appId: volatile('cli_test'),
  appSecret: volatile('secret'),
  brand: volatile('feishu'),
  dmPolicy: volatile('allowlist'),
  allowlist: volatile([] as string[]),
  groupPolicy: volatile('allowlist'),
  groupAllowlist: volatile([] as string[]),
  requireMentionInGroups: volatile(true),
  respondToMentionAll: volatile(false),
  sessionScope: volatile('chat'),
  replyMode: volatile('streaming'),
  footerFields: volatile(['status', 'model', 'context', 'elapsed']),
  flushIntervalMs: volatile(800),
  model: volatile(''),
  contextWindows: volatile({} as Record<string, number>),
  defaultWorkspace: volatile(''),
  dedupTtlMs: 12 * 60 * 60 * 1000,
  ...over,
})

describe('Config schema defaults', () => {
  it('applies fail-closed defaults', () => {
    const resolved = readConfig(Config(base) as never)
    expect(resolved.dmPolicy).toBe('allowlist')
    expect(resolved.groupPolicy).toBe('allowlist')
    expect(resolved.allowlist).toEqual([])
    expect(resolved.groupAllowlist).toEqual([])
    expect(resolved.requireMentionInGroups).toBe(true)
    expect(resolved.replyMode).toBe('streaming')
    expect(resolved.sessionScope).toBe('chat')
    expect(resolved.brand).toBe('feishu')
    expect(resolved.dedupTtlMs).toBe(12 * 60 * 60 * 1000)
  })

  it('keeps supplied values', () => {
    const resolved = readConfig(
      Config({
        ...base,
        allowlist: ['ou_a', 'ou_b'],
        groupAllowlist: ['oc_g1'],
        footerFields: ['status', 'model'],
        flushIntervalMs: 1200,
        defaultWorkspace: 'D:\\work',
      }) as never,
    )
    expect(resolved.allowlist).toEqual(['ou_a', 'ou_b'])
    expect(resolved.groupAllowlist).toEqual(['oc_g1'])
    expect(resolved.footerFields).toEqual(['status', 'model'])
    expect(resolved.flushIntervalMs).toBe(1200)
    expect(resolved.defaultWorkspace).toBe('D:\\work')
  })

  it('wraps panel-editable fields in volatile references', () => {
    // This is the contract that makes panel edits live: cordis hands the
    // plugin references, and the settings service updates them in place.
    const resolved = Config(base) as Record<string, unknown>
    const ref = resolved.allowlist as { get(): unknown }
    expect(typeof ref.get).toBe('function')
    expect(ref.get()).toEqual([])
  })
})

describe('readConfig', () => {
  it('returns defaults when cordis passes undefined (row without a config block)', () => {
    // cordis: resolveConfig() returns `undefined` unchanged when the row has no
    // config, so apply(ctx, undefined) is a real case — verified by booting a
    // profile whose row carried no config.
    const config = readConfig(undefined)
    expect(config.appId).toBe('')
    expect(config.appSecret).toBe('')
    expect(config.dmPolicy).toBe('allowlist')
    expect(config.allowlist).toEqual([])
    expect(config.groupAllowlist).toEqual([])
    expect(config.footerFields).toEqual(['status', 'model', 'context', 'elapsed'])
    // 100ms: Hermes' cadence. 200ms (and 800ms before it) let text pile up
    // between writes, so Feishu printed it in blocks.
    expect(config.flushIntervalMs).toBe(100)
    expect(config.dedupTtlMs).toBe(12 * 60 * 60 * 1000)
  })

  it('unwraps volatile references into plain values', () => {
    const config = readConfig(rawConfig())
    expect(config.appId).toBe('cli_test')
    expect(config.appSecret).toBe('secret')
    expect(config.dmPolicy).toBe('allowlist')
    expect(config.footerFields).toEqual(['status', 'model', 'context', 'elapsed'])
    expect(config.dedupTtlMs).toBe(12 * 60 * 60 * 1000)
  })

  it('returns fresh arrays so callers cannot mutate the live config', () => {
    const raw = rawConfig({ allowlist: volatile(['ou_a']) })
    const first = readConfig(raw)
    first.allowlist.push('ou_evil')
    expect(readConfig(raw).allowlist).toEqual(['ou_a'])
  })

  it('reflects a live panel edit without a restart', () => {
    const policy = volatile<'allowlist' | 'open'>('allowlist')
    const raw = rawConfig({ dmPolicy: policy })
    expect(readConfig(raw).dmPolicy).toBe('allowlist')
    policy.set('open')
    expect(readConfig(raw).dmPolicy).toBe('open')
  })

  it('copies the contextWindows map', () => {
    const raw = rawConfig({ contextWindows: volatile({ 'deepseek-chat': 65536 }) })
    const config = readConfig(raw)
    expect(config.contextWindows).toEqual({ 'deepseek-chat': 65536 })
    config.contextWindows['x'] = 1
    expect(readConfig(raw).contextWindows).toEqual({ 'deepseek-chat': 65536 })
  })
})
