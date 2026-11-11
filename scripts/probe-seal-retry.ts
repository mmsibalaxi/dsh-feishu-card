/**
 * Probe the seal RETRY path against the real API.
 *
 * The bug this covers (live, 2026-11-10): a finished card still showed the
 * "still working" dots and the ◯ 停止 button, because the seal plan threw ONCE
 * and the card marked itself sealed anyway — it could never try again.
 *
 * This probe wraps the real transport so the FIRST batchUpdate of the seal fails
 * with 300317 (the sequence collision Feishu actually answers when a flush is
 * still in flight), then proves the card still ends up sealed.
 *
 *   npx vite-node scripts/probe-seal-retry.ts
 */
import { credentials, probeChat } from './env.mjs'
import { LarkCardTransport } from '../src/host/card/transport.ts'
import { StreamingCard, type CardTransport } from '../src/host/card/streaming.ts'

const { appId, appSecret } = credentials()
const chatId = probeChat()

const real = new LarkCardTransport({
  appId,
  appSecret,
  brand: process.env.FEISHU_BRAND === 'lark' ? 'lark' : 'feishu',
  logger: { warn: (message) => console.log('transport:', message) },
})

/** Delegates everything, but fails N batchUpdates once armed. */
let armed = false
let failures = 1
let sealCalls = 0
const flaky: CardTransport = {
  createCard: (chat, card, replyTo) => real.createCard(chat, card, replyTo),
  updateCard: (id, card, seq) => real.updateCard(id, card, seq),
  settings: (id, settings, seq) => real.settings(id, settings, seq),
  async batchUpdate(id, actions, seq) {
    if (armed) sealCalls += 1
    if (armed && failures > 0) {
      failures -= 1
      throw Object.assign(new Error('injected 300317 for the seal retry probe'), { code: 300317 })
    }
    return real.batchUpdate(id, actions, seq)
  },
}

const card = new StreamingCard({
  transport: flaky,
  chatId,
  footerFields: ['status', 'model', 'elapsed'],
  flushIntervalMs: 0,
  sessionKey: 'probe-seal-retry',
  panelModel: () => 'deepseek-v4.1-flash',
  footerSource: () => ({ status: '', model: 'deepseek-v4.1-flash', elapsed: '2.1s' }),
  // Keep the probe quick but still exercise a real retry cycle.
  sealRetryDelaysMs: [0, 300],
  log: (message) => console.log('card:', message),
})

await card.start()
card.pushAnswer('封卡重试自检：第一次封卡会被注入一个 300317。')
await card.flush()
armed = true
// The retry backoff uses unref'd timers (a shutting-down host must not be held
// open by a card). In a standalone script that means the loop can drain between
// attempts, so keep it alive explicitly.
const keepAlive = setInterval(() => undefined, 500)
try {
  const report = await card.seal({ status: '已完成' })
  console.log('seal ok after injected failure:', JSON.stringify(report), '| seal batch calls:', sealCalls)
  console.log(failures === 0 ? 'injected failure happened and was retried ✓' : 'FAILED: injection never fired')
} catch (error) {
  console.error('seal FAILED even with retries:', String(error).slice(0, 300))
  process.exitCode = 1
} finally {
  clearInterval(keepAlive)
}