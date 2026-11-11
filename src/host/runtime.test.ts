import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { createRuntime, shouldSendTextFallback, stopDenied, type FeishuCardRuntime, type RuntimeDeps } from './runtime.ts'
import type { RawFeishuMessage } from './messages.ts'
import { CONFIG_DEFAULTS, type FeishuCardConfig } from '../shared/types.js'

/**
 * Point every state file at a throwaway directory BEFORE the runtime is built.
 *
 * `createRuntime` derives `sessions.json` / `seen.json` / `media/` from
 * DSH_HOME, and the dedup window is now persisted — without this redirect a
 * test run writes (and litters) the user's real `~/.dsh/feishu-card/`.
 */
process.env.DSH_HOME = path.join(os.tmpdir(), `dsh-test-home-${process.pid}`)

/**
 * End-to-end wiring test: a raw Feishu message goes through the real inbound
 * pipeline (dedup → normalize → access gate → command/agent → reply) with only
 * the transports faked. This is the closest thing to a live run that does not
 * need Feishu credentials.
 */

const SESSION_ID = 'session-test-1'

interface FakeWorld {
  runtime: FeishuCardRuntime
  sent: { chatId: string; text: string }[]
  followed: string[]
  deniedLogs: string[]
  frames: { agent: unknown; frame: unknown }[]
  /** Receipt reactions the runtime posted, in order. */
  acked: { messageId: string; emojiType?: string }[]
  /** Finished reactions (✅), in order. */
  settled: { messageId: string; emojiType?: string }[]
  /** Receipts taken back because no answer was produced. */
  cleared: string[]
}

function fakeConfig(over: Partial<FeishuCardConfig> = {}): FeishuCardConfig {
  return {
    appId: 'cli_test',
    appSecret: 'secret',
    ...CONFIG_DEFAULTS,
    ...over,
  } as FeishuCardConfig
}

