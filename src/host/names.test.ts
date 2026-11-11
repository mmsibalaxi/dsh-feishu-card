/**
 * Names are what a person reads; ids are what the APIs take.
 *
 * Two things matter here and both are about NOT showing `ou_…` in the panel:
 *   - the cache must survive a restart (a fresh process must not forget every
 *     name), and
 *   - a chat name must be resolvable with the BOT's identity, so group chips keep
 *     working after the delegated token dies.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatNames, NameBook } from './names.ts'

async function tempFile(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-names-'))
  return { dir, file: join(dir, 'nested', 'names.json') }
}

describe('NameBook', () => {
  it('starts empty when the file is missing', async () => {
    const { dir, file } = await tempFile()
    try {
      const book = new NameBook({ file })
      await book.load()
      expect(book.user('ou_a')).toBeUndefined()
      expect(book.chatsOf(['oc_1'])).toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('remembers both kinds and survives a restart', async () => {
    const { dir, file } = await tempFile()
    try {
      const first = new NameBook({ file, flushDelayMs: 0 })
      first.rememberUsers({ ou_a: '张三' })
      first.rememberChats({ oc_1: '研发群' })
      await first.flush()
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
        users: { ou_a: '张三' },
        chats: { oc_1: '研发群' },
      })
      // A NEW instance (a restarted DSH) reads the same names back.
      const second = new NameBook({ file })
      await second.load()
      expect(second.user('ou_a')).toBe('张三')
      expect(second.chat('oc_1')).toBe('研发群')
      expect(second.lookup('oc_1')).toBe('研发群')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the two kinds apart', async () => {
    const { dir, file } = await tempFile()
    try {
      const book = new NameBook({ file })
      book.rememberUsers({ ou_a: '张三' })
      book.rememberChats({ oc_1: '研发群' })
      expect(book.usersOf(['ou_a', 'oc_1'])).toEqual({ ou_a: '张三' })
      expect(book.chatsOf(['ou_a', 'oc_1'])).toEqual({ oc_1: '研发群' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not rewrite the file when nothing changed', async () => {
    const { dir, file } = await tempFile()
    try {
      const book = new NameBook({ file, flushDelayMs: 0 })
      book.rememberUsers({ ou_a: '张三' })
      await book.flush()
      const first = await readFile(file, 'utf8')
      book.rememberUsers({ ou_a: '张三' })
      await book.flush()
      expect(await readFile(file, 'utf8')).toBe(first)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats a corrupt file as an empty cache instead of throwing', async () => {
    const { dir, file } = await tempFile()
    try {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'nested'), { recursive: true })
      await writeFile(file, '{not json', 'utf8')
      const book = new NameBook({ file })
      await expect(book.load()).resolves.toBeUndefined()
      expect(book.user('ou_a')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('ChatNames', () => {
  const config = () => ({ appId: 'cli_x', appSecret: 's', brand: 'feishu' as const })

  it('resolves group names with the bot identity', async () => {
    const asked: string[] = []
    const names = new ChatNames({
      read: config,
      createClient: () => ({
        async get(chatId: string) {
          asked.push(chatId)
          return { code: 0, data: { name: chatId === 'oc_1' ? '研发群' : '' } }
        },
      }),
    })
    await expect(names.resolve(['oc_1', 'oc_2'])).resolves.toEqual({ oc_1: '研发群' })
    expect(asked).toEqual(['oc_1', 'oc_2'])
  })

  it('swallows a failed chat and keeps the rest', async () => {
    const warnings: string[] = []
    const names = new ChatNames({
      read: config,
      log: (message) => warnings.push(message),
      createClient: () => ({
        async get(chatId: string) {
          if (chatId === 'oc_gone') throw new Error('230002 bot not in chat')
          return { code: 0, data: { name: '研发群' } }
        },
      }),
    })
    await expect(names.resolve(['oc_gone', 'oc_1'])).resolves.toEqual({ oc_1: '研发群' })
    expect(warnings.join(' ')).toContain('oc_gone')
  })

  it('reports a non-zero code as no name', async () => {
    const names = new ChatNames({
      read: config,
      createClient: () => ({
        async get() {
          return { code: 230002, msg: 'bot not in chat' }
        },
      }),
    })
    await expect(names.resolve(['oc_x'])).resolves.toEqual({})
  })

  it('falls back to the chat list when a single get is refused', async () => {
    // Live 2026-11-10: a recent chat resolved as 未知群 because `chats/{id}`
    // answered an error for it. One list pass knows the same name.
    let listed = 0
    const names = new ChatNames({
      read: config,
      createClient: () => ({
        async get(chatId: string) {
          if (chatId === 'oc_weird') return { code: 230002, msg: 'bot not in chat' }
          return { code: 0, data: { name: 'Bots' } }
        },
        async list() {
          listed += 1
          return { code: 0, data: { items: [{ chat_id: 'oc_weird', name: '奇怪的群' }] } }
        },
      }),
    })
    await expect(names.resolve(['oc_weird', 'oc_bots'])).resolves.toEqual({
      oc_bots: 'Bots',
      oc_weird: '奇怪的群',
    })
    expect(listed).toBe(1)
  })

  it('searches groups by keyword and reports what it found', async () => {
    const remembered: Record<string, string>[] = []
    const names = new ChatNames({
      read: config,
      remember: (found) => remembered.push(found),
      createClient: () => ({
        async get() {
          return { code: 0, data: { name: '' } }
        },
        async search(query: string) {
          return query === 'SQL'
            ? { code: 0, data: { items: [{ chat_id: 'oc_sql', name: '研发群' }] } }
            : { code: 0, data: { items: [] } }
        },
      }),
    })
    await expect(names.search('SQL')).resolves.toEqual({
      chats: [{ chatId: 'oc_sql', name: '研发群' }],
    })
    expect(remembered).toEqual([{ oc_sql: '研发群' }])
    await expect(names.search('nope')).resolves.toEqual({ chats: [] })
  })

  it('surfaces a group-search error code', async () => {
    const names = new ChatNames({
      read: config,
      createClient: () => ({
        async get() {
          return { code: 0, data: { name: '' } }
        },
        async search() {
          return { code: 99991672, msg: 'no scope' }
        },
      }),
    })
    const found = await names.search('SQL')
    expect(found.chats).toEqual([])
    expect(found.error).toContain('99991672')
  })

  it('labels a nameless p2p chat instead of calling it 未知群', async () => {
    // Live 2026-11-10: a p2p chat id (no name by design) showed up as 未知群 in
    // the group suggestions.
    const names = new ChatNames({
      read: config,
      createClient: () => ({
        async get() {
          return { code: 0, data: { chat_mode: 'p2p' } }
        },
      }),
    })
    await expect(names.resolve(['oc_dm'])).resolves.toEqual({ oc_dm: '单聊' })
  })

it('an empty query lists the bot chats instead of searching', async () => {
    let searched = 0
    const names = new ChatNames({
      read: config,
      createClient: () => ({
        async get() {
          return { code: 0, data: { name: '' } }
        },
        async list() {
          return {
            code: 0,
            data: {
              items: [
                { chat_id: 'oc_sql', name: '研发群' },
                { chat_id: 'oc_bots', name: 'Bots' },
              ],
            },
          }
        },
        async search() {
          searched += 1
          return { code: 0, data: { items: [] } }
        },
      }),
    })
    await expect(names.search('')).resolves.toEqual({
      chats: [
        { chatId: 'oc_sql', name: '研发群' },
        { chatId: 'oc_bots', name: 'Bots' },
      ],
    })
    expect(searched).toBe(0)
  })

it('does nothing without credentials', async () => {
    const names = new ChatNames({
      read: () => ({ appId: '', appSecret: '', brand: 'feishu' as const }),
    })
    await expect(names.resolve(['oc_1'])).resolves.toEqual({})
    expect((await names.search('x')).chats).toEqual([])
  })
})