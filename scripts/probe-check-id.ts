/**
 * Is a saved open_id real, and whose is it?
 *
 * Two independent checks:
 *  1. **tenant token** — `GET /contact/v3/users/{id}`. This app's 通讯录 scope is
 *     one person, so a stranger comes back `41050 no authority`; that still
 *     proves the id is *well-formed* but says nothing about who it is.
 *  2. **user token** (if a delegation is stored) — resolves any id the person
 *     can see, which is the real answer.
 *
 *   npx vite-node scripts/probe-check-id.ts ou_0000000000000000000000000000000a
 */
import path from 'node:path'
import { homedir } from 'node:os'
import * as Lark from '@larksuiteoapi/node-sdk'
import { DirectorySearch } from '../src/host/directory.ts'
import { credentials } from './env.mjs'

const { appId: APP_ID, appSecret: APP_SECRET } = credentials()
const ids = process.argv.slice(2)

async function viaTenant(id: string) {
  const client = new Lark.Client({ appId: APP_ID, appSecret: APP_SECRET, domain: Lark.Domain.Feishu })
  try {
    const res = await client.request({
      method: 'GET',
      url: `/open-apis/contact/v3/users/${encodeURIComponent(id)}`,
      params: { user_id_type: 'open_id' },
    })
    const name = res?.data?.user?.name
    return `tenant: code=${res?.code} ${name ? `name=${name}` : '(no name)'}`
  } catch (error) {
    const body = (error as any)?.response?.data
    return `tenant: code=${body?.code} msg=${String(body?.msg ?? error).slice(0, 120)}`
  }
}

async function main() {
  if (ids.length === 0) {
    console.log('用法：probe-check-id.ts <open_id> [open_id...]')
    return
  }
  const search = new DirectorySearch({
    read: () => ({ appId: APP_ID, appSecret: APP_SECRET, brand: 'feishu' as const }),
    file: path.join(homedir(), '.dsh', 'feishu-card', 'user-token.json'),
  })
  await search.load()
  const authorized = search.state().authorized
  console.log('delegated token:', authorized ? '已授权' : '未授权（只有 tenant 检查）')
  const names = authorized ? (await search.names(ids)).names : {}

  for (const id of ids) {
    const format = /^ou_[A-Za-z0-9_-]{8,48}$/.test(id) ? '格式 OK' : '格式可疑'
    const tenant = await viaTenant(id)
    const user = names[id] ? `user: name=${names[id]}` : authorized ? 'user: 查不到这个名字' : 'user: 未授权'
    console.log(`\n${id}\n  ${format}\n  ${tenant}\n  ${user}`)
  }
}

main().catch((error) => console.error('THREW', String(error).slice(0, 300)))
