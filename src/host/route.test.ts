import { describe, expect, it } from 'vitest'
import {
  AUTH_PATH,
  CHAT_SEARCH_PATH,
  MODELS_PATH,
  NAMES_PATH,
  RECENT_PATH,
  SEARCH_PATH,
  handlePanelRequest,
  registerPanelRoutes,
  type PanelRouteDeps,
  type RouteRequest,
  type RouteResponse,
} from './route.ts'

interface Recorded {
  status: number
  headers?: Record<string, string>
  body: unknown
}

function recorder(): { res: RouteResponse; recorded: Recorded } {
  const recorded: Recorded = { status: 0, body: undefined }
  const res: RouteResponse = {
    writeHead(status, headers) {
      recorded.status = status
      recorded.headers = headers
    },
    end(body) {
      recorded.body = body === undefined ? undefined : JSON.parse(body)
    },
  }
  return { res, recorded }
}

const deps: PanelRouteDeps = {
  listModels: async () => ({
    choices: [
      { provider: 'magpie', model: 'auto/step-5-preview', label: 'Step 5 Preview · routing group' },
      { provider: 'magpie', model: 'auto/deepseek-v4.1-flash', label: 'DeepSeek-V4.1-Flash' },
    ],
    fallback: { provider: 'magpie', model: 'auto/step-5-preview' },
  }),
  recent: () => ({
    people: [{ openId: 'ou_a', chatId: 'oc_1', at: 100, count: 2 }],
    chats: [{ chatId: 'oc_1', at: 100 }],
  }),
  directory: {
    state: () => ({ authorized: false }),
    begin: async () => ({
      authorized: false,
      pending: {
        userCode: 'CODE',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X',
        verificationUriComplete: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X&user_code=CODE',
        expiresAt: 1,
      },
    }),
    poll: async () => ({ authorized: true, userName: '张三' }),
    forget: async () => {},
    search: async () => ({ people: [{ openId: 'ou_wang', name: '张三' }] }),
  },
  names: {
    users: async (ids) => ({
      names: Object.fromEntries(
        ids.filter((id) => id === 'ou_wang').map((id) => [id, '张三']),
      ),
    }),
    chats: async (ids) => (ids.includes('oc_sql') ? { oc_sql: '研发群' } : {}),
    chatSearch: async (query) =>
      query === 'SQL' ? { chats: [{ chatId: 'oc_sql', name: '研发群' }] } : { chats: [] },
  },
}

const get = (url: string): RouteRequest => ({ method: 'GET', url })

describe('handlePanelRequest', () => {
  it('answers the model dropdown', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(MODELS_PATH), res, deps)
    expect(recorded.status).toBe(200)
    expect(recorded.body).toEqual({
      ok: true,
      choices: [
        { provider: 'magpie', model: 'auto/step-5-preview', label: 'Step 5 Preview · routing group' },
        { provider: 'magpie', model: 'auto/deepseek-v4.1-flash', label: 'DeepSeek-V4.1-Flash' },
      ],
      fallback: { provider: 'magpie', model: 'auto/step-5-preview' },
    })
    expect(recorded.headers?.['Content-Type']).toContain('application/json')
    expect(recorded.headers?.['Cache-Control']).toBe('no-store')
  })

  it('reports an empty catalog with its reason', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(
      get(MODELS_PATH),
      res,
      { listModels: async () => ({ choices: [], error: '没有可选的模型' }) },
    )
    expect(recorded.body).toEqual({ ok: true, choices: [], error: '没有可选的模型' })
  })

  it('never throws when the catalog read explodes', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(
      get(MODELS_PATH),
      res,
      {
        listModels: async () => {
          throw new Error('boom')
        },
      },
    )
    expect(recorded.status).toBe(200)
    expect(recorded.body).toEqual({ ok: false, choices: [], error: 'Error: boom' })
  })

  it('answers the recent-contacts shortcut row', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(RECENT_PATH), res, deps)
    expect(recorded.status).toBe(200)
    expect(recorded.body).toEqual({
      ok: true,
      people: [{ openId: 'ou_a', chatId: 'oc_1', at: 100, count: 2 }],
      chats: [{ chatId: 'oc_1', at: 100 }],
    })
  })

  it('reports an unreadable recent list without failing the request', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(
      get(RECENT_PATH),
      res,
      {
        ...deps,
        recent: () => {
          throw new Error('boom')
        },
      },
    )
    expect(recorded.status).toBe(200)
    expect(recorded.body).toEqual({ ok: false, people: [], chats: [], error: 'Error: boom' })
  })

  it('drives the authorisation flow', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(`${AUTH_PATH}?action=begin`), res, deps)
    expect(recorded.body.ok).toBe(true)
    expect((recorded.body as { pending: { userCode: string } }).pending.userCode).toBe('CODE')

    const polled = recorder()
    await handlePanelRequest(get(`${AUTH_PATH}?action=poll`), polled.res, deps)
    expect(polled.recorded.body).toEqual({ ok: true, authorized: true, userName: '张三' })

    const state = recorder()
    await handlePanelRequest(get(AUTH_PATH), state.res, deps)
    expect(state.recorded.body).toEqual({ ok: true, authorized: false })
  })

  it('forgets the delegation', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(`${AUTH_PATH}?action=forget`), res, deps)
    expect(recorded.body).toEqual({ ok: true, authorized: false })
  })

  it('searches people with the delegated token', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(`${SEARCH_PATH}?q=%E7%8E%8B`), res, deps)
    expect(recorded.body).toEqual({
      ok: true,
      people: [{ openId: 'ou_wang', name: '张三' }],
    })
  })

  it('reports a search error without failing the request', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(
      get(SEARCH_PATH),
      res,
      { ...deps, directory: { ...deps.directory, search: async () => ({ people: [], error: '还没授权' }) } },
    )
    expect(recorded.body).toEqual({ ok: true, people: [], error: '还没授权' })
  })

  it('resolves people AND groups to names for the chips', async () => {
    // Ids are split by prefix: people resolve through the delegated token,
    // groups through the bot's own identity. The panel shows names only.
    const { res, recorded } = recorder()
    await handlePanelRequest(get(`${NAMES_PATH}?ids=ou_wang,ou_unknown,oc_sql`), res, deps)
    expect(recorded.body).toEqual({
      ok: true,
      users: { ou_wang: '张三' },
      chats: { oc_sql: '研发群' },
    })
  })

  it('reports a user-name failure without failing the request', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(NAMES_PATH), res, {
      ...deps,
      names: {
        users: async () => ({ names: {}, error: '还没授权' }),
        chats: async () => ({}),
      },
    })
    expect(recorded.body).toEqual({ ok: true, users: {}, chats: {}, error: '还没授权' })
  })

  it('searches groups by name on the bot identity', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(`${CHAT_SEARCH_PATH}?q=SQL`), res, deps)
    expect(recorded.body).toEqual({ ok: true, chats: [{ chatId: 'oc_sql', name: '研发群' }] })
  })

  it('reports a group search failure without failing the request', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get(CHAT_SEARCH_PATH), res, {
      ...deps,
      names: { ...deps.names, chatSearch: async () => ({ chats: [], error: '还没配置 App ID' }) },
    })
    expect(recorded.body).toEqual({ ok: true, chats: [], error: '还没配置 App ID' })
  })

  it('rejects non-GET', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest({ method: 'POST', url: MODELS_PATH }, res, deps)
    expect(recorded.status).toBe(405)
  })

  it('404s an unknown path', async () => {
    const { res, recorded } = recorder()
    await handlePanelRequest(get('/api/feishu-card/nope'), res, deps)
    expect(recorded.status).toBe(404)
  })
})

