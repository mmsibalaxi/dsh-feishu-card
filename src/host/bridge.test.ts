/**
 * Verify the agent-creation wiring: the model selection must reach
 * `agentOptions` (the core applies it with `agent.model.select()` before the
 * first step) and must never travel through an `agent/request` hook — core
 * 0.2.2 freezes the request route at step preparation and rejects such a hook
 * with `agent/request proposed "..." after step preparation fixed "..."`.
 *
 * Also guards the `{{model}}` prompt variable, supplied by the
 * `system-prompt/assemble` hook.
 */
import { describe, expect, it } from 'vitest'
import { FeishuBridge } from './bridge.ts'
import { SessionStore } from './sessions.ts'
import os from 'node:os'
import path from 'node:path'

function makeWorld(
  options: {
    model?: { provider: string; model: string }
    defaultModel?: unknown
    /** Omit `agent.model`, mimicking a core without the pre-step route switch. */
    withModelHandle?: boolean
  } = {},
) {
  const listeners = new Map<string, ((p: never) => void)[]>()
  const created: { sessionId: string; agentOptions?: unknown; setup?: unknown }[] = []
  /** Routes pinned through the core's `agent.model.select()`. */
  const selections: { provider: string; model: string; reasoningEffort?: string }[] = []
  /** Events the plugin registers on the agent's scoped context. */
  const agentEvents: string[] = []
  /** The listeners themselves, so a test can drive a prompt assembly. */
  const agentListeners = new Map<string, ((...args: never[]) => unknown)[]>()
  const withModelHandle = options.withModelHandle !== false
  /** Minimal agentCtx: the prompt-variable hook is all we install. */
  const agentCtx = {
    on: (name: string, listener?: (...args: never[]) => unknown) => {
      agentEvents.push(name)
      if (listener) {
        const list = agentListeners.get(name) ?? []
        list.push(listener)
        agentListeners.set(name, list)
      }
      return () => undefined
    },
    get: (name: string) => (name === 'agentPresets' ? undefined : undefined),
    logger: { warn: () => undefined },
  }
  const services: Record<string, unknown> = {
    agentDefaultModel: options.defaultModel
      ? { currentSelection: () => options.defaultModel }
      : undefined,
  }
  const ctx = {
    logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
    on(name: string, l: (p: never) => void) {
      const list = listeners.get(name) ?? []
      list.push(l)
      listeners.set(name, list)
      return () => undefined
    },
    /**
     * Mimics the cordis context proxy: reading a service that is not in this
     * plugin's `inject` list THROWS, exactly like the live failure
     *   cannot get property "agentDefaultModel" without inject
     * `ctx.get()` is the inject-free escape hatch and must be what we use.
     */
    get: (name: string) => services[name],
    agents: {
      async create(options: { sessionId: string; agentOptions?: unknown; setup?: (c: never) => Promise<void> }) {
        created.push(options)
        const agent = {
          id: options.sessionId,
          options: (options.agentOptions ?? {}) as { model?: string },
          session: { id: options.sessionId },
          ...(withModelHandle === false
            ? {}
            : {
                model: {
                  select: (next: { provider: string; model: string; reasoningEffort?: string }) => {
                    selections.push(next)
                  },
                },
              }),
          followup(message: { content: { text: string }[] }) {
            // One realistic turn: two attempts (each with its own `end` frame),
            // then the durable turn boundary that actually ends the turn.
            const stream = listeners.get('agent/assistant-stream') ?? []
            for (const l of stream) {
              l({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '先查一下' } } } as never)
              l({ agent, frame: { type: 'end' } } as never)
              l({ agent, frame: { type: 'start' } } as never)
              l({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '好的' } } } as never)
              l({ agent, frame: { type: 'end' } } as never)
            }
            for (const l of listeners.get('session/event') ?? []) {
              l(agent.session, {
                type: 'assistant/message',
                data: { message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } },
              } as never)
              l(agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } } as never)
            }
            void message
          },
        }
        // The factory awaits setup BEFORE publishing, exactly like the real loop.
        if (options.setup) await options.setup(agentCtx as never)
        return { agent, dispose: async () => undefined }
      },
      async resume() {
        throw new Error('no session')
      },
    },
  }

  const store = new SessionStore(path.join(os.tmpdir(), `dsh-bridge-test-${Date.now()}-${Math.random()}`, 'sessions.json'))
  const bridge = new FeishuBridge(ctx as never, {
    store,
    defaultWorkspace: () => 'D:\\work',
    // Read per session, so a panel edit or a /model switch applies to the next
    // one without restarting dsh.
    model: options.model ? () => options.model : undefined,
  })
  return { bridge, created, listeners, ctx, agentEvents, selections, agentListeners }
}

