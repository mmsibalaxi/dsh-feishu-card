/**
 * The bot's own open_id.
 *
 * Needed to tell "someone @-ed the bot" from "someone @-ed somebody else": a
 * mention payload carries only an open_id, so the comparison needs ours.
 * `GET /open-apis/bot/v3/info` answers it with no extra scope.
 *
 * Kept separate from the (now removed) contact directory so mention detection
 * never depends on a 通讯录 permission — that lookup is scope-bound, this one
 * is not.
 */
import * as Lark from '@larksuiteoapi/node-sdk'
import type { ResolvedConfig } from './config.ts'

/** The slice of the Lark client this uses (keeps tests fake-free). */
export interface BotInfoReader {
  request(options: {
    method: string
    url: string
  }): Promise<{ code?: number; bot?: { open_id?: string } } | undefined>
}

export interface BotOpenIdOptions {
  /** Live config reader, so a credential edit applies without a restart. */
  read: () => Pick<ResolvedConfig, 'appId' | 'appSecret' | 'brand'>
  /** Client factory; defaults to the Lark SDK. */
  createClient?: (config: {
    appId: string
    appSecret: string
    domain: Lark.Domain
  }) => BotInfoReader
  log?: (message: string) => void
}

/**
 * A cached reader of the bot's own open_id.
 *
 * The client is rebuilt when the app id changes, so a credential edit in the
 * panel is picked up without restarting dsh; the answer itself is cached per
 * app because it never changes.
 */
export function createBotOpenId(options: BotOpenIdOptions): () => Promise<string | undefined> {
  const { read, log } = options
  let cachedFor: string | undefined
  let cached: string | undefined
  let reader: BotInfoReader | undefined

  const readerFor = (): BotInfoReader | undefined => {
    const config = read()
    if (!config.appId || !config.appSecret) return undefined
    if (cachedFor !== config.appId || !reader) {
      const create = options.createClient ?? ((input) => new Lark.Client(input) as unknown as BotInfoReader)
      reader = create({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: config.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
      })
      cachedFor = config.appId
      cached = undefined
    }
    return reader
  }

  return async () => {
    // Resolve the reader FIRST: it rebuilds the client and drops the cached
    // answer when the app id changed, so a credential edit in the panel is
    // picked up instead of being shadowed by the previous app's answer.
    const client = readerFor()
    if (cached) return cached
    if (!client) return undefined
    try {
      const response = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' })
      if (response?.code !== undefined && response.code !== 0) return undefined
      const openId = response?.bot?.open_id
      if (openId) cached = openId
      return openId
    } catch (error) {
      log?.(`feishu-card: bot info failed: ${String(error).slice(0, 160)}`)
      return undefined
    }
  }
}
