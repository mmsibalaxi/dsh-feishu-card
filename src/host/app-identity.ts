/**
 * Which app an `open_id` belongs to.
 *
 * Feishu open_ids are **per application** for the same person: switching the
 * bot's App ID silently invalidates every id in the allowlist, and the panel
 * showed them exactly like live ones. The user asked for either a way to remove
 * them or a visible mark saying "this belongs to the previous bot" (2026-11-11).
 *
 * This keeps the *birth app* of every id it has ever seen, so after a switch the
 * old entries can be flagged and removed in one click. Group ids (`oc_…`) are
 * tenant-level and deliberately NOT tracked: they survive an app switch within
 * the same tenant, and flagging them would be a false alarm.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface IdentityFile {
  version?: number
  /** The App ID the previous run was configured with. */
  appId?: string
  /** open_id → the App ID it was first seen under. */
  apps?: Record<string, string>
  /** The open_ids that were configured under `appId` (the previous run's list). */
  ids?: string[]
}

export interface AppIdentityOptions {
  file: string
  log?: (message: string) => void
  flushDelayMs?: number
}

export class AppIdentity {
  private readonly apps = new Map<string, string>()
  /** The App ID this file last saw; a different one means an identity switch. */
  private lastAppId = ''
  /** The ids that were configured the last time we looked (previous run). */
  private lastIds: string[] = []
  private loaded = false
  private dirty = false
  private timer?: ReturnType<typeof setTimeout>
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly options: AppIdentityOptions) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.options.file, 'utf8')) as IdentityFile
      if (typeof parsed.appId === 'string') this.lastAppId = parsed.appId
      if (Array.isArray(parsed.ids)) this.lastIds = parsed.ids.filter((id) => typeof id === 'string')
      for (const [id, appId] of Object.entries(parsed.apps ?? {})) {
        if (id && typeof appId === 'string' && appId) this.apps.set(id, appId)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.options.log?.(`feishu-card: app-identity unreadable (${String(error)})`)
      }
    }
  }

  /**
   * Record the ids as belonging to `appId`, and notice an identity switch.
   *
   * Two things happen here, in this order:
   *   1. If the App ID differs from the one on disk, every id currently in the
   *      allowlists is stamped with the OLD app — that is exactly what they are:
   *      ids issued for the previous bot. Doing this BEFORE recording is what
   *      makes the very first run of a switched profile still flag them.
   *   2. Ids never seen before are recorded under the current app.
   *
   * @param ids - open_ids currently configured
   * @param appId - the App ID this process is using now
   */
  observe(ids: readonly string[], appId: string): void {
    if (!appId) return
    let changed = false
    if (this.lastAppId && this.lastAppId !== appId) {
      // Stamp EXACTLY the ids that were configured under the old app — not the
      // current list, which may already contain somebody added under the new
      // one. Getting this wrong permanently marks a valid entry as dead.
      for (const id of this.lastIds) {
        if (this.apps.has(id)) continue
        this.apps.set(id, this.lastAppId)
        changed = true
      }
      this.options.log?.(`feishu-card: app id changed ${this.lastAppId} → ${appId}`)
    }
    const current = [...new Set(ids.filter(Boolean))]
    if (this.lastAppId !== appId) {
      this.lastAppId = appId
      changed = true
    }
    if (changed || current.join(',') !== this.lastIds.join(',')) {
      this.lastIds = current
      changed = true
    }
    for (const id of current) {
      if (this.apps.has(id)) continue
      this.apps.set(id, appId)
      changed = true
    }
    if (changed) this.schedule()
  }

  /** Backwards-compatible alias for {@link observe}. */
  remember(ids: readonly string[], appId: string): void {
    this.observe(ids, appId)
  }

  /** The App ID recorded by the last call to {@link observe}. */
  get appId(): string {
    return this.lastAppId
  }

  /**
   * The ids that belong to a DIFFERENT app than the one now configured.
   *
   * @param ids - open_ids to check
   * @param appId - the App ID this process is configured with
   * @returns stale id → its app id, for exactly the ids that changed hands
   */
  staleAmong(ids: readonly string[], appId: string): Record<string, string> {
    const stale: Record<string, string> = {}
    if (!appId) return stale
    for (const id of ids) {
      const born = this.apps.get(id)
      if (born && born !== appId) stale[id] = born
    }
    return stale
  }

  /** The current app id, per the stored history (for diagnostics). */
  get size(): number {
    return this.apps.size
  }

  private schedule(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.options.flushDelayMs ?? 500)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!this.dirty) return this.writing
    this.dirty = false
    const payload = JSON.stringify({
      version: 2,
      appId: this.lastAppId,
      ids: this.lastIds,
      apps: Object.fromEntries(this.apps),
    })
    const file = this.options.file
    const tmp = `${file}.${process.pid}.tmp`
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(tmp, payload, 'utf8')
        await rename(tmp, file)
      })
      .catch(async (error) => {
        await unlink(tmp).catch(() => undefined)
        this.options.log?.(`feishu-card: app-identity write failed (${String(error)})`)
      })
    return this.writing
  }
}