/**
 * Smoke test for the built bundle: proves the host half loads outside the
 * harness and exports the shape cordis expects, and that the Config schema
 * still validates. Run after `npm run build`.
 *
 *   node scripts/smoke.mjs
 */
import assert from 'node:assert/strict'

const mod = await import('../lib/host/index.js')

assert.equal(typeof mod.Config, 'function', 'Config must be a schemastery schema')
assert.ok(Array.isArray(mod.inject), 'inject must be an array')
assert.ok(mod.inject.every((name) => typeof name === 'string'), 'inject entries must be strings')
assert.equal(typeof mod.apply, 'function', 'apply must be a function')
assert.equal(typeof mod.readConfig, 'function', 'readConfig must be exported')

// Regression guard: cordis reads `plugin.Config` off the module namespace to
// build the settings form. A default export makes the loader treat the module
// as a plain function plugin and silently drops it, and bundling tree-shakes an
// unexported import — either way the panel form disappears. Assert the real
// schema object survives.
assert.ok(mod.Config['~standard'], 'Config must be a standard-schema (has ~standard)')
assert.equal(typeof mod.Config.toJSON, 'function', 'Config must expose toJSON()')

// The schema must still resolve a minimal config with fail-closed defaults.
// `.volatile()` fields come back as references, so go through the exported
// readConfig() — the same path the runtime uses.
assert.equal(typeof mod.readConfig, 'function', 'readConfig must be exported')
const resolved = mod.readConfig(mod.Config({ appId: 'cli_smoke', appSecret: 'x' }))
assert.equal(resolved.appId, 'cli_smoke')
assert.equal(resolved.dmPolicy, 'allowlist')
assert.equal(resolved.groupPolicy, 'allowlist')
assert.deepEqual(resolved.allowlist, [])
assert.deepEqual(resolved.groupAllowlist, [])

// The client half is a classic-script CJS bundle: it registers itself with the
// page's module loader instead of using ESM exports, so `import()` yields an
// empty namespace and the real surface is the registration. Its factory takes
// the loader's `require`, which resolves bare specifiers (react, …) against the
// app's module table — in Node we resolve them from our own node_modules.
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      registrations.push(entry)
      return entry
    },
  },
}
await import('../lib/client/index.js')
assert.equal(registrations.length, 1, 'client bundle must register exactly one module')
assert.equal(registrations[0].id, 'dsh-feishu-card', 'registered module id must be the package name')
const clientExports = registrations[0].factory(require_)
assert.equal(typeof clientExports.apply, 'function', 'client factory must return apply')
assert.deepEqual(clientExports.inject, ['slots', 'configForms'], 'client inject list')

console.log('smoke ok:', {
  inject: mod.inject,
  clientInject: clientExports.inject,
  exports: Object.keys(mod).sort().join(','),
})
