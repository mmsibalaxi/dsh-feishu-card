/**
 * "Search the directory as me" — the user-token half of the people picker.
 *
 * Feishu's `search/v1/user` is **user-token only**: a bot app can never call it
 * (verified — a tenant token gets `99991663 Invalid access token`). But this app
 * already holds the scopes needed to ask *the person* for delegated access
 * (`contact:user:search`, `contact:user.base:readonly`, `offline_access`), and
 * the `open_id` that search returns is **this app's namespace** — exactly what
 * the allowlist stores. That is the whole point: the bot's own 通讯录 scope is a
 * single person, but the person's own visibility is the whole company.
 *
 * Authorisation rides the Device Flow (see device-flow.ts), so there is no
 * redirect URL to register and no local callback listener to run.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DIRECTORY_SCOPES,
  oauthEndpoints,
  pollDeviceToken,
  refreshUserToken,
  requestDeviceAuthorization,
  type DeviceAuthorization,
  type UserToken,
} from './device-flow.ts'
import type { Brand } from '../shared/types.js'
import type { NameBook } from './names.ts'

/** Where a person's delegated token is kept between sessions. */
interface StoredToken {
  accessToken: string
  refreshToken?: string
  /** Epoch ms at which the access token stops working. */
  expiresAt: number
  scope?: string
  /** Who authorised it, for the panel to show. */
  userName?: string
}

export interface DirectoryOptions {
  read: () => { appId: string; appSecret: string; brand: Brand }
  /** Where to persist the delegated token. */
  file: string
  /**
   * Disk-backed id → name cache.
   *
   * Optional so the class stays usable alone (tests), but the panel always
   * passes one: without it every DSH restart loses every name and the settings
   * page goes back to showing raw `ou_…` ids.
   */
  names?: NameBook
  log?: (message: string) => void
  /** Injectable for tests: the HTTP layer the device flow and search use. */
  fetch?: typeof fetch
  now?: () => number
}

/** What the panel shows while an authorisation is in flight. */
export interface PendingAuth {
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  /** Epoch ms when this request stops being useful. */
  expiresAt: number
}

/** One person found by name. */
export interface FoundPerson {
  openId: string
  name: string
  departmentIds?: string[]
}

/** The state the panel renders for the "search as me" feature. */
export interface DirectoryState {
  /** Whether a usable delegated token is held (or can be refreshed on demand). */
  authorized: boolean
  /**
   * True when the held token can no longer work and the person must authorise
   * again. The panel shows a 重新授权 button instead of the search box, which is
   * what makes an expired delegation self-explanatory instead of "搜索报错".
   */
  needAuth?: boolean
  /** The person who authorised, when known. */
  userName?: string
  /** An in-flight authorisation the panel should show. */
  pending?: PendingAuth
  /** Why authorisation is unavailable (no credentials, scope missing, …). */
  error?: string
}

/**
 * Holds one delegated token, refreshes it when needed, and searches the
 * directory with it.
 *
 * One instance per plugin: the token is a property of the *person*, not of a
 * request, so it outlives the panel page.
 */
export class DirectorySearch {
  private token: StoredToken | undefined
  private pending: { auth: DeviceAuthorization; startedAt: number } | undefined
  private polling: Promise<DirectoryState> | undefined
  private loaded = false
  /**
   * Set when a refresh was actually attempted and failed.
   *
   * A dead refresh token is not the same as a network blip: without this flag
   * the panel kept claiming "authorized" for days while every search returned a
   * token error (live report 2026-11-10: 搜索报错，断开重连授权才行).
   */
  private refreshFailed = false

  constructor(private readonly options: DirectoryOptions) {}

  /** Load a previously stored token; a missing file is not an error. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.options.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredToken>
      if (typeof parsed.accessToken === 'string' && parsed.accessToken) {
        this.token = {
          accessToken: parsed.accessToken,
          ...(typeof parsed.refreshToken === 'string' ? { refreshToken: parsed.refreshToken } : {}),
          expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
          ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
          ...(typeof parsed.userName === 'string' ? { userName: parsed.userName } : {}),
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.options.log?.(`feishu-card: delegated token unreadable (${String(error)})`)
      }
    }
    this.loaded = true
  }

  /** Current state, without touching the network. */
  state(): DirectoryState {
    const now = (this.options.now ?? Date.now)()
    const pending = this.pending
    const expiresAt = pending ? pending.startedAt + pending.auth.expiresIn * 1000 : 0
    const token = this.token
    const expired = token !== undefined && token.expiresAt <= now
    // A token that is expired and cannot be refreshed is a re-auth, not "still
    // authorized but broken".
    const dead = token !== undefined && expired && (this.refreshFailed || !token.refreshToken)
    return {
      authorized: token !== undefined && !dead,
      ...(dead ? { needAuth: true } : {}),
      ...(token?.userName ? { userName: token.userName } : {}),
      ...(pending && expiresAt > now
        ? {
            pending: {
              userCode: pending.auth.userCode,
              verificationUri: pending.auth.verificationUri,
              verificationUriComplete: pending.auth.verificationUriComplete,
              expiresAt,
            },
          }
        : {}),
    }
  }

