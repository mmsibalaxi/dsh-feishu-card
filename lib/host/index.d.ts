/**
 * Host half — plugin entry.
 *
 * M1b scope: real Feishu long connection, per-chat DSH sessions, dual
 * allowlists, plain-text replies. M2 adds CardKit streaming cards, M3 the
 * hermes-style footer.
 */
import type { Context } from '@deepseek-ai/cordis';
import Config, { readConfig, type RawConfig, type ResolvedConfig } from './config.ts';
import { type AccessRequest } from './access.ts';
/**
 * Service keys we consume. Keep this list minimal: an absent service fails the
 * plugin's load, so only list what this file actually uses.
 *   - settings      → our own config form (panel)
 *   - agents        → create/resume per-chat agents
 *   - sessionPersistence → required by agents.resume()
 *
 * Deliberately NOT listed: `agentDefaultModel`, `agentPresets`,
 * `sessionProjections`. They are all optional here (a profile may lack the
 * preset registry or token-meter) and are read through `ctx.get(name)` — the
 * reflection layer's inject-free read, which yields `undefined` instead of
 * throwing. Reading them as `ctx.<name>` would fail at runtime with
 *   cannot get property "<name>" without inject
 * because the cordis Context is a Proxy that rejects every service outside
 * this list (verified live on 2026-10-20; see PROGRESS.md).
 *
 * No `export default`: cordis reads `plugin.Config` off the module namespace to
 * build the settings form, and a default export makes the loader treat the
 * module as a plain function plugin — which silently drops the Config and with
 * it the whole panel form (verified: the entry vanished from
 * `ctx.settings.describe()` until this export was removed).
 */
export declare const inject: string[];
/** Kept exported for the M1b gateway and for tests that need the same call. */
export declare function evaluate(ctx: Context, config: ResolvedConfig, request: AccessRequest): import("./access.ts").AccessDecision;
export declare function apply(ctx: Context, config: RawConfig): Promise<void>;
/**
 * No `export default`: cordis reads `plugin.Config` off the module namespace to
 * build the settings form, and a default export makes the loader treat the
 * module as a plain function plugin — which silently drops the Config and with
 * it the whole panel form (verified: the entry vanished from
 * `ctx.settings.describe()` until this export was removed).
 */
export type { RawConfig, ResolvedConfig } from './config.ts';
export { Config, readConfig };
