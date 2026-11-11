// Build: esbuild bundles our own code only; every runtime dependency stays
// external so it resolves from the profile's node_modules (host) or from the
// injected official client packages (browser).
//
//   node scripts/build.mjs            build once
//   node scripts/build.mjs --watch    rebuild on change
//
// We ship the produced lib/ in the repo and declare no prepare/postinstall
// script, so the desktop plugin installer never has to approve build scripts
// (same approach as dsh-bottom-stats).
import { build, context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

/** Everything the host/app provides at runtime must stay external (host half). */
const hostExternal = ['@larksuiteoapi/*', '@deepseek-ai/*', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/*']

/**
 * Client half: a classic-script CJS bundle.
 *
 * Three constraints, all learned the hard way (verified in a real browser):
 *  1. The DSH client module system evaluates plugin bundles as classic scripts
 *     and reads `apply` / `inject` off a `module.exports` shim, registered via
 *     `window.__ModuleLoader__.load({id, factory})`. An ESM bundle dies with
 *     `SyntaxError: Unexpected token 'export'`.
 *  2. React must stay EXTERNAL so esbuild emits `require("react/…")`, which the
 *     factory's `require` resolves to the app's single React instance.
 *     Bundling our own copy breaks every hook ("Invalid hook call … more than
 *     one copy of React"), which is exactly how the official packages do it.
 *  3. No bare ESM imports — the browser cannot resolve them.
 */
const clientExternal = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*', '@deepseek-ai/*']

const entries = [
  { name: 'host', entry: 'src/host/index.ts', platform: 'node', target: 'node22', external: hostExternal },
  {
    name: 'client',
    entry: 'src/client/index.tsx',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    format: 'cjs',
    external: clientExternal,
    banner: {
      js: [
        'window.__ModuleLoader__.load({',
        '  id: "dsh-feishu-card",',
        '  factory: (require) => {',
        '    var module = { exports: {} };',
        '    var exports = module.exports;',
        '    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
      ].join('\n'),
    },
    footer: {
      js: ['    return module.exports;', '  },', '})'].join('\n'),
    },
  },
]

const optionsFor = (entry) => ({
  entryPoints: [{ in: path.join(root, entry.entry), out: 'index' }],
  outdir: path.join(root, 'lib', entry.name),
  bundle: true,
  format: entry.format ?? 'esm',
  platform: entry.platform,
  target: entry.target,
  jsx: entry.jsx,
  external: entry.external,
  banner: entry.banner,
  footer: entry.footer,
  sourcemap: true,
  // Keep non-ASCII (every label in our settings card) as real characters.
  // esbuild's default escapes them to \uXXXX, which works but makes the
  // shipped bundle unreadable when debugging in the browser.
  charset: 'utf8',
  logLevel: 'info',
})

if (watch) {
  for (const entry of entries) {
    const ctx = await context(optionsFor(entry))
    await ctx.watch()
    process.stdout.write(`watching ${entry.entry} -> lib/${entry.name}\n`)
  }
} else {
  for (const entry of entries) await build(optionsFor(entry))
  process.stdout.write(`built: ${entries.map((e) => e.name).join(', ')}\n`)
}
