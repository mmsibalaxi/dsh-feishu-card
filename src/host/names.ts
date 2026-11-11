/**
 * Persistent display names for the ids this plugin stores.
 *
 * The panel stores `ou_…` / `oc_…` ids — that is what Feishu's APIs take — but a
 * person configuring the bridge must never have to read them (user feedback
 * 2026-11-10: 用户和群都要名称，不显示ID). Resolving a name costs a network
 * round trip, and the delegated token that resolves *people* expires sometime;
 * so the answer is cached on disk and kept across restarts:
 *
 *   ~/.dsh/feishu-card/names.json   { users: { ou_…: "张三" }, chats: { oc_…: "研发群" } }
 *
 * A cache miss without a live token therefore still renders a name for anybody
 * the bot has ever seen, which is what makes the panel usable when the token is
 * between authorisations.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as Lark from '@larksuiteoapi/node-sdk'
import type { Brand } from '../shared/types.js'

interface NameBookFile {
  version?: number
  users?: Record<string, string>
  chats?: Record<string, string>
}

export interface NameBookOptions {
  /** Where the cache lives; one file for both kinds. */
  file: string
  log?: (message: string) => void
  /** Debounce for the disk write (a panel refresh can resolve 30 ids at once). */
  flushDelayMs?: number
}

export class NameBook {
  private readonly users = new Map<string, string>()
  private readonly chats = new Map<string, string>()
  private loaded = false
  private dirty = false
  private timer?: ReturnType<typeof setTimeout>
  private writing: Promise<void> = Promise.resolve()
  private tmpSeq = 0

  constructor(private readonly options: NameBookOptions) {}

  /** Read the cache. A missing or corrupt file is simply an empty cache. */
  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.options.file, 'utf8')) as NameBookFile
      for (const [id, name] of Object.entries(parsed.users ?? {})) {
        if (id && typeof name === 'string' && name) this.users.set(id, name)
      }
      for (const [id, name] of Object.entries(parsed.chats ?? {})) {
        if (id && typeof name === 'string' && name) this.chats.set(id, name)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.options.log?.(`feishu-card: name cache unreadable (${String(error)})`)
      }
    }
  }

  /** Cached name for any id, whichever kind it is. */
  lookup(id: string): string | undefined {
    return this.users.get(id) ?? this.chats.get(id)
  }

  user(id: string): string | undefined {
    return this.users.get(id)
  }

  chat(id: string): string | undefined {
    return this.chats.get(id)
  }

  usersOf(ids: readonly string[]): Record<string, string> {
    return pick(this.users, ids)
  }

  chatsOf(ids: readonly string[]): Record<string, string> {
    return pick(this.chats, ids)
  }

  /** Everything cached, for diagnostics (`scripts/probe-names.ts`). */
  snapshot(): { users: Record<string, string>; chats: Record<string, string> } {
    return {
      users: Object.fromEntries(this.users),
      chats: Object.fromEntries(this.chats),
    }
  }

  rememberUsers(names: Record<string, string>): void {
    if (remember(this.users, names)) this.schedule()
  }

  rememberChats(names: Record<string, string>): void {
    if (remember(this.chats, names)) this.schedule()
  }

  /** Persist on the next tick; unref'd so a card/panel never holds the process. */
  private schedule(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.options.flushDelayMs ?? 500)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  /** Write now (shutdown, tests). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!this.dirty) return this.writing
    this.dirty = false
    const payload = JSON.stringify({
      version: 1,
      users: Object.fromEntries(this.users),
      chats: Object.fromEntries(this.chats),
    })
    const file = this.options.file
    const tmp = `${file}.${process.pid}.${(this.tmpSeq += 1)}.tmp`
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(tmp, payload, 'utf8')
        // Atomic: a crash mid-write must not leave a half file behind, and a
        // parallel reader must never see a truncated one.
        await rename(tmp, file)
      })
      .catch(async (error) => {
        await unlink(tmp).catch(() => undefined)
        this.options.log?.(`feishu-card: name cache write failed (${String(error)})`)
      })
    return this.writing
  }
}

function remember(target: Map<string, string>, names: Record<string, string>): boolean {
  let changed = false
  for (const [id, name] of Object.entries(names)) {
    if (!id || !name) continue
    if (target.get(id) === name) continue
    target.set(id, name)
    changed = true
  }
  return changed
}

function pick(source: Map<string, string>, ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    const name = source.get(id)
    if (name) out[id] = name
  }
  return out
}

/** The tenant-side chat reader: chat info, the bot's chat list, and search. */
export interface ChatNameReader {
  get(chatId: string): Promise<{
    code?: number
    msg?: string
    data?: { name?: string; chat_mode?: string }
  }>
  /** Every chat the bot is in; the fallback when `get` refuses one. */
  list?(): Promise<{ code?: number; msg?: string; data?: { items?: ChatRow[] } }>
  /** Keyword search over the chats the bot can see. */
  search?(query: string): Promise<{ code?: number; msg?: string; data?: { items?: ChatRow[] } }>
}

