import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from './sessions.ts'

/**
 * The session map is the bridge's memory: it maps a Feishu conversation to a
 * DSH session and must survive a restart (and a kill mid-write).
 */
let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dsh-sessions-'))
  file = path.join(dir, 'sessions.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SessionStore', () => {
  it('starts empty when no file exists', async () => {
    const store = new SessionStore(file)
    await store.load()
    expect(store.size).toBe(0)
    expect(store.get('oc_g1')).toBeUndefined()
  })

  it('round-trips a record through disk', async () => {
    const store = new SessionStore(file)
    await store.load()
    await store.put('oc_g1', { sessionId: 's-1', workspace: 'D:\\work', updatedAt: 123 })

    const reloaded = new SessionStore(file)
    await reloaded.load()
    expect(reloaded.get('oc_g1')).toEqual({ sessionId: 's-1', workspace: 'D:\\work', updatedAt: 123 })
  })

  it('persists atomically (no leftover tmp files)', async () => {
    const store = new SessionStore(file)
    await store.load()
    await store.put('a', { sessionId: 's-a', workspace: '', updatedAt: 1 })
    await store.put('b', { sessionId: 's-b', workspace: '', updatedAt: 2 })

    const files = require('node:fs').readdirSync(dir) as string[]
    expect(files).toEqual(['sessions.json'])
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('serializes concurrent writes (last write wins, no interleaving)', async () => {
    const store = new SessionStore(file)
    await store.load()
    await Promise.all([
      store.put('a', { sessionId: 's-a', workspace: '', updatedAt: 1 }),
      store.put('b', { sessionId: 's-b', workspace: '', updatedAt: 2 }),
      store.put('c', { sessionId: 's-c', workspace: '', updatedAt: 3 }),
    ])
    const reloaded = new SessionStore(file)
    await reloaded.load()
    expect(reloaded.size).toBe(3)
  })

  it('removes a record and persists the removal', async () => {
    const store = new SessionStore(file)
    await store.load()
    await store.put('oc_g1', { sessionId: 's-1', workspace: '', updatedAt: 1 })
    await store.remove('oc_g1')
    expect(store.size).toBe(0)

    const reloaded = new SessionStore(file)
    await reloaded.load()
    expect(reloaded.get('oc_g1')).toBeUndefined()
  })

  it('survives a corrupted file by starting empty', async () => {
    writeFileSync(file, '{ not json', 'utf8')
    const store = new SessionStore(file)
    await store.load()
    expect(store.size).toBe(0)
    // and the next put repairs it
    await store.put('a', { sessionId: 's-a', workspace: '', updatedAt: 1 })
    const reloaded = new SessionStore(file)
    await reloaded.load()
    expect(reloaded.size).toBe(1)
  })

  it('drops malformed records instead of failing', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, sessions: { good: { sessionId: 's', workspace: '', updatedAt: 1 }, bad: { nope: true } } }), 'utf8')
    const store = new SessionStore(file)
    await store.load()
    expect(store.get('good')?.sessionId).toBe('s')
    expect(store.get('bad')).toBeUndefined()
  })

  it('loads only once', async () => {
    const store = new SessionStore(file)
    await store.load()
    await store.put('a', { sessionId: 's-a', workspace: '', updatedAt: 1 })
    await store.load() // must not clobber the in-memory state with the older file
    expect(store.get('a')?.sessionId).toBe('s-a')
  })
})
