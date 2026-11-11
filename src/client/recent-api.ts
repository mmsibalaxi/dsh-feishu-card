/**
 * The panel's side of the "people the bot has already heard from" route.
 *
 * Kept apart from the component so the wire contract is unit-tested without a
 * DOM.
 */

export const RECENT_PATH = '/api/feishu-card/recent'

/** One sender the bot has seen, as the shortcut row shows it. */
export interface RecentPerson {
  openId: string
  chatId: string
  at: number
  count: number
}

export interface RecentChat {
  chatId: string
  at: number
}

export interface RecentSnapshot {
  people: RecentPerson[]
  chats: RecentChat[]
}

/** Coerce the Host's answer; anything malformed is simply left out. */
export function parseRecent(payload: unknown): RecentSnapshot {
  if (typeof payload !== 'object' || payload === null) return { people: [], chats: [] }
  const body = payload as { people?: unknown; chats?: unknown }
  const people: RecentPerson[] = []
  if (Array.isArray(body.people)) {
    for (const raw of body.people) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { openId?: unknown; chatId?: unknown; at?: unknown; count?: unknown }
      if (typeof row.openId !== 'string' || !row.openId) continue
      if (typeof row.chatId !== 'string' || !row.chatId) continue
      people.push({
        openId: row.openId,
        chatId: row.chatId,
        at: typeof row.at === 'number' ? row.at : 0,
        count: typeof row.count === 'number' ? row.count : 1,
      })
    }
  }
  const chats: RecentChat[] = []
  if (Array.isArray(body.chats)) {
    for (const raw of body.chats) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { chatId?: unknown; at?: unknown }
      if (typeof row.chatId !== 'string' || !row.chatId) continue
      chats.push({ chatId: row.chatId, at: typeof row.at === 'number' ? row.at : 0 })
    }
  }
  return { people, chats }
}

/** `3 分钟前` / `2 天前` — enough to tell fresh from stale. */
export function agoText(at: number, now = Date.now()): string {
  if (!at) return '未知时间'
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.round(hours / 24)
  return `${days} 天前`
}
