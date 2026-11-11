/**
 * Host half — plugin entry.
 *
 * M1b scope: real Feishu long connection, per-chat DSH sessions, dual
 * allowlists, plain-text replies. M2 adds CardKit streaming cards, M3 the
 * hermes-style footer.
 */
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import path from 'node:path'
import Config, { readConfig, type RawConfig, type ResolvedConfig } from './config.ts'
import { decideAccess, describeDeny, type AccessRequest } from './access.ts'
import { createRuntime, type FeishuCardRuntime } from './runtime.ts'
import { registerPanelRoutes } from './route.ts'
import { readModelCatalog } from './models.ts'
import { RecentContacts } from './recent.ts'
import { DirectorySearch } from './directory.ts'
import { ChatNames, NameBook } from './names.ts'
import { PLUGIN_ID } from '../shared/types.js'

/** `~/.dsh` (or `$DSH_HOME`), the one place this plugin keeps its own files. */
function homeDir(): string {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

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
export const inject = ['settings', 'agents', 'sessionPersistence']

/**
 * Register our own settings-page policy: we ship a browser card
 * (src/client), so the settings service must not also auto-generate a page for
 * this entry. Best-effort — a profile without the settings service still runs
 * the bridge, it just loses the panel form.
 */
function registerPagePolicy(ctx: Context): void {
  try {
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }))
    })
  } catch (error) {
    ctx.logger.warn(`feishu-card: settings service unavailable (${error}) — edit the profile patch instead`)
  }
}

function logPosture(ctx: Context, config: ResolvedConfig): void {
  const dm =
    config.dmPolicy === 'disabled'
      ? 'disabled'
      : config.dmPolicy === 'open'
        ? 'open'
        : `allowlist (${config.allowlist.length} open_id)`
  const group =
    config.groupPolicy === 'disabled'
      ? 'disabled'
      : config.groupPolicy === 'open'
        ? 'open'
        : `allowlist (${config.groupAllowlist.length} chat_id)`
  const dormant = !config.appId || !config.appSecret
  ctx.logger.info(
    `feishu-card: ${dormant ? 'dormant (appId/appSecret not configured)' : 'armed'} — ` +
      `dm=${dm} group=${group} mention=${config.requireMentionInGroups} reply=${config.replyMode}`,
  )
}

/** Kept exported for the M1b gateway and for tests that need the same call. */
export function evaluate(ctx: Context, config: ResolvedConfig, request: AccessRequest) {
  const decision = decideAccess(request, config)
  if (!decision.allowed) {
    ctx.logger.debug(
      `feishu-card: denied chat=${request.chatId} sender=${request.senderOpenId} ` +
        `reason=${decision.reason} (${describeDeny(decision.reason)})`,
    )
  }
  return decision
}

export async function apply(ctx: Context, config: RawConfig): Promise<void> {
  ctx.logger.info(`feishu-card: entry ${PLUGIN_ID} loaded`)

  registerPagePolicy(ctx)

  // `config` is the plugin's validated config object; its `.volatile()` fields
  // are live references the settings service updates in place. Reading through
  // readConfig() on every message is therefore enough for panel edits to take
  // effect without restarting dsh (HMR or not).
  const read = () => readConfig(config)
  const initial = read()
  logPosture(ctx, initial)

  // The panel needs two Host-side reads that the browser cannot do itself:
  // the model list (`ctx.llm.listModels` is not a Remote method) and the people
  // the bot has already heard from. Both must exist even while the bridge is
  // dormant — that is exactly when somebody is filling the form in.
  const recent = new RecentContacts({
    file: path.join(homeDir(), 'feishu-card', 'recent.json'),
    log: (message) => ctx.logger.debug(message),
  })
  ctx.effect(() => {
    // Best effort: the file is a convenience cache, not state of record.
    void recent.load()
    return () => {
      void recent.flush()
    }
  }, 'feishu-card: recent contacts')

  // Ids are what the APIs take; names are what a person reads. One disk cache
  // for both kinds, so the panel keeps showing 张三 / 研发群 across restarts and
  // across a dead delegated token (2026-11-10).
  const nameBook = new NameBook({
    file: path.join(homeDir(), 'feishu-card', 'names.json'),
    log: (message) => ctx.logger.debug(message),
  })
  const chatNames = new ChatNames({
    read: () => {
      const live = read()
      return { appId: live.appId, appSecret: live.appSecret, brand: live.brand }
    },
    // A group found by search is a group worth naming from now on.
    remember: (names) => nameBook.rememberChats(names),
    log: (message) => ctx.logger.debug(message),
  })
  ctx.effect(() => {
    void nameBook.load()
    return () => {
      void nameBook.flush()
    }
  }, 'feishu-card: name cache')

  // "Search the directory as me": the bot's own 通讯录 scope is one person, but
  // the person's own visibility is the whole company. Rides the Device Flow, so
  // there is no redirect URL to register and no callback listener to run.
  const directory = new DirectorySearch({
    read: () => {
      const live = read()
      return { appId: live.appId, appSecret: live.appSecret, brand: live.brand }
    },
    file: path.join(homeDir(), 'feishu-card', 'user-token.json'),
    names: nameBook,
    log: (message) => ctx.logger.debug(message),
  })
  ctx.effect(() => {
    void directory.load()
    return () => {}
  }, 'feishu-card: delegated token')

  /** Chat names: cache first, then the bot's own `im/v1/chats/{id}`. */
  const resolveChatNames = async (ids: readonly string[]): Promise<Record<string, string>> => {
    const known = nameBook.chatsOf(ids)
    const missing = ids.filter((id) => !known[id])
    if (missing.length === 0) return known
    const resolved = await chatNames.resolve(missing)
    nameBook.rememberChats(resolved)
    return { ...known, ...resolved }
  }

  registerPanelRoutes(
    ctx,
    {
      listModels: () => readModelCatalog(ctx),
      recent: () => ({ people: recent.list(), chats: recent.chats() }),
      directory,
      names: {
        users: (ids) => directory.names(ids),
        chats: resolveChatNames,
        chatSearch: (query) => chatNames.search(query),
      },
    },
    (message) => ctx.logger.info(message),
  )

  if (!initial.appId || !initial.appSecret) {
    ctx.logger.warn(
      'feishu-card: appId/appSecret missing — fill them in the Plugins settings page ' +
        '(设置 → 插件 → dsh-feishu-card) to start the bridge',
    )
    return
  }

  // `directory` also feeds the `[发送人 姓名 (open_id)]` header on every message,
  // so a turn costs at most one cached lookup per unknown person. `names` is the
  // disk cache, which keeps those headers working while the token is dead.
  const runtime: FeishuCardRuntime = createRuntime(ctx, read, initial, {
    recent,
    directory,
    names: nameBook,
  })

  // Cordis has no typed 'dispose' event; an async effect is the supported way
  // to pair "start on activation" with "stop on unload".
  ctx.effect(async () => {
    await runtime.start()
    return () => {
      void runtime.stop().catch((error) => {
        ctx.logger.warn(`feishu-card: shutdown failed: ${error}`)
      })
    }
  })
}

/**
 * No `export default`: cordis reads `plugin.Config` off the module namespace to
 * build the settings form, and a default export makes the loader treat the
 * module as a plain function plugin — which silently drops the Config and with
 * it the whole panel form (verified: the entry vanished from
 * `ctx.settings.describe()` until this export was removed).
 */
export type { RawConfig, ResolvedConfig } from './config.ts'
// Value re-export: cordis reads `plugin.Config` off the module namespace to
// build the settings form, so it must survive bundling.
export { Config, readConfig }
