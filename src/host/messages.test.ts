import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Dedup,
  extractPostText,
  normalizeInbound,
  sessionKeyFor,
  stripMentions,
  type RawFeishuMessage,
} from './messages.ts'

const raw = (over: Partial<RawFeishuMessage> = {}): RawFeishuMessage => ({
  messageId: 'om_1',
  eventId: 'ev_1',
  chatId: 'oc_g1',
  chatType: 'group',
  senderOpenId: 'ou_a',
  text: '帮我看看构建为什么失败',
  ...over,
})

describe('stripMentions', () => {
  it('removes placeholders and collapses whitespace', () => {
    expect(stripMentions('@_user_1 帮我  看看\n构建', [{ key: '_user_1' }])).toBe('帮我 看看 构建')
  })

  it('leaves plain text untouched', () => {
    expect(stripMentions('  普通消息  ')).toBe('普通消息')
  })
})

describe('normalizeInbound', () => {
  it('detects a bot mention and strips it', () => {
    const message = normalizeInbound(
      raw({ text: '@_user_1 跑一下测试', mentions: [{ key: '_user_1', openId: 'ou_bot' }] }),
    )
    expect(message.mentioned).toBe(true)
    expect(message.mentionAllOnly).toBe(false)
    expect(message.text).toBe('跑一下测试')
  })

  it('treats @all as mention-all, not a bot mention', () => {
    const message = normalizeInbound(raw({ text: '@_all 大家看看', mentions: [{ key: '_all' }] }))
    expect(message.mentioned).toBe(false)
    expect(message.mentionAllOnly).toBe(true)
    expect(message.text).toBe('大家看看')
  })

  it('no mentions at all', () => {
    const message = normalizeInbound(raw({ chatType: 'p2p' }))
    expect(message.mentioned).toBe(false)
    expect(message.mentionAllOnly).toBe(false)
  })

  it('@ 别人不算提及机器人（群里的高频误触发）', () => {
    // Regression: `mentions` lists every @ in the message, so "any mention"
    // woke the agent whenever colleagues @ each other in a group.
    const message = normalizeInbound(
      raw({ text: '@_user_1 你看下这个', mentions: [{ key: '_user_1', openId: 'ou_colleague' }] }),
      'ou_bot',
    )
    expect(message.mentioned).toBe(false)
    expect(message.mentionAllOnly).toBe(false)
  })

  it('@ 机器人本身才算提及', () => {
    const message = normalizeInbound(
      raw({
        text: '@_user_1 @_user_2 帮忙跑下测试',
        mentions: [
          { key: '_user_1', openId: 'ou_colleague' },
          { key: '_user_2', openId: 'ou_bot' },
        ],
      }),
      'ou_bot',
    )
    expect(message.mentioned).toBe(true)
    expect(message.text).toBe('帮忙跑下测试')
  })

  it('拿不到机器人 open_id 时退回"有人被 @ 就算"', () => {
    // Better to answer an extra time than to go silent because one lookup
    // failed; the trace line tells the operator why.
    const message = normalizeInbound(
      raw({ text: '@_user_1 你看下', mentions: [{ key: '_user_1', openId: 'ou_colleague' }] }),
    )
    expect(message.mentioned).toBe(true)
  })

  it('carries the other @-ed people, the bot excluded', () => {
    // These names used to be stripped and thrown away, so "问一下 @李四" reached
    // the model as "问一下" (comparison against Hermes, 2026-11-09).
    const message = normalizeInbound(
      raw({
        text: '@_user_1 @_user_2 @_all 一起看下',
        mentions: [
          { key: '_user_1', openId: 'ou_bot' },
          { key: '_user_2', openId: 'ou_b', name: '李四' },
          { key: '_all', name: '所有人' },
        ],
      }),
      'ou_bot',
    )
    expect(message.othersMentioned).toEqual([{ key: '_user_2', openId: 'ou_b', name: '李四' }])
  })

  it('carries the quoted message ids through', () => {
    const message = normalizeInbound(raw({ parentId: 'om_parent', rootId: 'om_root' }))
    expect(message.parentId).toBe('om_parent')
    expect(message.rootId).toBe('om_root')
  })
})

describe('sessionKeyFor', () => {
  const message = normalizeInbound(raw({ threadId: 'th_1' }))

  it('chat scope → one session per chat', () => {
    expect(sessionKeyFor(message, 'chat')).toBe('oc_g1')
  })

  it('thread scope → one session per topic', () => {
    expect(sessionKeyFor(message, 'thread')).toBe('oc_g1#th_1')
  })

  it('sender scope → one session per person in the chat', () => {
    expect(sessionKeyFor(message, 'sender')).toBe('oc_g1#ou_a')
  })

  it('thread scope without a thread falls back to the chat', () => {
    const flat = normalizeInbound(raw())
    expect(sessionKeyFor(flat, 'thread')).toBe('oc_g1')
  })
})

describe('Dedup', () => {
  it('accepts the first delivery and rejects the replay', () => {
    const dedup = new Dedup(60_000)
    expect(dedup.check('ev_1')).toBe(true)
    expect(dedup.check('ev_1')).toBe(false)
    expect(dedup.check('ev_2')).toBe(true)
  })

  it('treats an id seen inside the TTL as a replay', () => {
    let now = 0
    const dedup = new Dedup(1000, () => now)
    expect(dedup.check('ev_1')).toBe(true)
    now = 999
    expect(dedup.check('ev_1')).toBe(false)
  })

  it('expires entries past the TTL', () => {
    let now = 0
    const dedup = new Dedup(1000, () => now)
    expect(dedup.check('ev_1')).toBe(true)
    now = 1500
    expect(dedup.check('ev_1')).toBe(true)
  })

  it('sweeps once the map grows large', () => {
    let now = 0
    const dedup = new Dedup(10, () => now)
    for (let i = 0; i < 1100; i++) {
      now = i
      dedup.check(`ev_${i}`)
    }
    expect(dedup.size).toBeLessThan(1100)
    expect(dedup.check('ev_0')).toBe(true)
  })

  it('persists the window across a restart', async () => {
    // Without this, every event Feishu re-sent while dsh was down runs the
    // agent again on boot — the window was only ever as long as the uptime.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-dedup-'))
    const file = join(dir, 'seen.json')
    try {
      const first = new Dedup(60_000, Date.now, file)
      await first.load()
      expect(first.check('ev_1')).toBe(true)
      await first.flush()

      const second = new Dedup(60_000, Date.now, file)
      await second.load()
      expect(second.check('ev_1')).toBe(false)
      expect(second.check('ev_2')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('extractPostText', () => {
  it('flattens a rich-text post, keeping links and mentions', () => {
    const content = JSON.stringify({
      title: '周报',
      content: [
        [
          { tag: 'text', text: '本周完成 ' },
          { tag: 'a', text: '报表', href: 'https://x/y' },
          { tag: 'at', user_name: '张三' },
        ],
        [{ tag: 'text', text: '下周继续' }],
      ],
    })
    expect(extractPostText(content)).toBe('周报\n本周完成 报表(https://x/y)@张三\n下周继续')
  })

  it('handles the locale-wrapped payload', () => {
    const content = JSON.stringify({
      zh_cn: { title: '', content: [[{ tag: 'text', text: '你好' }]] },
    })
    expect(extractPostText(content)).toBe('你好')
  })

  it('returns empty for junk so the caller can treat it as unsupported', () => {
    expect(extractPostText('not json')).toBe('')
    expect(extractPostText('{}')).toBe('')
  })
})