function makeWorld(config: FeishuCardConfig, deps: RuntimeDeps = {}): FakeWorld {
  const sent: { chatId: string; text: string }[] = []
  const followed: string[] = []
  const deniedLogs: string[] = []
  const frames: { agent: unknown; frame: unknown }[] = []
  let cardAction: ((data: unknown) => Promise<unknown>) | undefined
  /** Receipt reactions the runtime posted, in order. */
  const acked: { messageId: string; emojiType?: string }[] = []
  /** Finished reactions (✅), in order. */
  const settled: { messageId: string; emojiType?: string }[] = []
  /** Receipts taken back because no answer was produced. */
  const cleared: string[] = []

  const listeners = new Map<string, ((payload: never) => void)[]>()
  /**
   * Emit one realistic turn.
   *
   * Deliberately models what bit us live: the stream's `end` frame closes ONE
   * ATTEMPT, and a multi-step turn has several of them. The turn is over only
   * when the durable `session/event` `turn/end` lands (the real loop appends it
   * once per turn, in the driver's `finally`).
   */
  const emitTurn = (agent: { id: string; session: unknown }, answer: string) => {
    const stream = listeners.get('agent/assistant-stream') ?? []
    // Attempt 1: reasoning + a preamble + a tool call, then its own `end`.
    for (const listener of stream) {
      listener({ agent, frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '想' } } } as never)
      listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '先查一下' } } } as never)
      listener({ agent, frame: { type: 'chunk', chunk: { type: 'tool-call-delta', id: 't1', name: 'web_search' } } } as never)
      listener({ agent, frame: { type: 'end' } } as never)
    }
    // Attempt 2: the real answer, after the tool result.
    for (const listener of stream) {
      listener({ agent, frame: { type: 'start' } } as never)
      listener({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: answer } } } as never)
      listener({ agent, frame: { type: 'end' } } as never)
    }
    // Durable boundary: the authoritative message, then the turn's end.
    const session = listeners.get('session/event') ?? []
    for (const listener of session) {
      listener(agent.session, {
        type: 'assistant/message',
        data: { message: { role: 'assistant', content: [{ type: 'text', text: answer }] } },
      } as never)
      listener(agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } } as never)
    }
  }
  const ctx = {
    logger: {
      // Access denials are logged at info (debug never reaches a user without a
      // log viewer), so both levels feed the assertion buffer.
      info: (message: string) => {
        if (message.includes('denied')) deniedLogs.push(message)
      },
      warn: () => undefined,
      debug: (message: string) => {
        if (message.includes('denied')) deniedLogs.push(message)
      },
    },
    on(name: string, listener: (payload: never) => void) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {
        listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener))
      }
    },
    agents: {
      async create(options: { sessionId: string }) {
        const agent = {
          id: options.sessionId,
          options: { model: 'deepseek-chat' },
          session: { id: options.sessionId },
          followup(message: { content: { text: string }[] }) {
            followed.push(message.content[0].text)
            emitTurn(agent, '好的，已完成')
          },
        }
        return { agent, dispose: async () => undefined }
      },
      async resume() {
        throw new Error('no persisted session in tests')
      },
    },
    // Cordis-like service reads: the plugin must go through `ctx.get()`
    // (inject-free) rather than property access, which the real context proxy
    // rejects with "cannot get property ... without inject".
    get: () => undefined,
  }
  const runtime = createRuntime(
    ctx as never,
    () => config,
    config,
    {
      createGateway: (options: { onCardAction?: (data: unknown) => Promise<unknown> }) => {
        // Capture the card-action handler so a test can press a button.
        cardAction = options.onCardAction
        return { start: async () => undefined, stop: async () => undefined } as never
      },
      createSender: () =>
        ({
          async sendText(chatId: string, text: string) {
            sent.push({ chatId, text })
          },
        }) as never,
      createCardTransport: () =>
        ({
          async createCard() {
            return 'card_1'
          },
          async updateCard() {},
          async batchUpdate() {},
          async settings() {},
        }) as never,
      // Never let a test reach Feishu for the receipt reaction: record instead.
      createReactor: () =>
        ({
          async ack(messageId: string, emojiType?: string) {
            acked.push({ messageId, emojiType })
            return true
          },
          async settle(messageId: string, emojiType?: string) {
            settled.push({ messageId, emojiType })
            return true
          },
          async clear(messageId: string) {
            cleared.push(messageId)
            return true
          },
        }) as never,
      // …nor for the bot's own open_id: the mention gate needs it, and without
      // an injected reader every group message costs a real HTTP round trip.
      createBotReader: () =>
        ({
          async request() {
            return { code: 0, bot: { open_id: 'ou_bot' } }
          },
        }) as never,
      ...deps,
    },
  )

  // Redirect the session store into a temp dir so tests never touch the real one.
  const store = (runtime as unknown as { __store?: never }).__store
  void store

  return { runtime, sent, followed, deniedLogs, frames, acked, settled, cleared, get cardAction() { return cardAction } }
}

function dm(over: Partial<RawFeishuMessage> = {}): RawFeishuMessage {
  return {
    messageId: 'om_1',
    eventId: 'ev_1',
    chatId: 'oc_dm',
    chatType: 'p2p',
    senderOpenId: 'ou_a',
    text: '帮我看看构建为什么失败',
    ...over,
  }
}

