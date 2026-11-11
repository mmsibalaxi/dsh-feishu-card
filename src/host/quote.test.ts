/**
 * Reading the message a user replied to.
 *
 * Shapes here are copied from live `im.v1.message.get` responses: `data.items[]`
 * with `msg_type`, `body.content` (a JSON string), and `sender.id` /
 * `sender.sender_name` when `with_sender_name` is set.
 */
import { describe, expect, it } from 'vitest'
import { FeishuQuoteFetcher, cardText, parseQuotedMessage } from './quote.ts'

const wrap = (item: Record<string, unknown>) => ({ code: 0, data: { items: [item] } })

describe('parseQuotedMessage', () => {
  it('reads a text message with its sender name', () => {
    const quoted = parseQuotedMessage(
      wrap({
        msg_type: 'text',
        body: { content: JSON.stringify({ text: '构建又挂了' }) },
        sender: { id: 'ou_b', sender_name: '李四' },
      }),
    )
    expect(quoted).toEqual({ senderOpenId: 'ou_b', senderName: '李四', text: '构建又挂了' })
  })

  it('flattens a rich-text post', () => {
    const content = JSON.stringify({
      title: '周报',
      content: [
        [{ tag: 'text', text: '本周完成 3 个需求' }],
        [{ tag: 'a', text: '看板', href: 'https://x.y' }],
      ],
    })
    const quoted = parseQuotedMessage(wrap({ msg_type: 'post', body: { content } }))
    expect(quoted?.text).toContain('周报')
    expect(quoted?.text).toContain('本周完成 3 个需求')
  })

  it('labels non-text messages instead of returning nothing', () => {
    expect(parseQuotedMessage(wrap({ msg_type: 'image', body: { content: '{}' } }))?.text).toBe(
      '[图片]',
    )
    expect(parseQuotedMessage(wrap({ msg_type: 'file', body: { content: '{}' } }))?.text).toBe(
      '[文件]',
    )
  })

  it('pulls text out of a quoted card', () => {
    const content = JSON.stringify({
      schema: '2.0',
      body: {
        elements: [
          { tag: 'markdown', content: '**北京** 今天晴' },
          { tag: 'div', text: { tag: 'plain_text', content: '25℃' } },
        ],
      },
    })
    const quoted = parseQuotedMessage(wrap({ msg_type: 'interactive', body: { content } }))
    expect(quoted?.text).toContain('北京')
    expect(quoted?.text).toContain('25℃')
    // Markdown emphasis is stripped: this is a quote, not a rendered card.
    expect(quoted?.text).not.toContain('**')
  })

  it('says so when the message was recalled', () => {
    expect(parseQuotedMessage(wrap({ deleted: true }))?.text).toContain('撤回')
  })

  it('returns undefined for an empty payload', () => {
    expect(parseQuotedMessage(undefined)).toBeUndefined()
    expect(parseQuotedMessage({ data: { items: [] } })).toBeUndefined()
  })
})

describe('cardText', () => {
  it('returns empty for a non-JSON body instead of throwing', () => {
    expect(cardText('not json')).toBe('')
  })
})

describe('FeishuQuoteFetcher', () => {
  it('fetches through the injected reader', async () => {
    const asked: string[] = []
    const fetcher = new FeishuQuoteFetcher({
      appId: 'cli_test',
      appSecret: 'secret',
      brand: 'feishu',
      get: async (messageId) => {
        asked.push(messageId)
        return wrap({ msg_type: 'text', body: { content: JSON.stringify({ text: '原文' }) } })
      },
    })
    await expect(fetcher.fetch('om_1')).resolves.toMatchObject({ text: '原文' })
    expect(asked).toEqual(['om_1'])
  })

  it('asks for the card JSON when the quoted message is a card', async () => {
    // Live finding: an `interactive` message returns a "请升级客户端" placeholder
    // unless `card_msg_content_type: user_card_content` is passed.
    const calls: { messageId: string; cardContent?: boolean }[] = []
    const fetcher = new FeishuQuoteFetcher({
      appId: 'cli_test',
      appSecret: 'secret',
      brand: 'feishu',
      get: async (messageId, options) => {
        calls.push({ messageId, cardContent: options?.cardContent })
        if (!options?.cardContent) {
          return wrap({
            msg_type: 'interactive',
            body: { content: JSON.stringify({ elements: [[{ tag: 'text', text: '升级客户端' }]] }) },
            sender: { id: 'cli_app', sender_type: 'app', sender_name: 'SomeBot', open_bot_id: 'ou_bot' },
          })
        }
        return wrap({
          msg_type: 'interactive',
          body: {
            content: JSON.stringify({ body: { elements: [{ tag: 'markdown', content: '北京今天晴' }] } }),
          },
          sender: { id: 'cli_app', sender_type: 'app', sender_name: 'SomeBot', open_bot_id: 'ou_bot' },
        })
      },
    })
    const quoted = await fetcher.fetch('om_card')
    expect(quoted?.text).toBe('北京今天晴')
    expect(calls).toEqual([
      { messageId: 'om_card', cardContent: undefined },
      { messageId: 'om_card', cardContent: true },
    ])
  })

  it('labels an app sender by its bot open_id, never by the app id', async () => {
    const quoted = parseQuotedMessage(
      wrap({
        msg_type: 'text',
        body: { content: JSON.stringify({ text: '自动消息' }) },
        sender: { id: 'cli_xxxxxxxxxxxxxxxx', sender_type: 'app', sender_name: 'SomeBot', open_bot_id: 'ou_57a6' },
      }),
    )
    expect(quoted?.senderOpenId).toBe('ou_57a6')
    expect(quoted?.senderName).toBe('SomeBot')
  })

  it('never throws: a failed lookup just yields no quote', async () => {
    const warnings: string[] = []
    const fetcher = new FeishuQuoteFetcher({
      appId: 'cli_test',
      appSecret: 'secret',
      brand: 'feishu',
      logger: { warn: (message) => warnings.push(message) },
      get: async () => {
        throw new Error('code=230002 message not found')
      },
    })
    await expect(fetcher.fetch('om_gone')).resolves.toBeUndefined()
    expect(warnings.join(' ')).toContain('230002')
  })

  it('ignores an empty id without calling the API', async () => {
    let called = 0
    const fetcher = new FeishuQuoteFetcher({
      appId: 'cli_test',
      appSecret: 'secret',
      brand: 'feishu',
      get: async () => {
        called += 1
        return undefined
      },
    })
    await expect(fetcher.fetch('')).resolves.toBeUndefined()
    expect(called).toBe(0)
  })
})