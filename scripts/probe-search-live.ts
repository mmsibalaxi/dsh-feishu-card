/**
 * Live end-to-end check of the "search as me" flow, WITHOUT the Feishu long
 * connection (a second WS client would steal the desktop app's events).
 *
 * One process on purpose: the pending authorisation lives in memory, so a
 * separate `begin` and `poll` invocation would each see a fresh instance.
 *
 *   npx vite-node scripts/probe-search-live.ts                 → begin + wait + search 张三
 *   npx vite-node scripts/probe-search-live.ts 张三          → same, searching that name
 *   npx vite-node scripts/probe-search-live.ts --state         → just print what is stored
 */
import path from 'node:path'
import { homedir } from 'node:os'
import { DirectorySearch } from '../src/host/directory.ts'
import { credentials } from './env.mjs'

const { appId: APP_ID, appSecret: APP_SECRET } = credentials()
const FILE = path.join(homedir(), '.dsh', 'feishu-card', 'user-token.json')

const search = new DirectorySearch({
  read: () => ({ appId: APP_ID, appSecret: APP_SECRET, brand: 'feishu' as const }),
  file: FILE,
  log: (message) => console.log('  ·', message),
})

async function main() {
  await search.load()

  const arg = process.argv[2]
  if (arg === '--state') {
    console.log(JSON.stringify(search.state(), null, 2))
    return
  }

  const query = arg ?? '张三'
  const state0 = search.state()
  if (!state0.authorized) {
    console.log('申请授权…')
    const begun = await search.begin()
    if (!begun.pending) {
      console.log('失败：', begun.error ?? '没有拿到授权码')
      return
    }
    console.log('\n════════════════════════════════════════')
    console.log('  验证码：', begun.pending.userCode)
    console.log('  打开：', begun.pending.verificationUriComplete)
    console.log('  （10 分钟内有效，请在飞书里确认）')
    console.log('════════════════════════════════════════\n')
    const deadline = Date.now() + 9 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 6000))
      const state = await search.poll()
      if (state.authorized) {
        console.log('✅ 已授权', state.userName ? `（${state.userName}）` : '')
        break
      }
      if (state.error) {
        console.log('❌ 授权失败：', state.error)
        return
      }
      if (!state.pending) {
        console.log('⌛ 授权码过期，重新跑一次脚本')
        return
      }
      process.stdout.write('.')
    }
    if (!search.state().authorized) {
      console.log('\n⌛ 超时未确认')
      return
    }
  }

  console.log(`\n搜索「${query}」…`)
  const found = await search.search(query)
  console.log(JSON.stringify(found, null, 2))
}

main().catch((error) => console.error('THREW', String(error).slice(0, 300)))
