import { describe, expect, it } from 'vitest'
import { RECENT_PATH, agoText, parseRecent } from './recent-api.ts'

describe('RECENT_PATH', () => {
  it('is the same-origin route the Host mounts', () => {
    expect(RECENT_PATH).toBe('/api/feishu-card/recent')
  })
})

describe('parseRecent', () => {
  it('keeps well-formed people and chats', () => {
    const parsed = parseRecent({
      ok: true,
      people: [{ openId: 'ou_a', chatId: 'oc_1', at: 100, count: 3 }],
      chats: [{ chatId: 'oc_1', at: 100 }],
    })
    expect(parsed.people).toEqual([{ openId: 'ou_a', chatId: 'oc_1', at: 100, count: 3 }])
    expect(parsed.chats).toEqual([{ chatId: 'oc_1', at: 100 }])
  })

  it('drops rows missing an id, and defaults the numbers', () => {
    const parsed = parseRecent({
      people: [{ openId: 'ou_a', chatId: 'oc_1' }, { openId: '', chatId: 'oc_1' }, { openId: 'ou_b' }, null],
      chats: [{ chatId: '' }, { chatId: 'oc_2' }, 'nope'],
    })
    expect(parsed.people).toEqual([{ openId: 'ou_a', chatId: 'oc_1', at: 0, count: 1 }])
    expect(parsed.chats).toEqual([{ chatId: 'oc_2', at: 0 }])
  })

  it('survives garbage', () => {
    expect(parseRecent(null)).toEqual({ people: [], chats: [] })
    expect(parseRecent({ people: 'nope', chats: 3 })).toEqual({ people: [], chats: [] })
  })
})

describe('agoText', () => {
  const now = 1_700_000_000_000
  it('says 刚刚 under a minute', () => {
    expect(agoText(now - 10_000, now)).toBe('刚刚')
  })
  it('counts minutes, hours and days', () => {
    expect(agoText(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(agoText(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(agoText(now - 2 * 86_400_000, now)).toBe('2 天前')
  })
  it('handles a missing timestamp', () => {
    expect(agoText(0, now)).toBe('未知时间')
  })
})
