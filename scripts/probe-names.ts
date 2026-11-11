/**
 * Probe display-name resolution for the ids this plugin stores.
 *
 * Answers the two questions a user actually asks:
 *   - 「为什么面板还显示 ou_…」 → is the delegated token alive, and can it read
 *     names right now?
 *   - 「群名怎么来」 → the bot's own `im/v1/chats/{id}` (no user token needed).
 *
 *   npx vite-node scripts/probe-names.ts ou_xxx ou_yyy oc_aaa
 *   (no args = the ids in ~/.dsh/profiles/desktop/cordis.patch.yml)
 */
import { credentials } from './env.mjs'
import { DirectorySearch } from '../src/host/directory.ts'
import { ChatNames, NameBook } from '../src/host/names.ts'
import { homedir } from 'node:os'
import path from 'node:path'

const { appId, appSecret } = credentials()
const brand = process.env.FEISHU_BRAND === 'lark' ? 'lark' : 'feishu'
const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')

const args = process.argv.slice(2)
const ids = args.length
  ? args
  : ['ou_0000000000000000000000000000000a', 'ou_0000000000000000000000000000000b',
     'oc_0000000000000000000000000000000a', 'oc_0000000000000000000000000000000b']

const book = new NameBook({ file: path.join(home, 'feishu-card', 'names.json'), log: console.log })
await book.load()
console.log('name cache      :', JSON.stringify(book.snapshot()).slice(0, 400))

const directory = new DirectorySearch({
  read: () => ({ appId, appSecret, brand }),
  file: path.join(home, 'feishu-card', 'user-token.json'),
  names: book,
  log: (message) => console.log('directory:', message),
})
await directory.load()
console.log('auth state      :', JSON.stringify(directory.state()))

const userIds = ids.filter((id) => id.startsWith('ou_'))
const chatIds = ids.filter((id) => id.startsWith('oc_'))

if (userIds.length) {
  const users = await directory.names(userIds)
  console.log('user names      :', JSON.stringify(users.names), users.error ? `(error: ${users.error})` : '')
}
if (chatIds.length) {
  const chatResolver = new ChatNames({
    read: () => ({ appId, appSecret, brand }),
    remember: (names) => book.rememberChats(names),
    log: (message) => console.log('chat:', message),
  })
  const chats = await chatResolver.resolve(chatIds)
  console.log('chat names      :', JSON.stringify(chats))
  // Group picker: empty query = the bot's own chat list, keyword = search.
  console.log('chat list       :', JSON.stringify((await chatResolver.search('')).chats))
  console.log('chat search SQL :', JSON.stringify((await chatResolver.search('SQL')).chats))
}
await book.flush()
console.log('cache file      :', path.join(home, 'feishu-card', 'names.json'))