/** Emit one complete turn on the given agent id. */
function runTurn(listeners: Map<string, ((p: never) => void)[]>, agentId: string) {
  const agent = { id: agentId }
  for (const l of listeners.get('agent/assistant-stream') ?? []) {
    l({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '好的' } } } as never)
    l({ agent, frame: { type: 'end' } } as never)
  }
}

describe('agent creation wiring ({{model}} regression)', () => {
  it('passes the host default model through agentOptions and setup', async () => {
    const world = makeWorld({ defaultModel: { provider: 'magpie', model: 'group/auto-step-5-preview' } })
    await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(world.created).toHaveLength(1)
    expect(world.created[0].agentOptions).toEqual({
      provider: 'magpie',
      model: 'group/auto-step-5-preview',
    })
    // setup ran and installed the prompt-variable hook
    expect(world.created[0].setup).toBeTypeOf('function')
    expect(world.agentEvents).toContain('system-prompt/assemble')
    // and the route was pinned on the agent before the first step
    expect(world.selections).toEqual([{ provider: 'magpie', model: 'group/auto-step-5-preview' }])
  })

  it('pins reasoning effort too (never silently downgrades to the adapter default)', async () => {
    const world = makeWorld({
      defaultModel: { provider: 'magpie', model: 'auto/deepseek-v4.1-flash', reasoningEffort: 'max' },
    })
    await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(world.created[0].agentOptions).toEqual({
      provider: 'magpie',
      model: 'auto/deepseek-v4.1-flash',
      reasoningEffort: 'max',
    })
    expect(world.selections).toEqual([
      { provider: 'magpie', model: 'auto/deepseek-v4.1-flash', reasoningEffort: 'max' },
    ])
  })

  it('still creates on a core without agent.model (agentOptions is the only route)', async () => {
    const world = makeWorld({
      defaultModel: { provider: 'magpie', model: 'auto/deepseek-v4.1-flash' },
      withModelHandle: false,
    })
    const result = await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(result.text).toBe('好的')
    expect(world.selections).toEqual([])
  })

  it('never registers an agent/request hook (route is frozen at step preparation)', async () => {
    // Regression: dsh-agent 0.2.1-rc.2's installModelSelection rewrote the
    // request route through agent/request, which core 0.2.2 rejects with
    //   agent/request proposed "magpie/auto/deepseek-v4.1-flash" after step
    //   preparation fixed "magpie/raccoon/sn-deepseek-v4-1-flash-1017"
    // The route must travel via agentOptions + agent.model.select() only.
    const world = makeWorld({ defaultModel: { provider: 'magpie', model: 'auto/deepseek-v4.1-flash' } })
    await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(world.agentEvents).not.toContain('agent/request')
    expect(world.agentEvents).not.toContain('system-prompt/assemble-via-agent-request')
    expect(world.agentEvents.filter((name) => name === 'system-prompt/assemble')).toHaveLength(1)
  })

  it('explicit config wins over the host default', async () => {
    const world = makeWorld({
      model: { provider: 'my-provider', model: 'my-model' },
      defaultModel: { provider: 'magpie', model: 'group/auto-step-5-preview' },
    })
    await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(world.created[0].agentOptions).toEqual({ provider: 'my-provider', model: 'my-model' })
  })

  it('injects the Feishu chat into the system prompt', async () => {
    // The user's #1 requirement (2026-11-09): the agent must know which chat it
    // is in. Chat id / chat type are conversation facts, so they belong in the
    // system prompt rather than on every message.
    const world = makeWorld({ defaultModel: { provider: 'magpie', model: 'm' } })
    await world.bridge.handleMessage({
      sessionKey: 'oc_700a',
      chatId: 'oc_700a',
      chatType: 'group',
      text: '把这个群的日报汇总一下',
    })
    const assemble = world.agentListeners.get('system-prompt/assemble')?.[0] as unknown as
      | ((assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>)
      | undefined
    expect(assemble).toBeTypeOf('function')
    const before = { sections: [{ name: 'deployment:persona-prefix', text: 'persona' }], contexts: [], tools: [], variables: {} }
    const after = (await assemble!({}, {}, async () => before)) as {
      sections: { name: string; text: string; interpolate?: boolean }[]
    }
    expect(after.sections.map((section) => section.name)).toEqual([
      'deployment:persona-prefix',
      'feishu:channel',
    ])
    const channel = after.sections[1]
    expect(channel.text).toContain('oc_700a')
    expect(channel.text).toContain('群聊')
    // Literal text: renderPrompt must not treat our prose as {{variables}}.
    expect(channel.interpolate).toBe(false)
  })

  it('leaves the prompt alone when the caller knows nothing about the chat', async () => {
    const world = makeWorld({ defaultModel: { provider: 'magpie', model: 'm' } })
    await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    const assemble = world.agentListeners.get('system-prompt/assemble')?.[0] as unknown as
      | ((assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>)
      | undefined
    const before = { sections: [{ name: 'only', text: 'x' }], contexts: [], tools: [], variables: {} }
    const after = (await assemble!({}, {}, async () => before)) as { sections: { name: string }[] }
    expect(after.sections.map((section) => section.name)).toEqual(['only'])
  })

  it('the created agent answers the turn (setup did not break the loop)', async () => {
    const world = makeWorld({ defaultModel: { provider: 'magpie', model: 'group/auto-step-5-preview' } })
    const result = await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(result.text).toBe('好的')
    expect(result.model).toBe('group/auto-step-5-preview')
    // frames for THIS agent were consumed
    expect(world.listeners.get('agent/assistant-stream')?.length).toBeGreaterThan(0)
  })

  it('without any model source it still creates (host will fail at assembly)', async () => {
    // No agentDefaultModel service and no explicit config: agentOptions stays
    // undefined. Creation itself must not throw — the real host then fails at
    // prompt assembly with the {{model}} error, which is the symptom this
    // whole file guards against.
    const world = makeWorld({})
    await world.bridge.handleMessage({ sessionKey: 'oc_1', chatId: 'oc_1', text: 'hi' })
    expect(world.created).toHaveLength(1)
    expect(world.created[0].agentOptions).toBeUndefined()
    // The session is still recorded, so a later message retries with a model.
    expect(world.bridge.describe('oc_1').sessionId).toBe(world.created[0].sessionId)
  })
})

describe('the turn boundary is turn/end, not the stream end frame', () => {
  /**
   * Live regression: a multi-step turn emits `start`/`end` per LLM ATTEMPT, so
   * treating the stream's `end` as the turn's end sealed the card after the
   * first preamble ("继续查询北京今天的实时天气情况。") and dropped the real
   * answer that arrived in the next attempt. The card the user saw had a
   * footer, a spinner and no answer.
   */
  it('keeps listening across attempts until turn/end', async () => {
    const listeners = new Map<string, ((p: never) => void)[]>()
    const seen: string[] = []
    const agent = {
      id: 'sess_multi',
      options: {},
      session: { id: 'sess_multi' },
      followup() {
        const stream = listeners.get('agent/assistant-stream') ?? []
        for (const l of stream) {
          l({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '先查一下' } } } as never)
          l({ agent, frame: { type: 'end' } } as never)
        }
        // A tool runs, then a second attempt streams the real answer.
        for (const l of stream) {
          l({ agent, frame: { type: 'start' } } as never)
          l({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: '北京今天晴' } } } as never)
          l({ agent, frame: { type: 'end' } } as never)
        }
        for (const l of listeners.get('session/event') ?? []) {
          l(agent.session, {
            type: 'assistant/message',
            data: { message: { role: 'assistant', content: [{ type: 'text', text: '北京今天晴' }] } },
          } as never)
          l(agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } } as never)
        }
      },
    }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-multi-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const bridge = new FeishuBridge(
      {
        logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        on(name: string, l: (p: never) => void) {
          const list = listeners.get(name) ?? []
          list.push(l)
          listeners.set(name, list)
          return () => undefined
        },
        get: () => undefined,
        agents: {
          async create() {
            return { agent, dispose: async () => undefined }
          },
          async resume() {
            throw new Error('no session')
          },
        },
      } as never,
      { store, defaultWorkspace: () => 'D:\\work', createCard: (_chatId, _agent, _usage) => card },
    )
    // A card that records what it was told, so we can assert on the content.
    const card = {
      text: '',
      delivered: false,
      id: 'card_multi',
      pushAnswer(delta: string) {
        this.text += delta
        this.delivered = true
      },
      setAnswer(text: string) {
        this.text = text
        this.delivered = true
      },
      pushReasoning: () => undefined,
      pushTool: () => undefined,
      newSegment: () => undefined,
      start: async () => undefined,
      seal: async () => undefined,
      abort: async () => undefined,
    }

    const result = await bridge.handleMessage({ sessionKey: 'oc_m', chatId: 'oc_m', text: '今天天气' })

    // The authoritative answer from the last attempt, not the first preamble.
    expect(result.text).toBe('北京今天晴')
    expect(result.carded).toBe(true)
    expect(card.text).toBe('北京今天晴')
    expect(seen).toEqual([])
  })

  it('reports a stopped turn as stopped, with the card created and no text', async () => {
    // The runtime uses exactly this to decide whether to post "（本轮无输出）"
    // under a card that already says 已停止 (2026-11-10).
    const listeners = new Map<string, ((p: never) => void)[]>()
    let turnState: { ownerOpenId?: string } | undefined
    const agent = {
      id: 'sess_stop',
      options: {},
      session: { id: 'sess_stop' },
      followup() {
        for (const l of listeners.get('session/event') ?? []) {
          l(agent.session, { type: 'turn/end', data: { reason: { kind: 'aborted' } } } as never)
        }
      },
    }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-stop-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const card = {
      text: '',
      delivered: false,
      id: 'card_stop',
      pushAnswer: () => undefined,
      setAnswer: () => undefined,
      pushReasoning: () => undefined,
      pushTool: () => undefined,
      newSegment: () => undefined,
      start: async () => undefined,
      seal: async () => undefined,
      abort: async () => undefined,
    }
    const bridge = new FeishuBridge(
      {
        logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        on(name: string, l: (p: never) => void) {
          const list = listeners.get(name) ?? []
          list.push(l)
          listeners.set(name, list)
          return () => undefined
        },
        get: () => undefined,
        agents: {
          async create() {
            return { agent, dispose: async () => undefined }
          },
          async resume() {
            throw new Error('no session')
          },
        },
      } as never,
      {
        store,
        defaultWorkspace: () => 'D:\\work',
        createCard: (_c, _a, state) => {
          turnState = state as { ownerOpenId?: string }
          return card as never
        },
      },
    )
    const result = await bridge.handleMessage({
      sessionKey: 'oc_s',
      chatId: 'oc_s',
      text: '跑个长任务',
      senderOpenId: 'ou_a',
    })
    expect(result.reason).toBe('stopped')
    // The card's stop button carries this, so only ou_a may press it.
    expect(turnState?.ownerOpenId).toBe('ou_a')
    expect(result.cardCreated).toBe(true)
    // No text reached the card, so `carded` is false — that is precisely why the
    // runtime needs `cardCreated` + `reason` to stay quiet.
    expect(result.carded).toBe(false)
  })

  it('surfaces a failed turn with the real error message', async () => {
    const listeners = new Map<string, ((p: never) => void)[]>()
    const agent = {
      id: 'sess_fail',
      options: {},
      session: { id: 'sess_fail' },
      followup() {
        for (const l of listeners.get('session/event') ?? []) {
          l(agent.session, {
            type: 'turn/end',
            data: { reason: { kind: 'error', error: { message: '模型 429' } } },
          } as never)
        }
      },
    }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-fail-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const bridge = new FeishuBridge(
      {
        logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        on(name: string, l: (p: never) => void) {
          const list = listeners.get(name) ?? []
          list.push(l)
          listeners.set(name, list)
          return () => undefined
        },
        get: () => undefined,
        agents: {
          async create() {
            return { agent, dispose: async () => undefined }
          },
          async resume() {
            throw new Error('no session')
          },
        },
      } as never,
      { store, defaultWorkspace: () => 'D:\\work' },
    )
    await expect(
      bridge.handleMessage({ sessionKey: 'oc_f', chatId: 'oc_f', text: 'hi' }),
    ).rejects.toThrow('模型 429')
  })

  it('registers a new session in the workspace registry', async () => {
    // `agents.create()` leaves the session unowned, so the GUI filed it under
    // an untitled group ("未命名") and refused to open its history. The app's
    // own creation path attaches right after creating; we must too.
    const listeners = new Map<string, ((p: never) => void)[]>()
    const attached: { sessionId: string; cwd: string }[] = []
    const agent = {
      id: 'sess_ws',
      options: {},
      session: { id: 'sess_ws' },
      followup() {
        for (const l of listeners.get('session/event') ?? []) {
          l(agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } } as never)
        }
      },
    }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-ws-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const bridge = new FeishuBridge(
      {
        logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        on(name: string, l: (p: never) => void) {
          const list = listeners.get(name) ?? []
          list.push(l)
          listeners.set(name, list)
          return () => undefined
        },
        get: () => undefined,
        agents: {
          async create() {
            return { agent, dispose: async () => undefined }
          },
          async resume() {
            throw new Error('no session')
          },
        },
      } as never,
      {
        store,
        defaultWorkspace: () => 'D:\\workspace\\dsh-feishu',
        attachWorkspace: async (sessionId, cwd) => {
          attached.push({ sessionId, cwd })
        },
      },
    )

    await bridge.handleMessage({ sessionKey: 'oc_w', chatId: 'oc_w', text: 'hi' })
    expect(attached).toEqual([{ sessionId: 'sess_ws', cwd: 'D:\\workspace\\dsh-feishu' }])
    expect(store.get('oc_w')?.workspace).toBe('D:\\workspace\\dsh-feishu')
  })

  it('a blocked turn resets the session and says why', async () => {
    const listeners = new Map<string, ((p: never) => void)[]>()
    const agent = {
      id: 'sess_blocked',
      options: {},
      session: { id: 'sess_blocked' },
      followup() {
        for (const l of listeners.get('session/event') ?? []) {
          l(agent.session, { type: 'turn/end', data: { reason: { kind: 'blocked' } } } as never)
        }
      },
    }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-blocked-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const bridge = new FeishuBridge(
      {
        logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        on(name: string, l: (p: never) => void) {
          const list = listeners.get(name) ?? []
          list.push(l)
          listeners.set(name, list)
          return () => undefined
        },
        get: () => undefined,
        agents: {
          async create() {
            return { agent, dispose: async () => undefined }
          },
          async resume() {
            throw new Error('no session')
          },
        },
      } as never,
      { store, defaultWorkspace: () => 'D:\\work' },
    )

    const result = await bridge.handleMessage({ sessionKey: 'oc_b', chatId: 'oc_b', text: 'hi' })
    expect(result.text).toContain('已自动开新会话')
    expect(result.carded).toBe(false)
    // The mapping is gone, so the next message builds a fresh session.
    expect(bridge.describe('oc_b').sessionId).toBeUndefined()
    expect(store.get('oc_b')).toBeUndefined()
  })
})

