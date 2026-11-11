/**
 * Outbound text sender (M1b). M2 replaces the reply path with CardKit cards;
 * this stays as the fallback for errors and non-streaming mode.
 */
import * as Lark from '@larksuiteoapi/node-sdk'

export interface SenderOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
  logger?: { warn: (message: string) => void }
}

export class FeishuSender {
  private readonly client: Lark.Client

  constructor(private readonly options: SenderOptions) {
    this.client = new Lark.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    })
  }

  /**
   * Send a plain text message into a chat. Long text is chunked by Feishu's limit.
   *
   * With `replyToMessageId` the message is posted as a reply, so Feishu renders
   * the "回复 XXX" quote header — which is how the user can tell which message
   * an answer belongs to.
   */
  async sendText(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    const content = text.trim() || '（无内容）'
    const chunks = chunkText(content, 3000)
    for (const chunk of chunks) {
      const payload = {
        msg_type: 'text',
        content: JSON.stringify({ text: chunk }),
      }
      try {
        if (replyToMessageId) {
          await this.client.im.v1.message.reply({
            path: { message_id: replyToMessageId },
            data: payload,
          })
        } else {
          await this.client.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: chatId, ...payload },
          })
        }
      } catch (error) {
        this.options.logger?.warn(`feishu-card: send failed for ${chatId}: ${error}`)
        throw error
      }
    }
  }
}

/** Feishu rejects very long text messages; split on line boundaries. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let current = ''
  for (const source of text.split('\n')) {
    let line = source
    while (line.length > limit) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(line.slice(0, limit))
      line = line.slice(limit)
    }
    if ((current + '\n' + line).length > limit) {
      if (current) chunks.push(current)
      current = line
    } else {
      current = current ? `${current}\n${line}` : line
    }
  }
  if (current) chunks.push(current)
  return chunks
}
