// Probe the exact createCard() sequence the bridge uses, against the real API.
// The e2e check verified card.create/batchUpdate/settings but NOT the
// `im.v1.message.create` step that binds the card entity to a chat — that step
// is the one the live bridge depends on.
import { larkClient, probeChat } from './env.mjs'

const CHAT = probeChat()
const client = larkClient()

const card = {
  schema: '2.0',
  config: {
    streaming_mode: true,
    streaming_config: {
      print_frequency_ms: { default: 70 },
      print_step: { default: 4 },
      print_strategy: 'delay',
    },
    locales: ['zh_cn', 'en_us'],
    summary: { content: '探测', i18n_content: { zh_cn: '探测', en_us: 'probe' } },
  },
  body: {
    elements: [
      { tag: 'markdown', element_id: 'answer_content', content: '' },
      {
        tag: 'div',
        element_id: 'context_loading_hint',
        icon: { tag: 'standard_icon', token: 'time_outlined', size: '16px 16px' },
        text: { tag: 'plain_text', content: ' ' },
      },
    ],
  },
}

async function main() {
  const payload = JSON.stringify(card)
  const created = await client.cardkit.v1.card.create({
    data: { type: 'card_json', data: payload },
  })
  const cardId = created?.data?.card_id
  console.log('card.create  code=%s card_id=%s', created?.code, cardId)
  if (!cardId) return

  // ── the step the bridge actually performs (once per card) ──
  try {
    const sent = await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: CHAT,
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
      },
    })
    console.log(
      'message.create code=%s msg=%s message_id=%s',
      sent?.code,
      sent?.msg,
      sent?.data?.message_id,
    )
  } catch (error) {
    console.log('message.create THREW: %s', String(error).slice(0, 400))
  }

  // Then prove the card is updatable through the entity id.
  try {
    const patched = await client.cardkit.v1.card.batchUpdate({
      data: {
        sequence: 1,
        actions: JSON.stringify([
          {
            action: 'partial_update_element',
            params: {
              element_id: 'answer_content',
              // INNER fields only — a full element object here is accepted
              // (code=0) and then silently ignored.
              partial_element: { content: '卡片实体可更新 ✅' },
            },
          },
        ]),
      },
      path: { card_id: cardId },
    })
    console.log('batchUpdate(code=%s) on the entity id', patched?.code)
  } catch (error) {
    console.log('batchUpdate THREW: %s', String(error).slice(0, 300))
  }
}

main().catch((error) => {
  console.error('probe failed:', String(error))
  process.exit(1)
})
