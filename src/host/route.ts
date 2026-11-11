/**
 * The one same-origin HTTP route the settings panel uses: the model list.
 *
 * Why HTTP and not a Typert Remote namespace: the panel runs in the renderer,
 * and `ctx.llm.listModels` is not a `@Remote` method, so the browser cannot call
 * it directly. The Host already serves the GUI itself, so one exact route on
 * `webServer` is reachable from the panel with a plain
 * `fetch('/api/feishu-card/models')` — no new dependency, no CORS.
 *
 * Contact/group lookups used to live here too and were removed: Feishu will not
 * let a bot search the directory by name (`search/v1/user` needs a
 * user_access_token), and this app's 通讯录 data scope is a single person, so
 * the picker could only ever show one row. Manual id entry plus a hint is
 * honest about that; see references/panel-rules.md §12.5.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalog } from './models.ts'

export const MODELS_PATH = '/api/feishu-card/models'
export const RECENT_PATH = '/api/feishu-card/recent'
export const AUTH_PATH = '/api/feishu-card/auth'
export const SEARCH_PATH = '/api/feishu-card/search'
export const NAMES_PATH = '/api/feishu-card/names'
export const CHAT_SEARCH_PATH = '/api/feishu-card/chat-search'

/** One sender the bot has heard from, as the panel's shortcut row shows it. */
export interface RecentEntry {
  openId: string
  chatId: string
  at: number
  count: number
}

/** What the routes need from the plugin's host side. */
export interface PanelRouteDeps {
  listModels(): Promise<ModelCatalog>
  /** People and chats the bot has already seen — needs no Feishu permission. */
  recent(): { people: RecentEntry[]; chats: { chatId: string; at: number }[] }
  /** Delegated (user-token) directory search; see directory.ts. */
  directory: {
    state(): {
      authorized: boolean
      needAuth?: boolean
      userName?: string
      pending?: unknown
      error?: string
    }
    begin(): Promise<{ authorized: boolean; userName?: string; pending?: unknown; error?: string }>
    poll(): Promise<{ authorized: boolean; userName?: string; pending?: unknown; error?: string }>
    forget(): Promise<void>
    search(query: string): Promise<{ people: { openId: string; name: string }[]; error?: string }>
  }
  /**
   * Display names for stored ids, split by kind.
   *
   * Users come from the delegated token (cached on disk), chats from the bot's
   * own identity — so a group chip keeps its name even when the person's
   * authorisation has expired.
   */
  names: {
    users(ids: readonly string[]): Promise<{ names: Record<string, string>; error?: string }>
    chats(ids: readonly string[]): Promise<Record<string, string>>
    /** Group search by name, on the BOT's identity (no delegated token needed). */
    chatSearch(query: string): Promise<{
      chats: { chatId: string; name: string }[]
      error?: string
    }>
  }
}

/** The slice of node's http types these handlers touch (keeps tests fake-free). */
export interface RouteRequest {
  method?: string
  url?: string
}
export interface RouteResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function reply(res: RouteResponse, status: number, payload: unknown): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(payload))
}

/**
 * Answer the model-list request. Never throws: a failure is a JSON body the
 * panel renders as a hint, which is all the person configuring it can act on.
 */
