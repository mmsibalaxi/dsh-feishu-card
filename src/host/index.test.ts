import { describe, expect, it } from 'vitest'
import * as host from './index.ts'

/**
 * Guards the plugin's module shape, which cordis and the settings service
 * depend on. Both assertions below correspond to bugs that were only found by
 * booting a real profile (see PROGRESS.md 2026-10-19 19:1x):
 *
 *  1. No `export default` — a default export makes the loader treat the module
 *     as a plain function plugin, so `runtime.Config` is undefined and the
 *     entry never appears in `ctx.settings.describe()` (no panel form at all).
 *  2. `Config` must be a value export — bundling tree-shakes an import that is
 *     only used internally.
 */
describe('host module shape', () => {
  it('exports no default', () => {
    expect(Object.keys(host)).not.toContain('default')
  })

  it('exports the Config schema as a value', () => {
    expect(typeof host.Config).toBe('function')
    expect(host.Config['~standard']).toBeTruthy()
    expect(typeof host.Config.toJSON).toBe('function')
  })

  it('exports readConfig, apply, inject and evaluate', () => {
    expect(typeof host.readConfig).toBe('function')
    expect(typeof host.apply).toBe('function')
    expect(typeof host.evaluate).toBe('function')
    expect(Array.isArray(host.inject)).toBe(true)
  })

  it('declares the services it consumes', () => {
    expect(host.inject).toEqual(['settings', 'agents', 'sessionPersistence'])
  })
})
