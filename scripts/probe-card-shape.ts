/**
 * Probe the CURRENT card shape against the real API: create → flush → seal.
 *
 * Why this exists: Feishu validates a card's schema at `card.create` and every
 * `batchUpdate` action at call time, and an unknown key fails the WHOLE batch
 * (silently, for some shapes). The unit tests prove our JSON is what we intend;
 * only the live API proves Feishu accepts it. Run this after any layout change
 * (button type, column widths, element order, seal inserts).
 *
 *   PROBE_CHAT=oc_xxx node scripts/run-vite-node.mjs scripts/probe-card-shape.ts
 *   (or: npx vite-node scripts/probe-card-shape.ts)
 *
 * It posts ONE card into PROBE_CHAT, then seals it with the answer "卡片形状自检".
 */
import { credentials, probeChat } from './env.mjs'
import { LarkCardTransport } from '../src/host/card/transport.ts'
import { StreamingCard } from '../src/host/card/streaming.ts'

const { appId, appSecret } = credentials()
const chatId = probeChat()

const transport = new LarkCardTransport({
  appId,
  appSecret,
  brand: process.env.FEISHU_BRAND === 'lark' ? 'lark' : 'feishu',
  logger: { warn: (message) => console.log('warn:', message), info: (m) => console.log('info:', m) },
  // Printed so a follow-up probe (scripts/probe-reaction.ts <message_id>) can
  // target THIS card's message without the im:message.group_msg scope.
  onCardMessage: ({ cardId, messageId }) => console.log('message id =', messageId, '(card', cardId + ')'),
})

const card = new StreamingCard({
  transport,
  chatId,
  footerFields: ['status', 'model', 'elapsed', 'context'],
  flushIntervalMs: 0,
  sessionKey: 'probe-shape',
  panelModel: () => 'deepseek-v4.1-flash',
  panelRounds: () => 1,
  footerSource: () => ({
    status: '',
    model: 'deepseek-v4.1-flash',
    context: '12.3K/1.0M (1%)',
    elapsed: '3.4s',
  }),
  log: (message) => console.log('card:', message),
})

try {
  await card.start()
  console.log('1) create            ok, card id =', card.id)
} catch (error) {
  console.error('1) create FAILED:', String(error).slice(0, 500))
  process.exit(1)
}

try {
  // `--long` pushes an answer past the single-card budget, so the continuation
  // path (分段+续卡) runs for real: you should see TWO "message id =" lines.
  const long = process.argv.includes('--long')
  const body = long
    ? `${'这是一段用来撑爆单卡预算的长文本。'.repeat(700)}\n\n（结尾标记 END）`
    : '卡片形状自检：底部停止按钮在右下角、红色空心圈；状态行由 seal 补上。'
  card.pushAnswer(body)
  await card.flush()
  console.log('2) flush (answer)    ok', long ? `(long: ${body.length} chars)` : '')
} catch (error) {
  console.error('2) flush FAILED:', String(error).slice(0, 500))
  process.exit(1)
}

try {
  // `--status 已停止` seals with the red warning state, so the footer's
  // `<font color='red'>` path gets exercised on a real client.
  const statusIndex = process.argv.indexOf('--status')
  const status = statusIndex > 0 ? (process.argv[statusIndex + 1] ?? '已完成') : '已完成'
  const report = await card.seal({ status })
  console.log('3) seal              ok:', JSON.stringify(report), 'status:', status)
} catch (error) {
  console.error('3) seal FAILED:', String(error).slice(0, 500))
  process.exit(1)
}

console.log('shape probe passed — the card in', chatId, 'should now show: answer, panel, no footer mid-run, and a footer after seal.')