describe('registerPanelRoutes', () => {
  /** A ctx whose inject() resolves `webServer` immediately, like cordis does. */
  function ctxWith(server: unknown) {
    const effects: (() => void)[] = []
    const registered: { path: string }[] = []
    const disposed: string[] = []
    const child = {
      webServer: server as never,
      effect: (body: () => void | (() => void)) => {
        const off = body()
        if (off) effects.push(off)
      },
    }
    const ctx = {
      inject: (_names: string[], callback: (child: typeof child) => void) => callback(child),
    } as never
    if (server) {
      ;(server as { register(route: { path: string }): () => void }).register = (route) => {
        registered.push(route)
        return () => disposed.push(route.path)
      }
    }
    return { ctx, effects, registered, disposed }
  }

  it('mounts the routes and disposes them on unload', () => {
    const { ctx, effects, registered, disposed } = ctxWith({})
    registerPanelRoutes(ctx, deps)
    expect(registered.map((r) => r.path)).toEqual([
      MODELS_PATH,
      RECENT_PATH,
      AUTH_PATH,
      SEARCH_PATH,
      NAMES_PATH,
      CHAT_SEARCH_PATH,
    ])
    for (const off of effects) off()
    expect(disposed).toEqual([
      MODELS_PATH,
      RECENT_PATH,
      AUTH_PATH,
      SEARCH_PATH,
      NAMES_PATH,
      CHAT_SEARCH_PATH,
    ])
  })

  it('waits for the webserver instead of reading it too early', () => {
    // Our plugin activates before the `webserver` row; ctx.get would see
    // undefined here, which is why registration goes through ctx.inject.
    let injected = false
    const ctx = {
      inject: (_names: string[], callback: (child: unknown) => void) => {
        injected = true
        callback({
          webServer: { register: () => () => {} },
          effect: (body: () => void | (() => void)) => body(),
        })
      },
      get: () => undefined,
    } as never
    registerPanelRoutes(ctx, deps)
    expect(injected).toBe(true)
  })

  it('stays silent when the profile has no webserver', () => {
    const messages: string[] = []
    const { ctx } = ctxWith(undefined)
    registerPanelRoutes(ctx, deps, (message) => messages.push(message))
    expect(messages).toEqual(['feishu-card: webServer service absent — 面板的模型下拉框/快捷选取不可用'])
  })

  it('survives a duplicate-route throw', () => {
    const messages: string[] = []
    const ctx = {
      inject: (_names: string[], callback: (child: unknown) => void) =>
        callback({
          webServer: {
            register: () => {
              throw new Error('duplicate exact route')
            },
          },
          effect: (body: () => void | (() => void)) => body(),
        }),
    } as never
    registerPanelRoutes(ctx, deps, (message) => messages.push(message))
    expect(messages[0]).toContain('route registration failed')
  })
})
