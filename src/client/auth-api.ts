/**
 * The panel's side of "search the directory as me".
 *
 * Wire contract only; the component drives it. Kept separate so the parsing is
 * unit-tested without a DOM.
 */

export const AUTH_PATH = '/api/feishu-card/auth'
export const SEARCH_PATH = '/api/feishu-card/search'
export const NAMES_PATH = '/api/feishu-card/names'
export const CHAT_SEARCH_PATH = '/api/feishu-card/chat-search'

/** What the panel needs to render the authorisation state. */
export interface AuthState {
  authorized: boolean
  /**
   * The stored token can no longer work (expired and unrefreshable).
   *
   * The panel then shows 「授权已过期，重新授权」 instead of a search box that
   * returns a token error on every query.
   */
  needAuth?: boolean
  userName?: string
  pending?: {
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresAt: number
  }
  error?: string
}

/** One person found by the delegated search. */
export interface FoundPerson {
  openId: string
  name: string
}

/** One group found by the bot-identity search. */
export interface FoundChat {
  chatId: string
  name: string
}

export function authUrl(action: 'state' | 'begin' | 'poll' | 'forget'): string {
  return `${AUTH_PATH}?action=${action}`
}

export function searchUrl(query: string): string {
  return `${SEARCH_PATH}?q=${encodeURIComponent(query)}`
}

/** Keyword search over the groups the bot can see (no delegated token needed). */
export function chatSearchUrl(query: string): string {
  return `${CHAT_SEARCH_PATH}?q=${encodeURIComponent(query)}`
}

/** Ask the Host to resolve open_ids to names (comma-separated, like the allowlist). */
export function namesUrl(ids: readonly string[]): string {
  return `${NAMES_PATH}?ids=${ids.map((id) => encodeURIComponent(id)).join(',')}`
}

/**
 * Coerce a names answer into one id → name map.
 *
 * The Host answers with two buckets because people and chats resolve through
 * different credentials; ids are disjoint by prefix (ou_ / oc_), so the panel can
 * treat them as one map.
 */
export function parseNames(payload: unknown): Record<string, string> {
  if (typeof payload !== 'object' || payload === null) return {}
  const out: Record<string, string> = {}
  for (const key of ['users', 'chats', 'names'] as const) {
    const bucket = (payload as Record<string, unknown>)[key]
    if (typeof bucket !== 'object' || bucket === null) continue
    for (const [id, name] of Object.entries(bucket as Record<string, unknown>)) {
      if (typeof name === 'string' && name) out[id] = name
    }
  }
  return out
}

/** Coerce the authorisation answer. */
export function parseAuth(payload: unknown): AuthState {
  if (typeof payload !== 'object' || payload === null) return { authorized: false }
  const body = payload as {
    authorized?: unknown
    needAuth?: unknown
    userName?: unknown
    pending?: unknown
    error?: unknown
  }
  const pending =
    typeof body.pending === 'object' && body.pending !== null
      ? (body.pending as Record<string, unknown>)
      : undefined
  return {
    authorized: body.authorized === true,
    ...(body.needAuth === true ? { needAuth: true } : {}),
    ...(typeof body.userName === 'string' && body.userName ? { userName: body.userName } : {}),
    ...(pending &&
    typeof pending.userCode === 'string' &&
    typeof pending.verificationUri === 'string'
      ? {
          pending: {
            userCode: pending.userCode,
            verificationUri: pending.verificationUri,
            verificationUriComplete:
              typeof pending.verificationUriComplete === 'string'
                ? pending.verificationUriComplete
                : pending.verificationUri,
            expiresAt: typeof pending.expiresAt === 'number' ? pending.expiresAt : 0,
          },
        }
      : {}),
    ...(typeof body.error === 'string' && body.error ? { error: body.error } : {}),
  }
}

/** Coerce a search answer. */
export function parseFound(payload: unknown): { people: FoundPerson[]; error?: string } {
  if (typeof payload !== 'object' || payload === null) return { people: [] }
  const body = payload as { people?: unknown; error?: unknown }
  const people: FoundPerson[] = []
  if (Array.isArray(body.people)) {
    for (const raw of body.people) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { openId?: unknown; name?: unknown }
      if (typeof row.openId !== 'string' || !row.openId) continue
      people.push({
        openId: row.openId,
        name: typeof row.name === 'string' && row.name ? row.name : row.openId,
      })
    }
  }
  return { people, ...(typeof body.error === 'string' && body.error ? { error: body.error } : {}) }
}

/** Coerce a group-search answer. */
export function parseFoundChats(payload: unknown): { chats: FoundChat[]; error?: string } {
  if (typeof payload !== 'object' || payload === null) return { chats: [] }
  const body = payload as { chats?: unknown; error?: unknown }
  const chats: FoundChat[] = []
  if (Array.isArray(body.chats)) {
    for (const raw of body.chats) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { chatId?: unknown; name?: unknown }
      if (typeof row.chatId !== 'string' || !row.chatId) continue
      chats.push({
        chatId: row.chatId,
        name: typeof row.name === 'string' && row.name ? row.name : '未命名群',
      })
    }
  }
  return { chats, ...(typeof body.error === 'string' && body.error ? { error: body.error } : {}) }
}
