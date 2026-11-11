// Send a text message as the bot into a chat, to drive the bridge end-to-end.
import { larkClient, probeChat } from './env.mjs'

const CHAT = process.argv[2] ?? probeChat()
const TEXT = process.argv[3] ?? 'bridge 自检：请用一句话回答「收到」'

const client = larkClient()

async function main() {
  const sent = await client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: CHAT,
      msg_type: 'text',
      content: JSON.stringify({ text: TEXT }),
    },
  })
  console.log('sent message_id =', sent?.data?.message_id, 'code =', sent?.code)
}

main().catch((error) => {
  console.error('send failed:', String(error))
  process.exit(1)
})