  /**
   * Begin an authorisation. Returns the code and link for the panel to show;
   * `complete()` then polls until the person confirms.
   */
  async begin(): Promise<DirectoryState> {
    const config = this.options.read()
    if (!config.appId || !config.appSecret) {
      return { authorized: false, error: '请先填写并保存 App ID 和 App Secret。' }
    }
    try {
      const auth = await requestDeviceAuthorization({
        appId: config.appId,
        appSecret: config.appSecret,
        brand: config.brand,
        scope: DIRECTORY_SCOPES,
        ...(this.options.fetch ? { fetch: this.options.fetch as never } : {}),
      })
      this.pending = { auth, startedAt: (this.options.now ?? Date.now)() }
      return this.state()
    } catch (error) {
      return { authorized: false, error: `申请授权失败：${String(error).slice(0, 200)}` }
    }
  }

  /**
   * Poll once. Called by the panel every few seconds while it shows the code.
   *
   * Concurrent calls share one request: the panel may re-render faster than the
   * network answers, and Feishu rate-limits polling.
   */
  async poll(): Promise<DirectoryState> {
    if (!this.pending) return this.state()
    if (this.polling) return this.polling
    const config = this.options.read()
    const pending = this.pending
    const run = (async (): Promise<DirectoryState> => {
      try {
        const token = await pollDeviceToken(
          {
            appId: config.appId,
            appSecret: config.appSecret,
            brand: config.brand,
            scope: DIRECTORY_SCOPES,
            ...(this.options.fetch ? { fetch: this.options.fetch as never } : {}),
          },
          pending.auth.deviceCode,
        )
        if (!token) {
          // Still waiting, or the code expired — drop it when it has.
          const expired =
            pending.startedAt + pending.auth.expiresIn * 1000 <= (this.options.now ?? Date.now)()
          if (expired) this.pending = undefined
          return this.state()
        }
        await this.store(token)
        this.pending = undefined
        return this.state()
      } catch (error) {
        this.pending = undefined
        return { authorized: this.token !== undefined, error: String(error).slice(0, 200) }
      } finally {
        this.polling = undefined
      }
    })()
    this.polling = run
    return run
  }

  /** Forget the delegation (the panel's "断开" button). */
  async forget(): Promise<void> {
    this.token = undefined
    this.pending = undefined
    this.refreshFailed = false
    try {
      await rm(this.options.file, { force: true })
    } catch {
      // Nothing to remove.
    }
  }

  /** Search people by name, e-mail or open_id. Needs a live delegated token. */
  async search(query: string): Promise<{ people: FoundPerson[]; error?: string }> {
    const text = query.trim()
    if (!text) return { people: [] }
    const accessToken = await this.usableToken()
    if (!accessToken) {
      return {
        people: [],
        error: this.state().needAuth
          ? '授权已过期，点「重新授权」后再搜索。'
          : '还没有授权，先点「用我的身份搜索」完成一次授权。',
      }
    }
    const config = this.options.read()
    const endpoints = oauthEndpoints(config.brand)
    const base = endpoints.token.replace('/open-apis/authen/v2/oauth/token', '')
    const url = `${base}/open-apis/search/v1/user?query=${encodeURIComponent(text)}&page_size=20`
    const doFetch = this.options.fetch ?? fetch
    try {
      const response = await doFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const body = (await response.json()) as {
        code?: number
        msg?: string
        data?: { users?: { open_id?: string; name?: string; department_ids?: string[] }[] }
      }
      if (body.code !== undefined && body.code !== 0) {
        return { people: [], error: `搜索失败：${body.msg ?? '未知错误'}（code ${body.code}）` }
      }
      const people: FoundPerson[] = []
      for (const row of body.data?.users ?? []) {
        if (!row.open_id) continue
        const name = row.name?.trim()
        people.push({
          openId: row.open_id,
          name: name || row.open_id,
          ...(row.department_ids ? { departmentIds: row.department_ids } : {}),
        })
      }
      // Remember what search already told us (2026-11-10): `contact/v3/users/{id}`
      // answers 41050 for anybody outside the APP's data scope, even with the
      // user's own token — so a person found by name would still show as
      // 未知用户 afterwards. The search response is the one place their name is
      // free, so store it.
      if (this.options.names) {
        const found: Record<string, string> = {}
        for (const person of people) {
          if (person.name && person.name !== person.openId) found[person.openId] = person.name
        }
        if (Object.keys(found).length > 0) this.options.names.rememberUsers(found)
      }
      return { people }
    } catch (error) {
      return { people: [], error: `搜索失败：${String(error).slice(0, 160)}` }
    }
  }