/** One chat row, as both `list` and `search` report it. */
export interface ChatRow {
  chat_id?: string
  name?: string
  chat_mode?: string
}

export interface ChatNamesOptions {
  read: () => { appId: string; appSecret: string; brand: Brand }
  /** Injection point for tests. */
  createClient?: (config: { appId: string; appSecret: string; domain: Lark.Domain }) => ChatNameReader
  /** Called with the names learned from search, so they reach the disk cache. */
  remember?: (names: Record<string, string>) => void
  log?: (message: string) => void
}

/**
 * Resolve group names with the BOT's identity.
 *
 * `GET /open-apis/im/v1/chats/{chat_id}` needs `im:chat:read` (granted) and only
 * works for chats the bot is in — which is exactly the set worth listing.
 * Deliberately independent of the delegated user token: group names must keep
 * working after a person's authorisation expires.
 */
export class ChatNames {
  private reader?: { config: string; client: ChatNameReader }

  constructor(private readonly options: ChatNamesOptions) {}

  private client(): ChatNameReader | undefined {
    const config = this.options.read()
    if (!config.appId || !config.appSecret) return undefined
    const key = `${config.appId}:${config.brand}`
    if (this.reader?.config !== key) {
      const create =
        this.options.createClient ??
        ((input) => {
          const client = new Lark.Client(input)
          return {
            get: async (chatId: string) => {
              const response = await client.im.v1.chat.get({
                path: { chat_id: chatId },
                params: { user_id_type: 'open_id' },
              })
              return response as {
                code?: number
                msg?: string
                data?: { name?: string; chat_mode?: string }
              }
            },
            list: async () => {
              const response = await client.im.v1.chat.list({
                params: { page_size: 100, user_id_type: 'open_id' },
              })
              return response as { code?: number; msg?: string; data?: { items?: ChatRow[] } }
            },
            search: async (query: string) => {
              const response = await client.im.v1.chat.search({
                params: { query, page_size: 20, user_id_type: 'open_id' },
              })
              return response as { code?: number; msg?: string; data?: { items?: ChatRow[] } }
            },
          }
        })
      this.reader = {
        config: key,
        client: create({
          appId: config.appId,
          appSecret: config.appSecret,
          domain: config.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
        }),
      }
    }
    return this.reader.client
  }

