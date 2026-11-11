/**
 * People and groups the bot has already heard from.
 *
 * This is the one people source that needs **no Feishu permission at all**:
 * `im.message.receive_v1` carries `sender.sender_id.open_id` and
 * `message.chat_id`, and those are already *this app's* ids — exactly what an
 * allowlist needs. The contact directory cannot supply them (this app's 通讯录
 * data scope is one person, and a bot cannot search the directory by name), so
 * "who has talked to me" is both the cheapest and the most accurate list.
 *
 * Recorded **before** the access decision on purpose: the person most likely to
 * need adding is the one who was just denied.
 *
 * Persisted next to the session map so a restart does not empty the panel's
 * shortcut row.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** One sender the bot has seen. */
export interface SeenSender {
  openId: string
  chatId: string
  /** Last time this person was heard from (epoch ms). */
  at: number
  /** How many messages seen from them, so a repeat sender sorts higher. */
  count: number
}

export interface RecentContactsOptions {
  /** JSON file holding the ring; its directory is created on first save. */
  file: string
  /** How many senders to keep. */
  limit?: number
  log?: (message: string) => void
}

/**
 * A bounded, persisted list of recent senders.
 *
 * Order is "most recently heard from first"; a repeat sender moves to the front
 * instead of appending, so the list stays a usable shortlist rather than a log.
 */
export class RecentContacts {
  private readonly senders = new Map<string, SeenSender>()
  private readonly limit: number
  private loaded = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: RecentContactsOptions) {
    this.limit = options.limit ?? 200
  }

  /** Read the persisted ring; a missing or corrupt file just starts empty. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.options.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          if (typeof row !== 'object' || row === null) continue
          const entry = row as Partial<SeenSender>
          if (typeof entry.openId !== 'string' || !entry.openId) continue
          if (typeof entry.chatId !== 'string' || !entry.chatId) continue
          this.senders.set(entry.openId, {
            openId: entry.openId,
            chatId: entry.chatId,
            at: typeof entry.at === 'number' ? entry.at : 0,
            count: typeof entry.count === 'number' ? entry.count : 1,
          })
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.options.log?.(`feishu-card: recent contacts unreadable (${String(error)})`)
      }
    }
    this.loaded = true
    this.trim()
  }

  /** Record one inbound message's sender. Cheap: in-memory, save is debounced. */
  note(openId: string, chatId: string, at = Date.now()): void {
    if (!openId || !chatId) return
    const previous = this.senders.get(openId)
    // Re-insert so Map iteration order (and therefore `list()`) stays newest-first.
    this.senders.delete(openId)
    this.senders.set(openId, {
      openId,
      chatId,
      at,
      count: (previous?.count ?? 0) + 1,
    })
    this.trim()
    this.scheduleSave()
  }

  /** Recent senders, newest first. */
  list(): SeenSender[] {
    return [...this.senders.values()].sort((a, b) => b.at - a.at)
  }

  /** Distinct chats seen recently, newest first — the group allowlist's shortcut. */
  chats(): { chatId: string; at: number }[] {
    const seen = new Map<string, number>()
    for (const sender of this.senders.values()) {
      const previous = seen.get(sender.chatId) ?? 0
      if (sender.at > previous) seen.set(sender.chatId, sender.at)
    }
    return [...seen.entries()]
      .map(([chatId, at]) => ({ chatId, at }))
      .sort((a, b) => b.at - a.at)
  }

  /** Write now, cancelling any pending debounce (used by tests and shutdown). */
  async flush(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    if (!this.loaded) return
    try {
      await mkdir(path.dirname(this.options.file), { recursive: true })
      await writeFile(this.options.file, JSON.stringify(this.list()), 'utf8')
    } catch (error) {
      this.options.log?.(`feishu-card: recent contacts save failed (${String(error)})`)
    }
  }

  private trim(): void {
    while (this.senders.size > this.limit) {
      const oldest = this.senders.keys().next()
      if (oldest.done) break
      this.senders.delete(oldest.value)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.flush()
    }, 1000)
    // Never keep the process alive for a save.
    this.saveTimer.unref?.()
  }
}