  /**
   * Resolve open_ids to names, so a chip can read `ou_0000… (张三)`.
   *
   * Runs on the delegated token for the same reason search does: with the
   * tenant token this app can only see one person, so every other id would come
   * back `41050 no authority`. It doubles as an id check — a real id resolves,
   * a made-up one does not.
   *
   * Results are cached per id (names rarely change, and the panel asks on every
   * refresh), and unknown ids are simply absent from the map.
   */
  async names(ids: readonly string[]): Promise<{ names: Record<string, string>; error?: string }> {
    const book = this.options.names
    const unique = [...new Set(ids.filter(Boolean))]
    // The disk cache answers first — including for ids resolved days ago, and
    // including when the delegated token is dead. That is the whole point of
    // persisting names.
    const known = book ? book.usersOf(unique) : {}
    const wanted = unique.filter((id) => !known[id]).slice(0, 30)
    if (wanted.length === 0) return { names: known }

    const accessToken = await this.usableToken()
    if (!accessToken) {
      return {
        names: known,
        error: this.state().needAuth
          ? '授权已过期，点「重新授权」后再显示新增的人名（已缓存的名字不受影响）。'
          : '还没有授权，先完成一次授权才能显示人名。',
      }
    }
    const config = this.options.read()
    const base = oauthEndpoints(config.brand).token.replace('/open-apis/authen/v2/oauth/token', '')
    const doFetch = this.options.fetch ?? fetch

    const entries = await Promise.all(
      wanted.map(async (id) => {
        try {
          const response = await doFetch(
            `${base}/open-apis/contact/v3/users/${encodeURIComponent(id)}?user_id_type=open_id`,
            { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
          )
          const body = (await response.json()) as {
            code?: number
            data?: { user?: { name?: string } }
          }
          const name = body.data?.user?.name?.trim()
          return body.code === 0 && name ? ([id, name] as const) : undefined
        } catch {
          return undefined
        }
      }),
    )
    const resolved: Record<string, string> = {}
    for (const entry of entries) if (entry) resolved[entry[0]] = entry[1]
    book?.rememberUsers(resolved)
    return { names: { ...known, ...resolved } }
  }

  /** A token that will work right now, refreshing it if it is about to expire. */
  private async usableToken(): Promise<string | undefined> {
    if (!this.loaded) await this.load()
    const token = this.token
    if (!token) return undefined
    const now = (this.options.now ?? Date.now)()
    // Refresh a minute early: a search that starts just before expiry should not
    // fail on a token that dies mid-flight.
    if (token.expiresAt - 60_000 > now) return token.accessToken
    if (!token.refreshToken) {
      this.refreshFailed = true
      return undefined
    }
    const config = this.options.read()
    try {
      const next = await refreshUserToken(
        {
          appId: config.appId,
          appSecret: config.appSecret,
          brand: config.brand,
          scope: DIRECTORY_SCOPES,
          ...(this.options.fetch ? { fetch: this.options.fetch as never } : {}),
        },
        token.refreshToken,
      )
      this.refreshFailed = false
      await this.store(next, token.userName)
      return next.accessToken
    } catch (error) {
      // The refresh token is the only thing that could have saved this
      // delegation. Returning the dead access token here made every caller
      // report a confusing API error instead of "please authorise again"
      // (live report 2026-11-10).
      this.refreshFailed = true
      this.options.log?.(`feishu-card: token refresh failed (${String(error)})`)
      return undefined
    }
  }
  private async store(token: UserToken, userName?: string): Promise<void> {
    // A fresh grant makes the delegation healthy again.
    this.refreshFailed = false
    this.token = {
      accessToken: token.accessToken,
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      expiresAt: (this.options.now ?? Date.now)() + token.expiresIn * 1000,
      ...(token.scope ? { scope: token.scope } : {}),
      ...(userName ? { userName } : {}),
    }
    try {
      await mkdir(path.dirname(this.options.file), { recursive: true })
      // 0600: this is a live credential for the person's account.
      await writeFile(this.options.file, JSON.stringify(this.token), { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      this.options.log?.(`feishu-card: delegated token save failed (${String(error)})`)
    }
  }
}