  /**
   * Resolve chat ids to names, skipping the ones already cached by the caller.
   *
   * `chats/{id}` is the precise call but it answers an error code for a chat the
   * bot left (or a p2p id it does not recognise), so a failed batch falls back to
   * ONE `chats.list` pass over everything the bot is in — the same names, one
   * request, and no `未知群` for a chat that is plainly visible in Feishu.
   *
   * Never throws: fewer names is fine, the panel has a neutral label for that.
   */
  async resolve(ids: readonly string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(ids.filter(Boolean))].slice(0, 30)
    if (wanted.length === 0) return {}
    const client = this.client()
    if (!client) return {}
    const out: Record<string, string> = {}
    const failed: string[] = []
    await Promise.all(
      wanted.map(async (id) => {
        try {
          const response = await client.get(id)
          const name = response?.data?.name?.trim()
          if (response?.code === 0 && name) out[id] = name
          else if (response?.code === 0 && response?.data?.chat_mode === 'p2p') {
            // A p2p chat has no name — the other side's name is not ours to show
            // here. Label it so the panel does not say 未知群 about a direct chat.
            out[id] = '单聊'
          } else {
            failed.push(id)
            this.options.log?.(
              `feishu-card: chat name ${id} via get failed (${response?.code} ${response?.msg ?? ''})`,
            )
          }
        } catch (error) {
          failed.push(id)
          this.options.log?.(`feishu-card: chat name ${id} via get failed (${String(error).slice(0, 120)})`)
        }
      }),
    )
    if (failed.length === 0 || !client.list) return out

    // One list pass covers every failure: it returns the chats this bot is in,
    // which is exactly the set a whitelist entry can possibly be.
    try {
      const listed = await client.list()
      const rows = listed?.data?.items ?? []
      for (const row of rows) {
        const id = row.chat_id
        const name = row.name?.trim()
        if (id && name && failed.includes(id)) out[id] = name
      }
      if (listed?.code !== undefined && listed.code !== 0) {
        this.options.log?.(
          `feishu-card: chat list fallback failed (${listed.code} ${listed.msg ?? ''})`,
        )
      }
    } catch (error) {
      this.options.log?.(`feishu-card: chat list fallback failed (${String(error).slice(0, 120)})`)
    }
    return out
  }

  /**
   * Search the chats this bot can see by name.
   *
   * `im/v1/chats/search` is bot-identity, so it needs no delegated token: group
   * picking keeps working while a person's authorisation is expired.
   */
  async search(query: string): Promise<{ chats: { chatId: string; name: string }[]; error?: string }> {
    const text = query.trim()
    const client = this.client()
    if (!client) return { chats: [], error: '还没配置 App ID/App Secret，无法搜索群。' }
    // An empty query means "show me what I have": `chats.search` needs a keyword
    // and returns nothing for '', while `chats.list` enumerates the bot's chats —
    // which is the better starting point for a picker anyway.
    if (!text) {
      if (!client.list) return { chats: [] }
      try {
        const listed = await client.list()
        const chats = (listed?.data?.items ?? [])
          .filter((row) => row.chat_id)
          .map((row) => ({ chatId: row.chat_id as string, name: row.name?.trim() || '未命名群' }))
        this.rememberSearch(chats)
        return { chats }
      } catch (error) {
        return { chats: [], error: `读取群列表失败：${String(error).slice(0, 160)}` }
      }
    }
    if (!client.search) return { chats: [], error: '当前环境不支持群搜索。' }
    try {
      const response = await client.search(text)
      if (response?.code !== undefined && response.code !== 0) {
        return { chats: [], error: `搜索群失败：${response.msg ?? '未知错误'}（code ${response.code}）` }
      }
      const chats: { chatId: string; name: string }[] = []
      for (const row of response?.data?.items ?? []) {
        if (!row.chat_id) continue
        chats.push({ chatId: row.chat_id, name: row.name?.trim() || '未命名群' })
      }
      this.rememberSearch(chats)
      return { chats }
    } catch (error) {
      return { chats: [], error: `搜索群失败：${String(error).slice(0, 160)}` }
    }
  }

  private rememberSearch(chats: { chatId: string; name: string }[]): void {
    if (!this.options.remember || chats.length === 0) return
    const names: Record<string, string> = {}
    for (const chat of chats) names[chat.chatId] = chat.name
    this.options.remember(names)
  }
}