describe('service reads must not use ctx property access', () => {
  /**
   * The cordis context is a Proxy: `ctx.<service>` throws
   *   cannot get property "<service>" without inject
   * for every service that is not in the plugin's `inject` list. A cast in
   * TypeScript cannot defeat that, which is exactly how this bug shipped once.
   * Rebuild the proxy's contract here so the regression is caught offline.
   */
  function proxyLike(services: Record<string, unknown>) {
    const listeners = new Map<string, ((p: never) => void)[]>()
    const agent = {
      id: 'sess_proxy',
      options: {} as { model?: string },
      session: { id: 'sess_proxy' },
      followup() {
        // A frame-less turn: the bridge's `agent/status: idle` safety net must
        // close it, not the 10-minute timeout.
        for (const l of listeners.get('agent/status') ?? []) l({ agent, status: 'idle' } as never)
      },
    }
    const base: Record<string, unknown> = {
      logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
      on(name: string, l: (p: never) => void) {
        const list = listeners.get(name) ?? []
        list.push(l)
        listeners.set(name, list)
        return () => undefined
      },
      get: (name: string) => services[name],
      agents: {
        async create(options: { sessionId: string; agentOptions?: { provider: string; model: string } }) {
          agent.options = options.agentOptions ?? {}
          return { agent, dispose: async () => undefined }
        },
        async resume() {
          throw new Error('no session')
        },
      },
    }
    return new Proxy(base, {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        throw new Error(`cannot get property "${prop}" without inject`)
      },
    })
  }

  it('reads agentDefaultModel through ctx.get, not ctx.agentDefaultModel', async () => {
    const selection = { provider: 'magpie', model: 'group/auto-step-5-preview' }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-proxy-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const bridge = new FeishuBridge(proxyLike({ agentDefaultModel: { currentSelection: () => selection } }) as never, {
      store,
      defaultWorkspace: () => 'D:\\work',
    })
    await bridge.handleMessage({ sessionKey: 'oc_p', chatId: 'oc_p', text: 'hi' })
    expect(bridge.describe('oc_p').model).toBe('group/auto-step-5-preview')
  })
})



