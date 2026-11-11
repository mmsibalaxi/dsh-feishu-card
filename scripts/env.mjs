/**
 * Credentials for the live probe scripts.
 *
 * Read from the environment, never from this file: these scripts are committed
 * to a public repository, and an App Secret in git is an App Secret leaked.
 *
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy node scripts/e2e-check.mjs
 *   PROBE_CHAT=oc_xxx node scripts/send-as-bot.mjs
 */
import * as Lark from '@larksuiteoapi/node-sdk'

export function credentials() {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    console.error(
      'FEISHU_APP_ID / FEISHU_APP_SECRET 未设置。\n' +
        '先 export 它们（Windows: $env:FEISHU_APP_ID="cli_xxx"），不要把密钥写进代码。',
    )
    process.exit(2)
  }
  return { appId, appSecret }
}

export function larkClient(options = {}) {
  const { appId, appSecret } = credentials()
  const brand = options.brand ?? process.env.FEISHU_BRAND ?? 'feishu'
  return new Lark.Client({
    appId,
    appSecret,
    domain: brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
  })
}

/** Target chat for the sending probes; required, no default id in git. */
export function probeChat() {
  const chat = process.env.PROBE_CHAT
  if (!chat) {
    console.error('PROBE_CHAT 未设置（oc_ 开头的群 id 或私聊 chat id）。')
    process.exit(2)
  }
  return chat
}