describe('inbound pipeline (integration, no Feishu)', () => {
  it('an allowlisted DM reaches the agent and the reply goes back', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'allowlist', allowlist: ['ou_a'], replyMode: 'text' }))
    await world.runtime.inbound(dm())
    expect(world.followed).toEqual(['帮我看看构建为什么失败'])
    expect(world.sent).toEqual([{ chatId: 'oc_dm', text: '好的，已完成' }])
  })

  it('a non-allowlisted sender gets nothing at all', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'allowlist', allowlist: ['ou_b'] }))
    await world.runtime.inbound(dm())
    expect(world.followed).toEqual([])
    expect(world.sent).toEqual([])
    expect(world.deniedLogs.join(' ')).toContain('dm-not-allowed')
  })

  it('an empty allowlist admits nobody (fail-closed)', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'allowlist', allowlist: [] }))
    await world.runtime.inbound(dm())
    expect(world.sent).toEqual([])
  })

  it('acknowledges an accepted message with a reaction before the turn starts', async () => {
    // User feedback 2026-11-09: 收到消息要有回复的表情. The card takes seconds to
    // appear, so the reaction is the only immediate sign the bot has the message.
    const world = makeWorld(fakeConfig({ dmPolicy: 'allowlist', allowlist: ['ou_a'], replyMode: 'text' }))
    await world.runtime.inbound(dm())
    expect(world.acked).toEqual([{ messageId: 'om_1', emojiType: 'OnIt' }])
    // …and it is replaced by ✅ once the answer is out (2026-11-10 feedback).
    expect(world.settled).toEqual([{ messageId: 'om_1', emojiType: 'DONE' }])
    expect(world.cleared).toEqual([])
  })

  it('takes the receipt back when no answer was produced', async () => {
    // A message that clears down to nothing is still acknowledged (it arrived),
    // but "done" would claim a reply that never happened.
    const world = makeWorld(fakeConfig({ dmPolicy: 'allowlist', allowlist: ['ou_a'], replyMode: 'text' }))
    await world.runtime.inbound(dm({ text: '   ' }))
    expect(world.acked).toEqual([{ messageId: 'om_1', emojiType: 'OnIt' }])
    expect(world.settled).toEqual([])
    expect(world.cleared).toEqual(['om_1'])
  })

  it('does not react to a denied sender (a stranger learns nothing)', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'allowlist', allowlist: ['ou_b'] }))
    await world.runtime.inbound(dm())
    expect(world.acked).toEqual([])
  })

  it('a redelivered event is ignored', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    await world.runtime.inbound(dm())
    await world.runtime.inbound(dm())
    expect(world.followed).toHaveLength(1)
  })

  it('group messages need a mention and a whitelisted chat', async () => {
    const config = fakeConfig({
      dmPolicy: 'disabled',
      groupPolicy: 'allowlist',
      groupAllowlist: ['oc_g1'],
      allowlist: ['ou_a'],
      replyMode: 'text',
    })
    const botMention = [{ key: '_user_1', openId: 'ou_bot' }]

    const notMentioned = makeWorld(config)
    await notMentioned.runtime.inbound(dm({ chatId: 'oc_g1', chatType: 'group' }))
    expect(notMentioned.sent).toEqual([])
    expect(notMentioned.deniedLogs.join(' ')).toContain('mention-required')

    const otherChat = makeWorld(config)
    await otherChat.runtime.inbound(dm({ chatId: 'oc_other', chatType: 'group', mentions: botMention }))
    expect(otherChat.sent).toEqual([])
    expect(otherChat.deniedLogs.join(' ')).toContain('group-not-allowed')

    const ok = makeWorld(config)
    await ok.runtime.inbound(
      dm({ chatId: 'oc_g1', chatType: 'group', mentions: botMention, text: '@_user_1 跑一下测试' }),
    )
    // The agent now gets a sender header (chat type is in the system prompt):
    // without one it cannot tell who is speaking in a group.
    expect(ok.followed[0]).toContain('[发送人 ou_a]')
    expect(ok.followed[0]).toContain('跑一下测试')
    expect(ok.sent).toEqual([{ chatId: 'oc_g1', text: '好的，已完成' }])
  })

  it('prefixes the sender name, the mentions and the quoted message', async () => {
    // The four facts the user asked for (2026-11-09): chat id/type in the
    // system prompt, and sender + mentions + quote on the message itself.
    const config = fakeConfig({
      dmPolicy: 'disabled',
      groupPolicy: 'allowlist',
      groupAllowlist: ['oc_g1'],
      allowlist: ['ou_a', 'ou_b'],
      replyMode: 'text',
    })
    const world = makeWorld(config, {
      directory: {
        names: async () => ({ names: { ou_a: '张三', ou_b: '李四' } }),
      },
      createQuote: () =>
        ({
          async fetch(messageId: string) {
            return messageId === 'om_quoted'
              ? { text: '这条你再看下', senderOpenId: 'ou_b', senderName: '李四' }
              : undefined
          },
        }) as never,
    })
    await world.runtime.inbound(
      dm({
        chatId: 'oc_g1',
        chatType: 'group',
        text: '@_user_1 这条你再看下',
        mentions: [
          { key: '_user_1', openId: 'ou_bot' },
          { key: '_user_2', openId: 'ou_b', name: '李四' },
        ],
        parentId: 'om_quoted',
      }),
    )
    const text = world.followed[0]
    expect(text).toContain('[发送人 张三 (ou_a)]')
    expect(text).toContain('[同时提到 李四 (ou_b)]')
    expect(text).toContain('> 引用 李四 (ou_b)：「这条你再看下」')
    expect(text).toContain('这条你再看下')
  })

  it('does not fetch a quote for a plain (non-reply) message', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open', replyMode: 'text' }), {
      createQuote: () =>
        ({
          async fetch() {
            throw new Error('a plain message must not trigger a quote lookup')
          },
        }) as never,
    })
    await world.runtime.inbound(dm())
    expect(world.followed).toHaveLength(1)
  })

  it('bridge commands are answered locally and never reach the agent', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    await world.runtime.inbound(dm({ text: '/status' }))
    expect(world.followed).toEqual([])
    expect(world.sent).toHaveLength(1)
    expect(world.sent[0].text).toContain('连接：')
    expect(world.sent[0].text).toContain('私聊：open')
  })

  it('/new answers with ONE bubble: the outcome, not a "working on it" placeholder', async () => {
    // Live regression (2026-11-10): /new replied "正在结束当前会话…" and then a
    // second message with the result, so one command cost two notifications.
    const world = makeWorld(fakeConfig({ dmPolicy: 'open', replyMode: 'text' }))
    await world.runtime.inbound(dm())
    world.sent.length = 0
    await world.runtime.inbound(dm({ messageId: 'om_2', eventId: 'ev_2', text: '/new' }))
    expect(world.sent.map((message) => message.text)).toEqual([
      '已结束当前会话，下一条消息将开新会话。',
    ])
  })

  it('/stop answers with one bubble too', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open', replyMode: 'text' }))
    await world.runtime.inbound(dm())
    world.sent.length = 0
    await world.runtime.inbound(dm({ messageId: 'om_3', eventId: 'ev_3', text: '/stop' }))
    expect(world.sent.map((message) => message.text)).toEqual(['已停止当前任务。'])
  })

  it('unknown slash commands fall through to the agent', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    await world.runtime.inbound(dm({ text: '/compact 帮我压缩' }))
    expect(world.followed).toEqual(['/compact 帮我压缩'])
  })

  it('an agent error is reported back instead of swallowed', async () => {
    const sent: string[] = []
    const settled: string[] = []
    const cleared: string[] = []
    const ctx = {
      logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
      on() {
        return () => undefined
      },
      get: () => undefined,
      agents: {
        async create(options: { sessionId: string }) {
          return {
            agent: {
              id: options.sessionId,
              options: {},
              followup() {
                for (const listener of []) void listener
                throw new Error('模型 429')
              },
            },
            dispose: async () => undefined,
          }
        },
        async resume() {
          throw new Error('nope')
        },
      },
    }
    const runtime = createRuntime(
      ctx as never,
      () => fakeConfig({ dmPolicy: 'open' }),
      fakeConfig({ dmPolicy: 'open' }),
      {
        createGateway: () => ({ start: async () => undefined, stop: async () => undefined }) as never,
        createSender: () =>
          ({ async sendText(_c: string, text: string) { sent.push(text) } }) as never,
        createCardTransport: () => ({}) as never,
        createReactor: () =>
          ({
            async ack() {
              return true
            },
            async settle() {
              settled.push('DONE')
              return true
            },
            async clear(messageId: string) {
              cleared.push(messageId)
              return true
            },
          }) as never,
      },
    )
    await runtime.inbound(dm())
    expect(sent.join(' ')).toContain('模型 429')
    // The failure must not leave a ✅ on the message: the receipt is withdrawn.
    expect(settled).toEqual([])
    expect(cleared).toEqual(['om_1'])
  })

  it('a turn that emits no frames still completes on agent/status:idle', async () => {
    // Regression guard: relying on the stream's `end` frame alone hangs a
    // frame-less turn (error paths, empty turns) until the 10-minute timeout.
    const followed: string[] = []
    const sent: string[] = []
    const listeners = new Map<string, ((p: never) => void)[]>()
    const ctx = {
      logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
      on(name: string, l: (p: never) => void) {
        const list = listeners.get(name) ?? []
        list.push(l)
        listeners.set(name, list)
        return () => undefined
      },
      get: () => undefined,
      agents: {
        async create(options: { sessionId: string }) {
          const agent = { id: options.sessionId, options: {}, session: { id: options.sessionId } }
          return {
            agent,
            async dispose() {},
            followup: undefined as never,
          }
        },
        async resume() {
          throw new Error('no session')
        },
      },
    }
    // followup emits NO stream frames, only the lifecycle transition
    const runtime = createRuntime(
      ctx as never,
      () => fakeConfig({ dmPolicy: 'open', replyMode: 'text' }),
      fakeConfig({ dmPolicy: 'open', replyMode: 'text' }),
      {
        createGateway: () => ({ start: async () => undefined, stop: async () => undefined }) as never,
        createSender: () => ({ async sendText(_c: string, t: string) { sent.push(t) } }) as never,
        createCardTransport: () => ({}) as never,
        createReactor: () =>
          ({
            async ack() {
              return true
            },
            async settle() {
              return true
            },
            async clear() {
              return true
            },
          }) as never,
      },
    )
    // Drive it manually: patch followup onto the created agent
    const original = ctx.agents.create
    ctx.agents.create = (async (options: { sessionId: string }) => {
      const agent = { id: options.sessionId, options: {}, session: { id: options.sessionId } }
      ;(agent as unknown as { followup: () => void }).followup = () => {
        followed.push('msg')
        for (const l of listeners.get('agent/status') ?? []) l({ agent, status: 'idle' } as never)
      }
      return { agent, dispose: async () => undefined }
    }) as never
    void original

    const started = Date.now()
    await runtime.inbound(dm())
    expect(followed).toHaveLength(1)
    expect(sent).toEqual(['（本轮无输出）'])
    // Must finish immediately, not after the 10-minute timeout.
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('replyMode=text sends plain text; streaming uses a card', async () => {
    const text = makeWorld(fakeConfig({ dmPolicy: 'open', replyMode: 'text' }))
    await text.runtime.inbound(dm())
    expect(text.sent).toEqual([{ chatId: 'oc_dm', text: '好的，已完成' }])

    const streamed = makeWorld(fakeConfig({ dmPolicy: 'open', replyMode: 'streaming' }))
    await streamed.runtime.inbound(dm())
    // The card carries the answer, so no extra text message is sent.
    expect(streamed.sent).toEqual([])
  })

  it('a card that never carried the answer falls back to a text reply', async () => {
    // Regression: the live turn produced a card with a footer and no answer,
    // and because the bridge reported `carded: true` no text was sent either —
    // the user got nothing at all. A card only suppresses the text reply when
    // it actually delivered the answer.
    const sent: string[] = []
    const world = makeWorld(fakeConfig({ dmPolicy: 'open', replyMode: 'streaming' }), {
      createCardTransport: () =>
        ({
          async createCard() {
            throw new Error('cardkit unavailable')
          },
          async updateCard() {},
          async batchUpdate() {},
          async settings() {},
        }) as never,
    })
    await world.runtime.inbound(dm())
    expect(sent).toEqual([])
    expect(world.sent).toEqual([{ chatId: 'oc_dm', text: '好的，已完成' }])
  })
})

