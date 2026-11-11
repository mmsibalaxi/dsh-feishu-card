import { describe, expect, it } from 'vitest'
import { toRawMessage } from './gateway.ts'

/**
 * Field-mapping tests against realistic Feishu payloads. The SDK's types only
 * guarantee the field NAMES exist; these tests pin down the mapping rules,
 * including the thread rule the user's own Hermes bridge learned in production.
 */
const sender = { sender_id: { open_id: 'ou_human' }, sender_type: 'user' }

const message = (over: Record<string, unknown> = {}) => ({
  message_id: 'om_1',
  chat_id: 'oc_g1',
  chat_type: 'group',
  message_type: 'text',
  content: JSON.stringify({ text: '帮我看看构建' }),
  ...over,
})

const event = (over: Record<string, unknown> = {}) => ({
  event_id: 'ev_1',
  sender,
  message: message(over),
})

describe('toRawMessage', () => {
  it('maps a plain group text message', () => {
    const raw = toRawMessage(event())
    expect(raw).toMatchObject({
      messageId: 'om_1',
      eventId: 'ev_1',
      chatId: 'oc_g1',
      chatType: 'group',
      senderOpenId: 'ou_human',
      text: '帮我看看构建',
    })
  })

  it('maps p2p messages', () => {
    const raw = toRawMessage(event({ chat_type: 'p2p', chat_id: 'oc_dm' }))
    expect(raw?.chatType).toBe('p2p')
  })

  it('uses the top-level event_id for dedup, message_id as fallback', () => {
    expect(toRawMessage(event())?.eventId).toBe('ev_1')
    expect(toRawMessage({ sender, message: message() })?.eventId).toBe('om_1')
  })

  it('maps mentions with key / open_id / name', () => {
    const raw = toRawMessage(
      event({
        text: '',
        content: JSON.stringify({ text: '@_user_1 跑一下测试' }),
        mentions: [{ key: '_user_1', id: { open_id: 'ou_bot' }, name: 'DSH' }],
      }),
    )
    expect(raw?.mentions).toEqual([{ key: '_user_1', openId: 'ou_bot', name: 'DSH' }])
  })

  it('a native thread_id becomes the thread key', () => {
    const raw = toRawMessage(event({ thread_id: 'th_1' }))
    expect(raw?.threadId).toBe('th_1')
  })

  it('carries the quoted message ids (parent_id / root_id)', () => {
    // The quote text lives in that message; without these ids the agent reads
    // "这条你再看下" with nothing to look at.
    const raw = toRawMessage(event({ parent_id: 'om_parent', root_id: 'om_root' }))
    expect(raw?.parentId).toBe('om_parent')
    expect(raw?.rootId).toBe('om_root')
  })

  it('root_id NEVER becomes the thread key (hermes #19711/#20548)', () => {
    // root_id is present on every quoted reply; treating it as a thread would
    // split ordinary quote-replies into their own sessions and push the answer
    // into a fresh thread.
    const raw = toRawMessage(event({ root_id: 'om_root', parent_id: 'om_parent' }))
    expect(raw?.threadId).toBeUndefined()
  })

  it('a native thread_id wins even when root_id is also present', () => {
    const raw = toRawMessage(event({ thread_id: 'th_1', root_id: 'om_root' }))
    expect(raw?.threadId).toBe('th_1')
  })

  it('returns undefined without a sender open_id', () => {
    expect(toRawMessage({ event_id: 'ev_1', sender: { sender_type: 'user' }, message: message() })).toBeUndefined()
  })

  it('returns undefined without a chat_id', () => {
    expect(toRawMessage(event({ chat_id: '' }))).toBeUndefined()
  })

  it('returns undefined when content is not JSON', () => {
    expect(toRawMessage(event({ content: 'not json' }))).toBeUndefined()
  })

  it('tolerates an empty content payload', () => {
    const raw = toRawMessage(event({ content: '{}' }))
    expect(raw?.text).toBe('')
  })

  it('carries sender_type through for the bot gate', () => {
    expect(toRawMessage(event())?.senderType).toBe('user')
    expect(
      toRawMessage({ event_id: 'ev_1', sender: { sender_type: 'app', sender_id: { open_id: 'ou_app' } }, message: message() })
        ?.senderType,
    ).toBe('app')
  })
})
