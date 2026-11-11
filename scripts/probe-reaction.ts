/**
 * Probe the receipt reaction against the real API — the whole lifecycle.
 *
 * Three things can be wrong and all of them are silent in production:
 *   - the app may lack `im:message.reactions:write_only`,
 *   - `emoji_type` must be one of Feishu's own camel-case keys (`OnIt`, `DONE`, …),
 *   - the delete path needs the `reaction_id` that `create` returns, and Feishu
 *     only lets you delete your OWN reaction.
 *
 *   PROBE_CHAT=oc_xxx npx vite-node scripts/probe-reaction.ts <message_id>
 *   PROBE_CHAT=oc_xxx npx vite-node scripts/probe-reaction.ts <message_id> --keep
 *
 * Without an explicit message id it reacts to the newest message in the chat —
 * which needs `im:message.group_msg:readonly`, a scope this app does NOT hold, so
 * in practice pass the id (a card this plugin posted logs one).
 */
import { larkClient, probeChat } from './env.mjs'
import { ACK_EMOJI, DONE_EMOJI, FeishuReactor } from '../src/host/reaction.ts'

const chatId = probeChat()
const keep = process.argv.includes('--keep')
const messageId = process.argv[2] ?? (await newestMessageId())
const client = larkClient()

async function newestMessageId(): Promise<string> {
  const listed = await client.im.v1.message.list({
    params: {
      container_id_type: 'chat',
      container_id: chatId,
      page_size: 1,
      sort_type: 'ByCreateTimeDesc',
    },
  })
  const id = listed?.data?.items?.[0]?.message_id
  if (!id) throw new Error(`chat ${chatId} has no messages to react to`)
  return id
}

console.log('target message :', messageId)
console.log('flow           :', keep ? `ack only (${ACK_EMOJI})` : `${ACK_EMOJI} → ${DONE_EMOJI}`)

const reactor = new FeishuReactor({
  appId: process.env.FEISHU_APP_ID!,
  appSecret: process.env.FEISHU_APP_SECRET!,
  brand: process.env.FEISHU_BRAND === 'lark' ? 'lark' : 'feishu',
  logger: { warn: (message) => console.log('warn:', message) },
})

const acked = await reactor.ack(messageId)
console.log('ack    :', acked ? 'ok' : 'FAILED', '→', reactor.placedEmoji(messageId))
if (keep) process.exit(acked ? 0 : 1)

const settled = await reactor.settle(messageId, DONE_EMOJI)
console.log('settle :', settled ? 'ok' : 'FAILED', '→', reactor.placedEmoji(messageId))
if (!settled) process.exit(1)

// Prove it from Feishu's side, not from our bookkeeping: list what the message
// carries now. Needs `im:message.reactions:read`, which this app holds.
const listed = await client.im.v1.messageReaction.list({
  path: { message_id: messageId },
  params: { page_size: 20 },
})
const remaining = (listed?.data?.items ?? []).map(
  (item) => item?.reaction_type?.emoji_type ?? 'unknown',
)
console.log('remaining     :', JSON.stringify(remaining))

console.log('look at that message: it should now carry ✅ only (the 🫡 is gone).')