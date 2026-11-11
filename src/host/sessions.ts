/**
 * Session map: one DSH session per Feishu conversation, persisted so a restart
 * keeps every chat's context.
 *
 * Storage is a small JSON file under `~/.dsh/feishu-card/sessions.json`,
 * written atomically (tmp + rename) so a kill mid-write cannot corrupt it.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SessionRecord {
  sessionId: string
  workspace: string
  updatedAt: number
}

interface FileShape {
  version: 1
  sessions: Record<string, SessionRecord>
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text) as FileShape
      for (const [key, record] of Object.entries(parsed.sessions ?? {})) {
        if (record && typeof record.sessionId === 'string') this.sessions.set(key, record)
      }
    } catch {
      // missing or corrupt file: start empty, the next put() rewrites it
    }
    this.loaded = true
  }

  get(key: string): SessionRecord | undefined {
    return this.sessions.get(key)
  }

  keys(): string[] {
    return [...this.sessions.keys()]
  }

  get size(): number {
    return this.sessions.size
  }

  /** Record (or refresh) a session for a chat key and persist. */
  put(key: string, record: SessionRecord): Promise<void> {
    this.sessions.set(key, record)
    return this.enqueueFlush()
  }

  remove(key: string): Promise<void> {
    this.sessions.delete(key)
    return this.enqueueFlush()
  }

  private enqueueFlush(): Promise<void> {
    // Serialize writes: a burst of puts must not interleave tmp files.
    this.writeChain = this.writeChain.then(() => this.flush()).catch(() => undefined)
    return this.writeChain
  }

  private async flush(): Promise<void> {
    const payload: FileShape = { version: 1, sessions: Object.fromEntries(this.sessions) }
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, this.file)
  }
}