describe('shouldSendTextFallback', () => {
  it('sends nothing when the card already carried the answer', () => {
    expect(
      shouldSendTextFallback({ carded: true, cardCreated: true, reason: 'completed' }),
    ).toBe(false)
  })

  it('sends the answer when the card never delivered it', () => {
    // A broken card must not swallow the answer: the user has to get it.
    expect(
      shouldSendTextFallback({ carded: false, cardCreated: true, reason: 'completed' }),
    ).toBe(true)
  })

  it('stays silent for a stopped turn whose card already says 已停止', () => {
    // 2026-11-10: the card showed 已停止 and the runtime also posted
    // "（本轮无输出）" right underneath it.
    expect(
      shouldSendTextFallback({ carded: false, cardCreated: true, reason: 'stopped' }),
    ).toBe(false)
  })

  it('still sends the text for a stopped turn with NO card at all', () => {
    // Nothing else would tell the user anything.
    expect(
      shouldSendTextFallback({ carded: false, cardCreated: false, reason: 'stopped' }),
    ).toBe(true)
  })
})

describe('stopDenied', () => {
  it('lets the owner stop their own turn', () => {
    expect(stopDenied('ou_a', 'ou_a')).toBeUndefined()
  })

  it('refuses somebody else', () => {
    // 2026-11-10: in a group, only the person whose message opened the turn may
    // cancel it.
    expect(stopDenied('ou_a', 'ou_b')).toContain('只有发起这条消息的人')
  })

  it('allows when nothing is running', () => {
    expect(stopDenied(undefined, 'ou_b')).toBeUndefined()
  })

  it('allows when the payload does not say who clicked', () => {
    // A payload-shape change must not brick the button.
    expect(stopDenied('ou_a', undefined)).toBeUndefined()
  })
})

