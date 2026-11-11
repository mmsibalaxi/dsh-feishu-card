import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecentContacts } from './recent.ts'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'feishu-recent-'))
  file = path.join(dir, 'recent.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const make = (limit?: number) => new RecentContacts({ file, ...(limit ? { limit } : {}) })

describe('RecentContacts', () => {
  it('lists senders newest-first and counts repeats', async () => {
    const recent = make()
    await recent.load()
    recent.note('ou_a', 'oc_1', 1000)
    recent.note('ou_b', 'oc_1', 2000)
    recent.note('ou_a', 'oc_1', 3000)
    expect(recent.list().map((row) => [row.openId, row.at, row.count])).toEqual([
      ['ou_a', 3000, 2],
      ['ou_b', 2000, 1],
    ])
  })

  it('keeps the list bounded, dropping the oldest', async () => {
    const recent = make(2)
    await recent.load()
    recent.note('ou_a', 'oc_1', 1)
    recent.note('ou_b', 'oc_1', 2)
    recent.note('ou_c', 'oc_1', 3)
    expect(recent.list().map((row) => row.openId)).toEqual(['ou_c', 'ou_b'])
  })

  it('collects the distinct chats it has seen, newest first', async () => {
    const recent = make()
    await recent.load()
    recent.note('ou_a', 'oc_1', 1000)
    recent.note('ou_b', 'oc_2', 2000)
    recent.note('ou_c', 'oc_1', 3000)
    expect(recent.chats()).toEqual([
      { chatId: 'oc_1', at: 3000 },
      { chatId: 'oc_2', at: 2000 },
    ])
  })

  it('survives a round trip through the file', async () => {
    const first = make()
    await first.load()
    first.note('ou_a', 'oc_1', 1234)
    first.note('ou_b', 'oc_2', 5678)
    await first.flush()

    const second = make()
    await second.load()
    expect(second.list().map((row) => [row.openId, row.chatId, row.at])).toEqual([
      ['ou_b', 'oc_2', 5678],
      ['ou_a', 'oc_1', 1234],
    ])
  })

  it('starts empty for a missing file', async () => {
    const recent = make()
    await recent.load()
    expect(recent.list()).toEqual([])
  })

  it('starts empty for a corrupt file instead of throwing', async () => {
    await writeFile(file, 'not json', 'utf8')
    const recent = make()
    await recent.load()
    expect(recent.list()).toEqual([])
  })

  it('drops malformed rows when loading', async () => {
    await writeFile(
      file,
      JSON.stringify([
        { openId: 'ou_ok', chatId: 'oc_1', at: 10, count: 2 },
        { openId: '', chatId: 'oc_1' },
        { openId: 'ou_nochat' },
        null,
        'nope',
      ]),
      'utf8',
    )
    const recent = make()
    await recent.load()
    expect(recent.list().map((row) => row.openId)).toEqual(['ou_ok'])
  })

  it('ignores writes without both ids', async () => {
    const recent = make()
    await recent.load()
    recent.note('', 'oc_1')
    recent.note('ou_a', '')
    expect(recent.list()).toEqual([])
  })

  it('persists what it wrote', async () => {
    const recent = make()
    await recent.load()
    recent.note('ou_a', 'oc_1', 42)
    await recent.flush()
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved).toEqual([{ openId: 'ou_a', chatId: 'oc_1', at: 42, count: 1 }])
  })
})
