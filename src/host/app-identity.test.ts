/**
 * Which app an open_id belongs to.
 *
 * 2026-11-11: after switching bot identity every allowlist entry silently stops
 * matching, because Feishu open_ids are per app. These tests pin the two things
 * that make the warning trustworthy: ids keep the FIRST app they were seen
 * under, and a changed App ID stamps the still-configured ids with the old one
 * before anything new is recorded.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppIdentity } from './app-identity.ts'

async function tempFile(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-appid-'))
  return { dir, file: join(dir, 'app-identity.json') }
}

describe('AppIdentity', () => {
  it('records ids under the app that first saw them', async () => {
    const { dir, file } = await tempFile()
    try {
      const identity = new AppIdentity({ file, flushDelayMs: 0 })
      await identity.load()
      identity.observe(['ou_a', 'ou_b'], 'cli_old')
      expect(identity.staleAmong(['ou_a', 'ou_b'], 'cli_old')).toEqual({})
      await identity.flush()
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
        appId: 'cli_old',
        apps: { ou_a: 'cli_old', ou_b: 'cli_old' },
      })
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })

  it('flags every configured id once the App ID changes', async () => {
    const { dir, file } = await tempFile()
    try {
      const first = new AppIdentity({ file, flushDelayMs: 0 })
      await first.load()
      first.observe(['ou_a', 'ou_b'], 'cli_old')
      await first.flush()

      // A restart with the new bot: same allowlist, different app.
      const second = new AppIdentity({ file })
      await second.load()
      second.observe(['ou_a', 'ou_b', 'ou_new'], 'cli_new')
      expect(second.staleAmong(['ou_a', 'ou_b', 'ou_new'], 'cli_new')).toEqual({
        ou_a: 'cli_old',
        ou_b: 'cli_old',
      })
      // An id added under the NEW app is fine.
      expect(second.staleAmong(['ou_new'], 'cli_new')).toEqual({})
      await second.flush()
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })

  it('survives a restart: the switch is still detectable afterwards', async () => {
    const { dir, file } = await tempFile()
    try {
      // Run 1: the old bot.
      const before = new AppIdentity({ file, flushDelayMs: 0 })
      await before.load()
      before.observe(['ou_a'], 'cli_old')
      await before.flush()

      // Run 2: restarted with the new bot — flags it.
      const switched = new AppIdentity({ file, flushDelayMs: 0 })
      await switched.load()
      switched.observe(['ou_a'], 'cli_new')
      expect(switched.staleAmong(['ou_a'], 'cli_new')).toEqual({ ou_a: 'cli_old' })
      await switched.flush()

      // Run 3: the flag does not need the detecting process to be alive.
      const later = new AppIdentity({ file })
      await later.load()
      later.observe(['ou_a'], 'cli_new')
      expect(later.staleAmong(['ou_a'], 'cli_new')).toEqual({ ou_a: 'cli_old' })
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })

  it('says nothing when there is no history at all', async () => {
    const { dir, file } = await tempFile()
    try {
      const identity = new AppIdentity({ file })
      await identity.load()
      expect(identity.staleAmong(['ou_a'], 'cli_new')).toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})