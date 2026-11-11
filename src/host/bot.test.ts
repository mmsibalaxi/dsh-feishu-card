import { describe, expect, it } from 'vitest'
import { createBotOpenId, type BotInfoReader } from './bot.ts'

const BOT = 'ou_0000000000000000000000000000000a'

const config = (appId = 'cli_a') => ({ appId, appSecret: 's', brand: 'feishu' as const })

/** A reader that records calls and answers from a queue. */
function fakeReader(answers: ({ code?: number; bot?: { open_id?: string } } | Error)[]) {
  const calls: string[] = []
  let index = 0
  const reader: BotInfoReader = {
    request: async ({ url }) => {
      calls.push(url)
      const answer = answers[Math.min(index, answers.length - 1)]
      index += 1
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return { reader, calls }
}

describe('createBotOpenId', () => {
  it('reads the bot open_id and caches it', async () => {
    const { reader, calls } = fakeReader([{ code: 0, bot: { open_id: BOT } }])
    const openId = createBotOpenId({ read: config, createClient: () => reader })
    expect(await openId()).toBe(BOT)
    expect(await openId()).toBe(BOT)
    expect(calls).toEqual(['/open-apis/bot/v3/info'])
  })

  it('returns undefined when credentials are missing, without calling Feishu', async () => {
    const { reader, calls } = fakeReader([{ code: 0, bot: { open_id: BOT } }])
    const openId = createBotOpenId({
      read: () => ({ appId: '', appSecret: '', brand: 'feishu' }),
      createClient: () => reader,
    })
    expect(await openId()).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('is undefined on a non-zero code', async () => {
    const { reader } = fakeReader([{ code: 99991663, msg: 'bad app' } as never])
    const openId = createBotOpenId({ read: config, createClient: () => reader })
    expect(await openId()).toBeUndefined()
  })

  it('is undefined and quiet when the call throws', async () => {
    const messages: string[] = []
    const { reader } = fakeReader([new Error('socket hang up')])
    const openId = createBotOpenId({
      read: config,
      createClient: () => reader,
      log: (message) => messages.push(message),
    })
    expect(await openId()).toBeUndefined()
    expect(messages[0]).toContain('bot info failed')
  })

  it('rebuilds the client and drops the cache when the app id changes', async () => {
    let appId = 'cli_a'
    const first = fakeReader([{ code: 0, bot: { open_id: BOT } }])
    const second = fakeReader([{ code: 0, bot: { open_id: 'ou_other' } }])
    const clients = [first.reader, second.reader]
    let built = 0
    const openId = createBotOpenId({
      read: () => ({ appId, appSecret: 's', brand: 'feishu' as const }),
      createClient: () => clients[built++],
    })
    expect(await openId()).toBe(BOT)
    appId = 'cli_b'
    expect(await openId()).toBe('ou_other')
    expect(built).toBe(2)
  })

  it('keeps the client across calls with the same app id', async () => {
    const { reader } = fakeReader([{ code: 0, bot: { open_id: BOT } }])
    let built = 0
    const openId = createBotOpenId({
      read: config,
      createClient: () => {
        built += 1
        return reader
      },
    })
    await openId()
    await openId()
    expect(built).toBe(1)
  })
})
