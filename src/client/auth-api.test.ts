import { describe, expect, it } from 'vitest'
import {
  AUTH_PATH,
  SEARCH_PATH,
  authUrl,
  chatSearchUrl,
  namesUrl,
  parseAuth,
  parseFound,
  parseFoundChats,
  parseNames,
  searchUrl,
} from './auth-api.ts'

describe('urls', () => {
  it('addresses the auth actions', () => {
    expect(AUTH_PATH).toBe('/api/feishu-card/auth')
    expect(authUrl('begin')).toBe('/api/feishu-card/auth?action=begin')
    expect(authUrl('state')).toBe('/api/feishu-card/auth?action=state')
  })

  it('encodes the search query', () => {
    expect(SEARCH_PATH).toBe('/api/feishu-card/search')
    expect(searchUrl('王 丽')).toBe('/api/feishu-card/search?q=%E7%8E%8B%20%E4%B8%BD')
  })

  it('joins the ids for the names request', () => {
    expect(namesUrl(['ou_a', 'oc_1'])).toBe('/api/feishu-card/names?ids=ou_a,oc_1')
  })

  it('encodes the group search query', () => {
    expect(chatSearchUrl('蜂窝')).toBe('/api/feishu-card/chat-search?q=%E8%9C%82%E7%AA%9D')
  })
})

describe('parseNames', () => {
  it('merges the people and group buckets into one id → name map', () => {
    // The Host answers in two buckets (different credentials); ids are disjoint
    // by prefix, so one map is all the panel needs.
    expect(
      parseNames({ ok: true, users: { ou_a: '张三' }, chats: { oc_1: '研发群' } }),
    ).toEqual({ ou_a: '张三', oc_1: '研发群' })
  })

  it('drops empty names so a chip falls back to 未知 instead of a blank', () => {
    expect(parseNames({ users: { ou_a: '', ou_b: '张三' } })).toEqual({ ou_b: '张三' })
  })

  it('still reads the old single-bucket shape', () => {
    expect(parseNames({ names: { ou_a: '张三' } })).toEqual({ ou_a: '张三' })
  })

  it('survives garbage', () => {
    expect(parseNames(null)).toEqual({})
    expect(parseNames('nope')).toEqual({})
    expect(parseNames({ users: 'nope' })).toEqual({})
  })
})

describe('parseAuth', () => {
  it('reads an authorised answer', () => {
    expect(parseAuth({ ok: true, authorized: true, userName: '张三' })).toEqual({
      authorized: true,
      userName: '张三',
    })
  })

  it('reads a pending authorisation', () => {
    const parsed = parseAuth({
      ok: true,
      authorized: false,
      pending: {
        userCode: '4QBR-WG9M',
        verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X',
        verificationUriComplete: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X&user_code=4QBR-WG9M',
        expiresAt: 1000,
      },
    })
    expect(parsed.pending?.userCode).toBe('4QBR-WG9M')
    expect(parsed.pending?.expiresAt).toBe(1000)
  })

  it('falls back to the plain URL when the complete one is missing', () => {
    const parsed = parseAuth({
      pending: { userCode: 'C', verificationUri: 'https://x' },
    })
    expect(parsed.pending?.verificationUriComplete).toBe('https://x')
  })

  it('drops an incomplete pending row instead of rendering a broken one', () => {
    expect(parseAuth({ pending: { userCode: 'C' } }).pending).toBeUndefined()
    expect(parseAuth({ pending: { verificationUri: 'https://x' } }).pending).toBeUndefined()
  })

  it('carries the error', () => {
    expect(parseAuth({ authorized: false, error: '还没授权' }).error).toBe('还没授权')
  })

  it('flags an expired delegation', () => {
    expect(parseAuth({ authorized: false, needAuth: true })).toMatchObject({
      authorized: false,
      needAuth: true,
    })
  })

  it('survives garbage', () => {
    expect(parseAuth(null)).toEqual({ authorized: false })
    expect(parseAuth('nope')).toEqual({ authorized: false })
  })
})

describe('parseFoundChats', () => {
  it('reads the group search answer', () => {
    expect(
      parseFoundChats({ ok: true, chats: [{ chatId: 'oc_sql', name: '研发群' }] }),
    ).toEqual({ chats: [{ chatId: 'oc_sql', name: '研发群' }] })
  })

  it('drops rows without an id and defaults the name', () => {
    expect(parseFoundChats({ chats: [{ chatId: 'oc_a' }, { name: 'no id' }, null] })).toEqual({
      chats: [{ chatId: 'oc_a', name: '未命名群' }],
    })
  })

  it('carries the error', () => {
    expect(parseFoundChats({ chats: [], error: '还没配置' }).error).toBe('还没配置')
  })

  it('survives garbage', () => {
    expect(parseFoundChats(null)).toEqual({ chats: [] })
  })
})

describe('parseFound', () => {
  it('keeps usable rows and defaults the name to the id', () => {
    const parsed = parseFound({
      ok: true,
      people: [
        { openId: 'ou_wang', name: '张三' },
        { openId: 'ou_x' },
        { name: 'no id' },
        null,
      ],
    })
    expect(parsed.people).toEqual([
      { openId: 'ou_wang', name: '张三' },
      { openId: 'ou_x', name: 'ou_x' },
    ])
  })

  it('carries the error', () => {
    expect(parseFound({ people: [], error: '还没授权' }).error).toBe('还没授权')
  })

  it('survives garbage', () => {
    expect(parseFound(null)).toEqual({ people: [] })
    expect(parseFound({ people: 'nope' })).toEqual({ people: [] })
  })
})

