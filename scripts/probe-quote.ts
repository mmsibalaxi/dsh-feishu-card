/**
 * Probe `im.v1.message.get` — the call behind a quoted reply.
 *
 * Verifies the two things that silently make quoting useless:
 *   - the message is readable at all (the bot must be in that chat), and
 *   - `with_sender_name: true` really returns `sender.sender_name`, which is what
 *     lets `> 引用 张三：「…」` print a name without any contact-directory scope.
 *
 *   npx vite-node scripts/probe-quote.ts <message_id>
 *
 * Take a message id from any Feishu message link, or from a card this plugin
 * posted (the transport logs it).
 */
import { larkClient } from './env.mjs'
import { parseQuotedMessage } from '../src/host/quote.ts'

const messageId = process.argv[2]
if (!messageId) {
  console.error('usage: npx vite-node scripts/probe-quote.ts <message_id>')
  process.exit(2)
}

const client = larkClient()
const response = await client.im.v1.message.get({
  path: { message_id: messageId },
  params: { with_sender_name: true },
})
const item = response?.data?.items?.[0]
console.log('code      :', response?.code, response?.msg ?? '')
console.log('msg_type  :', item?.msg_type)
console.log('sender    :', JSON.stringify(item?.sender))
console.log('raw body  :', String(item?.body?.content).slice(0, 300))
const quoted = parseQuotedMessage(response)
console.log('parsed    :', JSON.stringify(quoted))
process.exit(quoted ? 0 : 1)