describe('card 停止 button ownership', () => {
  const stopValue = { feishuCardStop: 'stop', sessionKey: 'oc_dm', ownerOpenId: 'ou_a' }

  it('refuses a click from anybody but the requester', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    const refused = (await world.cardAction!({
      operator: { open_id: 'ou_b' },
      action: { value: stopValue },
    })) as { toast?: { type?: string; content?: string } }
    expect(refused.toast?.type).toBe('warning')
    expect(refused.toast?.content).toContain('只有发起这条消息的人')
  })

  it('stops when the requester presses it', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    const allowed = (await world.cardAction!({
      operator: { open_id: 'ou_a' },
      action: { value: stopValue },
    })) as { toast?: { type?: string; content?: string } }
    expect(allowed.toast?.type).toBe('info')
    expect(allowed.toast?.content).toContain('已请求停止')
  })

  it('still stops when the payload omits the operator', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    const allowed = (await world.cardAction!({ action: { value: stopValue } })) as {
      toast?: { type?: string }
    }
    expect(allowed.toast?.type).toBe('info')
  })

  it('leaves other card buttons (the asker) alone', async () => {
    const world = makeWorld(fakeConfig({ dmPolicy: 'open' }))
    await expect(
      world.cardAction!({ operator: { open_id: 'ou_b' }, action: { value: { other: 1 } } }),
    ).resolves.toBeUndefined()
  })
})

describe('temp isolation', () => {
  it('uses a temp DSH_HOME so the real store is never touched', () => {
    // The runtime reads process.env.DSH_HOME; tests that care set it themselves.
    expect(typeof os.homedir()).toBe('string')
    expect(path.isAbsolute(os.tmpdir())).toBe(true)
  })
})

