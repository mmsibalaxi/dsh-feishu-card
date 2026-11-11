/**
 * What the model is told about the Feishu conversation.
 *
 * The gap this closes: the agent used to receive the message text and nothing
 * else — no chat id, no sender, no quote. Every assertion here maps to a fact the
 * user's Hermes bridge injects (2026-11-09 comparison).
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_QUOTE_CHARS,
  channelPrompt,
  composeTurnText,
  flattenQuote,
  personLabel,
} from './channel.ts'

describe('channelPrompt', () => {
  it('names the chat id and the chat type', () => {
    const prompt = channelPrompt({ chatId: 'oc_0000000000000000000000000000000a', chatType: 'group' })
    expect(prompt).toContain('会话类型：群聊')
    expect(prompt).toContain('oc_0000000000000000000000000000000a')
  })

  it('says "p2p" for a direct chat and drops the group-only @ rule', () => {
    const prompt = channelPrompt({ chatId: 'oc_dm', chatType: 'p2p' })
    expect(prompt).toContain('会话类型：单聊')
    expect(prompt).not.toContain('群里只有明确')
  })

  it('mentions the bot identity when it is known', () => {
    const prompt = channelPrompt({
      chatId: 'oc_g1',
      chatType: 'group',
      botName: 'SomeBot',
      botOpenId: 'ou_bot',
    })
    expect(prompt).toContain('SomeBot')
    expect(prompt).toContain('ou_bot')
  })

  it('explains the header conventions so they are not read as user text', () => {
    const prompt = channelPrompt({ chatId: 'oc_g1', chatType: 'group' })
    expect(prompt).toContain('[发送人')
    expect(prompt).toContain('引用')
    // The section goes through renderPrompt, which expands {{variables}}.
    expect(prompt).not.toContain('{{')
  })
})

describe('personLabel', () => {
  it('prefers name + id, and degrades to whichever exists', () => {
    expect(personLabel('张三', 'ou_a')).toBe('张三 (ou_a)')
    expect(personLabel('张三', undefined)).toBe('张三')
    expect(personLabel(undefined, 'ou_a')).toBe('ou_a')
    expect(personLabel(undefined, undefined)).toBe('未知')
  })
})

describe('composeTurnText', () => {
  it('leaves a plain p2p message untouched when no name is known', () => {
    expect(composeTurnText('在吗', { chatType: 'p2p', senderOpenId: 'ou_a' })).toBe('在吗')
  })

  it('prefixes the sender in a group even when the name is unknown', () => {
    const text = composeTurnText('在吗', { chatType: 'group', senderOpenId: 'ou_a' })
    expect(text).toBe('[发送人 ou_a]\n\n在吗')
  })

  it('uses the resolved name when there is one', () => {
    const text = composeTurnText('在吗', { chatType: 'p2p', senderOpenId: 'ou_a', senderName: '张三' })
    expect(text).toBe('[发送人 张三 (ou_a)]\n\n在吗')
  })

  it('lists the other people who were @-ed', () => {
    const text = composeTurnText('你看下', {
      chatType: 'group',
      senderOpenId: 'ou_a',
      senderName: '张三',
      others: [{ key: '_u', openId: 'ou_b', name: '李四' }],
    })
    expect(text).toContain('[同时提到 李四 (ou_b)]')
  })

  it('quotes the replied-to message above the question', () => {
    const text = composeTurnText('这个怎么弄', {
      chatType: 'group',
      senderOpenId: 'ou_a',
      senderName: '张三',
      quote: { senderOpenId: 'ou_b', senderName: '李四', text: '构建又挂了' },
    })
    expect(text).toBe('[发送人 张三 (ou_a)]\n> 引用 李四 (ou_b)：「构建又挂了」\n\n这个怎么弄')
  })

  it('skips an empty quote rather than printing empty brackets', () => {
    const text = composeTurnText('在吗', {
      chatType: 'group',
      senderOpenId: 'ou_a',
      quote: { text: '   ' },
    })
    expect(text).toBe('[发送人 ou_a]\n\n在吗')
  })
})

describe('flattenQuote', () => {
  it('collapses newlines into one line', () => {
    expect(flattenQuote('第一行\n\n第二行')).toBe('第一行 第二行')
  })

  it('clamps a giant quote and says so', () => {
    const flat = flattenQuote('字'.repeat(MAX_QUOTE_CHARS + 50))
    expect(flat.length).toBeLessThan(MAX_QUOTE_CHARS + 20)
    expect(flat).toContain('已截断')
  })
})