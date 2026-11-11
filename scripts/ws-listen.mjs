/**
 * Standalone Feishu event listener — answers "is Feishu delivering events at
 * all?" Run it, then send a message from Feishu and watch.
 *
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy node scripts/ws-listen.mjs [seconds]
 */
import * as Lark from '@larksuiteoapi/node-sdk'

const APP_ID = process.env.FEISHU_APP_ID
const APP_SECRET = process.env.FEISHU_APP_SECRET
const SECONDS = Number(process.argv[2] ?? 90)

if (!APP_ID || !APP_SECRET) {
  console.error('set FEISHU_APP_ID / FEISHU_APP_SECRET')
  process.exit(2)
}

let count = 0
const ws = new Lark.WSClient({ appId: APP_ID, appSecret: APP_SECRET, domain: Lark.Domain.Feishu })
const dispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    count += 1
    const m = data?.message ?? {}
    const s = data?.sender ?? {}
    console.log('── EVENT', count, '──')
    console.log('  event_id   :', data?.event_id)
    console.log('  message_id :', m.message_id)
    console.log('  chat_id    :', m.chat_id, '| chat_type:', m.chat_type, '| thread_id:', m.thread_id, '| root_id:', m.root_id)
    console.log('  sender     :', s.sender_id?.open_id, '| sender_type:', s.sender_type)
    console.log('  type       :', m.message_type)
    console.log('  content    :', String(m.content).slice(0, 200))
    console.log('  mentions   :', JSON.stringify(m.mentions ?? []))
  },
})

await ws.start({ eventDispatcher: dispatcher })
console.log(`listening for ${SECONDS}s — send a message from Feishu now...`)

setTimeout(() => {
  console.log(`\ndone: ${count} event(s) received`)
  ws.close?.()
  process.exit(0)
}, SECONDS * 1000)