export async function handlePanelRequest(
  req: RouteRequest,
  res: RouteResponse,
  deps: PanelRouteDeps,
): Promise<void> {
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://feishu-card.local')
  } catch {
    reply(res, 400, { ok: false, error: '请求地址无法解析' })
    return
  }
  // POST is allowed for the authorisation actions only; everything else is a read.
  const isPost = req.method === 'POST'
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD' && !isPost) {
    reply(res, 405, { ok: false, error: '只支持 GET' })
    return
  }

  if (url.pathname === AUTH_PATH) {
    // ?action=begin|poll|forget — the panel drives the device flow through these.
    const action = url.searchParams.get('action') ?? 'state'
    try {
      if (action === 'begin') {
        reply(res, 200, { ok: true, ...(await deps.directory.begin()) })
        return
      }
      if (action === 'poll') {
        reply(res, 200, { ok: true, ...(await deps.directory.poll()) })
        return
      }
      if (action === 'forget') {
        await deps.directory.forget()
        reply(res, 200, { ok: true, authorized: false })
        return
      }
      reply(res, 200, { ok: true, ...deps.directory.state() })
    } catch (cause) {
      reply(res, 200, { ok: false, authorized: false, error: String(cause) })
    }
    return
  }

  if (url.pathname === SEARCH_PATH) {
    const query = (url.searchParams.get('q') ?? '').slice(0, 64)
    try {
      const found = await deps.directory.search(query)
      reply(res, 200, {
        ok: true,
        people: found.people,
        ...(found.error ? { error: found.error } : {}),
      })
    } catch (cause) {
      reply(res, 200, { ok: false, people: [], error: String(cause) })
    }
    return
  }

  if (url.pathname === NAMES_PATH) {
    const ids = (url.searchParams.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 60)
    // Ids are typed by their prefix, and the two kinds resolve through
    // different credentials (delegated token vs bot token). Splitting here keeps
    // the panel to one request and one map.
    const userIds = ids.filter((id) => id.startsWith('ou_'))
    const chatIds = ids.filter((id) => id.startsWith('oc_'))
    try {
      const [users, chats] = await Promise.all([
        deps.names.users(userIds),
        deps.names.chats(chatIds),
      ])
      reply(res, 200, {
        ok: true,
        users: users.names,
        chats,
        ...(users.error ? { error: users.error } : {}),
      })
    } catch (cause) {
      reply(res, 200, { ok: false, users: {}, chats: {}, error: String(cause) })
    }
    return
  }

  if (url.pathname === CHAT_SEARCH_PATH) {
    const query = (url.searchParams.get('q') ?? '').slice(0, 64)
    try {
      const found = await deps.names.chatSearch(query)
      reply(res, 200, {
        ok: true,
        chats: found.chats,
        ...(found.error ? { error: found.error } : {}),
      })
    } catch (cause) {
      reply(res, 200, { ok: false, chats: [], error: String(cause) })
    }
    return
  }

  if (url.pathname === RECENT_PATH) {
    try {
      const seen = deps.recent()
      reply(res, 200, { ok: true, people: seen.people, chats: seen.chats })
    } catch (cause) {
      reply(res, 200, { ok: false, people: [], chats: [], error: String(cause) })
    }
    return
  }
  if (url.pathname !== MODELS_PATH) {
    reply(res, 404, { ok: false, error: '未知接口' })
    return
  }
  if (isPost) {
    reply(res, 405, { ok: false, error: '该接口只支持 GET' })
    return
  }
  try {
    const catalog = await deps.listModels()
    reply(res, 200, {
      ok: true,
      choices: catalog.choices,
      ...(catalog.fallback ? { fallback: catalog.fallback } : {}),
      ...(catalog.error ? { error: catalog.error } : {}),
    })
  } catch (cause) {
    reply(res, 200, { ok: false, choices: [], error: String(cause) })
  }
}

/** Minimal shape of the Host's webServer service (read through ctx.inject). */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: RouteRequest, res: RouteResponse): unknown
  }): () => void
}

/**
 * Mount the route for as long as the plugin is loaded.
 *
 * `ctx.inject(['webServer'], …)` rather than `ctx.get('webServer')`: our plugin
 * activates before the `webserver` row does, so a direct read returns undefined
 * and the route silently never mounts (verified live — the request fell through
 * to the connection package's `/api` prefix route and answered `404 not found`).
 * `ctx.inject` defers the callback until the service exists and drops it when
 * the providing plugin unloads, which is exactly the lifetime we want.
 */
export function registerPanelRoutes(
  ctx: Context,
  deps: PanelRouteDeps,
  log?: (message: string) => void,
): void {
  try {
    ctx.inject(['webServer'], (child) => {
      child.effect(() => {
        const server = (child as unknown as { webServer?: WebServerLike }).webServer
        if (!server) {
          log?.('feishu-card: webServer service absent — 面板的模型下拉框/快捷选取不可用')
          return () => {}
        }
        const handler = (req: RouteRequest, res: RouteResponse) =>
          void handlePanelRequest(req, res, deps)
        let offs: (() => void)[] = []
        try {
          // Exact routes beat the connection package's `/api` prefix route,
          // which is what the panel's fetch would otherwise land in.
          offs = [
            server.register({ kind: 'exact', path: MODELS_PATH, handler }),
            server.register({ kind: 'exact', path: RECENT_PATH, handler }),
            server.register({ kind: 'exact', path: AUTH_PATH, handler }),
            server.register({ kind: 'exact', path: SEARCH_PATH, handler }),
            server.register({ kind: 'exact', path: NAMES_PATH, handler }),
            server.register({ kind: 'exact', path: CHAT_SEARCH_PATH, handler }),
          ]
          log?.(
            `feishu-card: 面板路由已挂载 (${MODELS_PATH}, ${RECENT_PATH}, ${AUTH_PATH}, ${SEARCH_PATH}, ${NAMES_PATH}, ${CHAT_SEARCH_PATH})`,
          )
        } catch (error) {
          log?.(`feishu-card: route registration failed: ${String(error)}`)
          return () => {}
        }
        return () => {
          for (const off of offs) off()
        }
      }, 'feishu-card: panel routes')
    })
  } catch (error) {
    log?.(`feishu-card: webServer unavailable (${String(error)}) — 面板快捷选取不可用`)
  }
}
