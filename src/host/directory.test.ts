import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DirectorySearch, type DirectoryOptions } from './directory.ts'
import { NameBook } from './names.ts'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'feishu-dir-'))
  file = path.join(dir, 'user-token.json')
})
afterEach(async () => {
  // The name cache writes through a debounced tmp-file rename; on Windows a
  // rename landing during cleanup leaves the directory non-empty.
  await rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

const NOW = 1_700_000_000_000

/** A fetch that routes by URL and records the bearer token it saw. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; token?: string }[] = []
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, token: init?.headers?.Authorization })
    const key = Object.keys(routes).find((fragment) => url.includes(fragment))
    const body = key === undefined ? { code: 0, data: {} } : routes[key]
    return { status: 200, json: async () => body, text: async () => JSON.stringify(body) } as never
  }
  return { fetch: fetchImpl as unknown as typeof fetch, calls }
}

const options = (over: Partial<DirectoryOptions> = {}): DirectoryOptions => ({
  read: () => ({ appId: 'cli_a', appSecret: 's', brand: 'feishu' }),
  file,
  now: () => NOW,
  ...over,
})

describe('DirectorySearch authorisation', () => {
  it('begins an authorisation and exposes the code to the panel', async () => {
    const { fetch } = fakeFetch({
      device_authorization: {
        device_code: 'dc',
        user_code: '4QBR-WG9M',
        verification_uri: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X',
        verification_uri_complete: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X&user_code=4QBR-WG9M',
        expires_in: 600,
        interval: 5,
      },
    })
    const search = new DirectorySearch(options({ fetch }))
    const state = await search.begin()
    expect(state.authorized).toBe(false)
    expect(state.pending).toEqual({
      userCode: '4QBR-WG9M',
      verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X',
      verificationUriComplete: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X&user_code=4QBR-WG9M',
      expiresAt: NOW + 600_000,
    })
  })

  it('refuses to begin without credentials', async () => {
    const search = new DirectorySearch(
      options({ read: () => ({ appId: '', appSecret: '', brand: 'feishu' }) }),
    )
    expect(await search.begin()).toEqual({
      authorized: false,
      error: '请先填写并保存 App ID 和 App Secret。',
    })
  })

  it('reports a refusal from Feishu as an error, not a code', async () => {
    const { fetch } = fakeFetch({
      device_authorization: { error: 'invalid_client', error_description: 'bad secret' },
    })
    const search = new DirectorySearch(options({ fetch }))
    const state = await search.begin()
    expect(state.pending).toBeUndefined()
    expect(state.error).toContain('bad secret')
  })

  it('stays pending until the person confirms, then becomes authorised', async () => {
    let answer: unknown = { error: 'authorization_pending', code: 20094 }
    const { fetch } = fakeFetch({
      device_authorization: {
        device_code: 'dc',
        user_code: 'CODE',
        verification_uri: 'u',
        verification_uri_complete: 'uc',
        expires_in: 600,
        interval: 5,
      },
      oauth_token: () => answer,
    })
    // The fake returns the object, not a function — swap in a mutable route.
    const search = new DirectorySearch(
      options({
        fetch: (async (url: string, init?: { headers?: Record<string, string> }) => {
          const body = url.includes('device_authorization')
            ? {
                device_code: 'dc',
                user_code: 'CODE',
                verification_uri: 'u',
                verification_uri_complete: 'uc',
                expires_in: 600,
                interval: 5,
              }
            : answer
          return { status: 200, json: async () => body, text: async () => JSON.stringify(body) } as never
        }) as unknown as typeof fetch,
      }),
    )
    await search.begin()
    expect((await search.poll()).authorized).toBe(false)
    answer = { access_token: 'u-abc', refresh_token: 'ur-def', expires_in: 7200 }
    const state = await search.poll()
    expect(state.authorized).toBe(true)
    expect(state.pending).toBeUndefined()
    // The token is persisted for the next session.
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.accessToken).toBe('u-abc')
    expect(saved.expiresAt).toBe(NOW + 7_200_000)
  })

  it('drops a pending request that expired', async () => {
    let clock = NOW
    const search = new DirectorySearch(
      options({
        now: () => clock,
        fetch: (async (url: string) => {
          const body = url.includes('device_authorization')
            ? {
                device_code: 'dc',
                user_code: 'CODE',
                verification_uri: 'u',
                verification_uri_complete: 'uc',
                expires_in: 60,
                interval: 5,
              }
            : { error: 'authorization_pending', code: 20094 }
          return { status: 200, json: async () => body, text: async () => JSON.stringify(body) } as never
        }) as unknown as typeof fetch,
      }),
    )
    await search.begin()
    clock = NOW + 61_000
    const state = await search.poll()
    expect(state.pending).toBeUndefined()
    expect(state.authorized).toBe(false)
  })

  it('loads a stored token and reports the authorised person', async () => {
    await writeFile(
      file,
      JSON.stringify({ accessToken: 'u-old', expiresAt: NOW + 3_600_000, userName: '张三' }),
      'utf8',
    )
    const search = new DirectorySearch(options())
    await search.load()
    expect(search.state()).toEqual({ authorized: true, userName: '张三' })
  })

  it('forgets the delegation and removes the file', async () => {
    await writeFile(file, JSON.stringify({ accessToken: 'u-old', expiresAt: NOW + 1000 }), 'utf8')
    const search = new DirectorySearch(options())
    await search.load()
    expect(search.state().authorized).toBe(true)
    await search.forget()
    expect(search.state().authorized).toBe(false)
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it('starts unauthenticated for a corrupt token file', async () => {
    await writeFile(file, 'not json', 'utf8')
    const search = new DirectorySearch(options())
    await search.load()
    expect(search.state().authorized).toBe(false)
  })
})

describe('DirectorySearch.search', () => {
  const seed = async () => {
    await writeFile(file, JSON.stringify({ accessToken: 'u-live', expiresAt: NOW + 3_600_000 }), 'utf8')
  }

  it('returns this app’s open_ids for the people it finds', async () => {
    await seed()
    const { fetch, calls } = fakeFetch({
      'search/v1/user': {
        code: 0,
        data: {
          users: [
            { open_id: 'ou_wang', name: '张三', department_ids: ['od-1'] },
            { open_id: 'ou_li', name: '' },
            { name: 'no id' },
          ],
        },
      },
    })
    const search = new DirectorySearch(options({ fetch }))
    const found = await search.search('张三')
    expect(found.people).toEqual([
      { openId: 'ou_wang', name: '张三', departmentIds: ['od-1'] },
      { openId: 'ou_li', name: 'ou_li' },
    ])
    // The delegated token rides the request, not the tenant token.
    expect(calls[0].url).toContain('/open-apis/search/v1/user')
    expect(calls[0].token).toBe('Bearer u-live')
  })

  it('asks for an authorisation when none is held', async () => {
    const search = new DirectorySearch(options({ fetch: fakeFetch({}).fetch }))
    const found = await search.search('张三')
    expect(found.people).toEqual([])
    expect(found.error).toContain('还没有授权')
  })

  it('returns nothing for an empty query', async () => {
    const search = new DirectorySearch(options({ fetch: fakeFetch({}).fetch }))
    expect(await search.search('  ')).toEqual({ people: [] })
  })

  it('surfaces a scope refusal', async () => {
    await seed()
    const { fetch } = fakeFetch({
      'search/v1/user': { code: 99991679, msg: 'Unauthorized. required one of these privileges' },
    })
    const search = new DirectorySearch(options({ fetch }))
    const found = await search.search('张三')
    expect(found.error).toContain('搜索失败')
    expect(found.error).toContain('99991679')
  })

  it('refreshes an expiring token before searching', async () => {
    // Expires in 30 s — inside the one-minute refresh window.
    await writeFile(
      file,
      JSON.stringify({ accessToken: 'u-stale', refreshToken: 'ur-old', expiresAt: NOW + 30_000 }),
      'utf8',
    )
    const { fetch, calls } = fakeFetch({
      'oauth/token': { access_token: 'u-fresh', refresh_token: 'ur-new', expires_in: 7200 },
      'search/v1/user': { code: 0, data: { users: [{ open_id: 'ou_x', name: 'X' }] } },
    })
    const search = new DirectorySearch(options({ fetch }))
    const found = await search.search('X')
    expect(found.people).toEqual([{ openId: 'ou_x', name: 'X' }])
    expect(calls[0].url).toContain('oauth/token')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.accessToken).toBe('u-fresh')
    expect(saved.refreshToken).toBe('ur-new')
  })

  it('says the authorisation is dead when the refresh fails', async () => {
    // It used to keep using the expired access token, so the person saw an
    // opaque API error on every search and had to guess that 断开 → 重连 was the
    // fix (live report 2026-11-10).
    await writeFile(
      file,
      JSON.stringify({ accessToken: 'u-stale', refreshToken: 'ur-dead', expiresAt: NOW - 1000 }),
      'utf8',
    )
    const { fetch, calls } = fakeFetch({
      'oauth/token': { error: 'invalid_grant', error_description: 'dead' },
      'search/v1/user': { code: 0, data: { users: [{ open_id: 'ou_x', name: 'X' }] } },
    })
    const search = new DirectorySearch(options({ fetch }))
    const found = await search.search('X')
    expect(found.people).toEqual([])
    expect(found.error).toContain('已过期')
    // The dead token must not be spent on a doomed API call.
    expect(calls.some((call) => call.url.includes('search/v1/user'))).toBe(false)
    expect(search.state()).toMatchObject({ authorized: false, needAuth: true })
  })

  it('reports needAuth on a stored token that expired without a refresh token', async () => {
    await writeFile(file, JSON.stringify({ accessToken: 'u-stale', expiresAt: NOW - 1000 }), 'utf8')
    const search = new DirectorySearch(options({ fetch: fakeFetch({}).fetch }))
    await search.load()
    expect(search.state()).toMatchObject({ authorized: false, needAuth: true })
  })

  it('remembers the names search already returned', async () => {
    // `contact/v3/users/{id}` answers 41050 for anybody outside the APP's scope,
    // even with the user's own token (live 2026-11-10: 张雅娜 was searchable but
    // resolved to 未知用户). The search response is the only free source of the
    // name, so it must be kept.
    await writeFile(
      file,
      JSON.stringify({ accessToken: 'u-live', expiresAt: NOW + 3_600_000 }),
      'utf8',
    )
    const book = new NameBook({ file: path.join(dir, 'names.json'), flushDelayMs: 0 })
    const { fetch } = fakeFetch({
      'search/v1/user': {
        code: 0,
        data: { users: [{ open_id: 'ou_zhang', name: '张雅娜' }] },
      },
      'contact/v3/users': { code: 41050, msg: 'no user authority error' },
    })
    const search = new DirectorySearch(options({ fetch, names: book }))
    const found = await search.search('zhangyana')
    expect(found.people.map((person) => person.name)).toEqual(['张雅娜'])
    expect(book.user('ou_zhang')).toBe('张雅娜')
    // And the reverse lookup now answers from the cache, without the 41050.
    await expect(search.names(['ou_zhang'])).resolves.toEqual({ names: { ou_zhang: '张雅娜' } })
    await book.flush()
  })
})
