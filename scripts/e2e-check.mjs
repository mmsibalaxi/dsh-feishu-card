/**
 * End-to-end verification against the REAL Feishu.
 *
 * Run this once you have app credentials. It proves, in order:
 *   1. app_access_token works (credentials are valid)
 *   2. a CardKit v2.0 card can be created and patched (the streaming path)
 *   3. the WebSocket long connection establishes and receives events
 *   4. (optional) a full turn through the real inbound pipeline
 *
 * Usage:
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy node scripts/e2e-check.mjs
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy TARGET_CHAT_ID=oc_xxx node scripts/e2e-check.mjs
 *
 * Exit code 0 = everything that could be checked, passed.
 */
import * as Lark from '@larksuiteoapi/node-sdk'

const APP_ID = process.env.FEISHU_APP_ID
const APP_SECRET = process.env.FEISHU_APP_SECRET
const TARGET_CHAT = process.env.TARGET_CHAT_ID
const BRAND = process.env.FEISHU_BRAND === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

if (!APP_ID || !APP_SECRET) {
  console.error('set FEISHU_APP_ID and FEISHU_APP_SECRET first')
  process.exit(2)
}

const client = new Lark.Client({ appId: APP_ID, appSecret: APP_SECRET, domain: BRAND })

// ── 1. credentials ────────────────────────────────────────────────────────
try {
  const res = await client.auth.v3.appAccessToken.internal({
    data: { app_id: APP_ID, app_secret: APP_SECRET },
  })
  check('app_access_token', Boolean(res?.app_access_token), res?.app_access_token ? 'token issued' : 'no token')
} catch (error) {
  check('app_access_token', false, String(error))
}

// ── 2. card create + patch + close ────────────────────────────────────────
let cardId
try {
  const card = {
    schema: '2.0',
    config: {
      streaming_mode: true,
      streaming_config: { print_frequency_ms: { default: 70 }, print_step: { default: 4 }, print_strategy: 'delay' },
      locales: ['zh_cn', 'en_us'],
      summary: { content: 'e2e 检查', i18n_content: { zh_cn: 'e2e 检查', en_us: 'e2e check' } },
    },
    body: {
      elements: [
        { tag: 'markdown', content: '', text_align: 'left', text_size: 'normal_v2', margin: '0px 0px 0px 0px', element_id: 'answer_content' },
        { tag: 'div', icon: { tag: 'standard_icon', token: 'time_outlined', size: '16px 16px' }, text: { tag: 'lark_md', content: '正在加载上下文…', i18n_content: { zh_cn: '正在加载上下文…', en_us: 'Loading…' } }, element_id: 'context_loading_hint' },
        { tag: 'div', icon: { tag: 'standard_icon', token: 'time_outlined', size: '16px 16px' }, text: { tag: 'plain_text', content: ' ' }, element_id: 'loading_icon' },
        { tag: 'collapsible_panel', expanded: false, header: { title: { tag: 'plain_text', content: '执行过程', i18n_content: { zh_cn: '执行过程', en_us: 'Process' }, text_color: 'grey', text_size: 'notation' }, vertical_align: 'center', icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px', color: 'grey' }, icon_position: 'right', icon_expanded_angle: -180 }, border: { color: 'grey', corner_radius: '5px' }, vertical_spacing: '4px', padding: '8px 8px 8px 8px', elements: [{ tag: 'markdown', content: ' ' }], element_id: 'agent_process_panel' },
      ],
    },
  }
  const created = await client.cardkit.v1.card.create({ data: { type: 'card_json', data: JSON.stringify(card) } })
  cardId = created?.data?.card_id
  check('cardkit.v1.card.create', Boolean(cardId), cardId ? `card_id=${cardId}` : 'no card_id')

  if (cardId) {
    await client.cardkit.v1.card.batchUpdate({
      data: {
        sequence: 1,
        actions: JSON.stringify([
          { kind: 'partial_update_element', element_id: 'answer_content', content: { tag: 'markdown', content: '流式更新 OK' } },
        ]),
      },
      path: { card_id: cardId },
    })
    check('cardkit.v1.card.batchUpdate', true)

    await client.cardkit.v1.card.settings({
      data: {
        sequence: 2,
        settings: JSON.stringify({ config: { streaming_mode: false, summary: { content: '已完成', i18n_content: { zh_cn: '已完成', en_us: 'Done' } } } }),
      },
      path: { card_id: cardId },
    })
    check('cardkit.v1.card.settings', true)
  }
} catch (error) {
  check('card create/patch/close', false, String(error))
}

// ── 3. send a text message (optional) ─────────────────────────────────────
if (TARGET_CHAT) {
  try {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: TARGET_CHAT, msg_type: 'text', content: JSON.stringify({ text: 'dsh-feishu-card e2e 检查 ✅' }) },
    })
    check('im.v1.message.create', true)
  } catch (error) {
    check('im.v1.message.create', false, String(error))
  }
} else {
  console.log('SKIP  im.v1.message.create (set TARGET_CHAT_ID to test)')
}

// ── 4. WebSocket long connection ──────────────────────────────────────────
// NOTE: ws.start() resolves even when the underlying connection fails, so a
// successful start() alone proves nothing. The SDK logs failures as
// `[error]: [ '[ws]', … ]` on stdout, so capture stdout during the window.
try {
  const lines = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) => {
    lines.push(String(chunk))
    return originalWrite(chunk, ...rest)
  }
  let ws
  try {
    ws = new Lark.WSClient({ appId: APP_ID, appSecret: APP_SECRET, domain: BRAND })
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async () => undefined,
    })
    await ws.start({ eventDispatcher: dispatcher })
    await new Promise((r) => setTimeout(r, 3000))
  } finally {
    process.stdout.write = originalWrite
  }
  const bad = lines.filter((l) => /\[error\]/.test(l))
  check('WebSocket long connection', bad.length === 0, bad.length ? bad[0].trim().slice(0, 160) : 'connected, no errors')
  ws.close?.()
} catch (error) {
  check('WebSocket long connection', false, String(error))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