/**
 * Per-turn card state.
 *
 * Regression guard: the card's header/footer used to read two module-level
 * variables (`currentCard`, `rounds`), so with two chats streaming at once the
 * tool steps of chat A were drawn on chat B's card and the round counters were
 * shared. Each turn now owns a `TurnState` and its own card.
 */
describe('per-turn card isolation', () => {
  function fakeCard(tag: string) {
    const card = {
      tag,
      text: '',
      delivered: true,
      id: `card_${tag}`,
      steps: [] as { id: string; name: string }[],
      toolStart(id: string, name: string) {
        card.steps.push({ id, name })
      },
      toolEnd() {},
      pushAnswer(delta: string) {
        card.text += delta
      },
      setAnswer(text: string) {
        card.text = text
      },
      pushReasoning: () => undefined,
      pushTool: () => undefined,
      newSegment: () => undefined,
      start: async () => undefined,
      seal: async () => undefined,
      abort: async () => undefined,
    }
    return card
  }

  it('routes tool events to the card of the turn that produced them', async () => {
    const listeners = new Map<string, ((p: never) => void)[]>()
    const cards = new Map<string, ReturnType<typeof fakeCard>>()
    const states: unknown[] = []
    const agentIds: string[] = []
    const ctx = {
      logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
      on(name: string, listener: (p: never) => void) {
        const list = listeners.get(name) ?? []
        list.push(listener)
        listeners.set(name, list)
        return () => undefined
      },
      get: () => undefined,
      agents: {
        async create(options: { sessionId: string }) {
          agentIds.push(options.sessionId)
          const agent = {
            id: options.sessionId,
            options: {},
            session: { id: options.sessionId },
            cancel: () => undefined,
            followup() {
              const emit = (event: unknown) => {
                for (const listener of listeners.get('session/event') ?? []) {
                  listener(agent.session as never, event as never)
                }
              }
              // One reasoning step and one tool call, then the turn ends.
              emit({ type: 'step/start', data: {} })
              emit({ type: 'tool/call', data: { callId: `call_${agent.id}`, name: `tool_${agent.id}` } })
              emit({ type: 'tool/result', data: { callId: `call_${agent.id}`, message: { isError: false } } })
              emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
            },
          }
          return { agent, dispose: async () => undefined }
        },
        async resume() {
          throw new Error('no session')
        },
      },
    }
    const store = new SessionStore(
      path.join(os.tmpdir(), `dsh-bridge-iso-${Date.now()}-${Math.random()}`, 'sessions.json'),
    )
    const bridge = new FeishuBridge(ctx as never, {
      store,
      defaultWorkspace: () => '',
      createCard: (chatId, _agent, state) => {
        const card = fakeCard(chatId)
        cards.set(chatId, card)
        states.push(state)
        return card
      },
    })

    await Promise.all([
      bridge.handleMessage({ sessionKey: 'oc_a', chatId: 'oc_a', text: 'A' }),
      bridge.handleMessage({ sessionKey: 'oc_b', chatId: 'oc_b', text: 'B' }),
    ])

    // Each card saw exactly one tool call, and they are different calls — the
    // old shared `currentCard` pointer gave both of them to the last card.
    const aSteps = cards.get('oc_a')!.steps.map((step) => step.name)
    const bSteps = cards.get('oc_b')!.steps.map((step) => step.name)
    expect(aSteps).toHaveLength(1)
    expect(bSteps).toHaveLength(1)
    expect(aSteps[0]).not.toBe(bSteps[0])
    expect(agentIds.map((id) => `tool_${id}`).sort()).toEqual([aSteps[0], bSteps[0]].sort())
    // …and each turn counted its own round.
    expect(states).toHaveLength(2)
    expect(states[0]).not.toBe(states[1])
    expect((states[0] as { rounds: number }).rounds).toBe(1)
    expect((states[1] as { rounds: number }).rounds).toBe(1)
  })
})
