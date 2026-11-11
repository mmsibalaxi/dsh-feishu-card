/**
 * Runtime wiring: everything that only exists once appId/appSecret are known.
 *
 * Inbound pipeline (order matters — cheapest gate first):
 *   normalize → dedup → session key → access decision → agent turn → reply
 *
 * A denied message is logged at debug level and never answered, so an
 * unauthorized user cannot even tell the bot is alive.
 */
import { homedir } from 'node:os'
import path from 'node:path'
import * as Lark from '@larksuiteoapi/node-sdk'
import type { Context } from '@deepseek-ai/cordis'
import { decideAccess, describeDeny } from './access.ts'
import { FeishuBridge } from './bridge.ts'
import type { TurnEnd } from './bridge.ts'
import { FeishuGateway, type GatewayOptions } from './gateway.ts'
import { Dedup, normalizeInbound, sessionKeyFor, type NormalizedMessage, type RawFeishuAttachment, type RawFeishuMessage, type RawMention } from './messages.ts'
import { FeishuSender, type SenderOptions } from './sender.ts'
import { ACK_EMOJI, DONE_EMOJI, FeishuReactor, type ReactionOptions } from './reaction.ts'
import { FeishuQuoteFetcher, type QuoteOptions } from './quote.ts'
import { composeTurnText, type MessageEnvelope } from './channel.ts'
import { SessionStore } from './sessions.ts'
import {
  formatHelp,
  formatModel,
  formatReset,
  formatStatus,
  formatStop,
  parseInput,
  type BridgeCommand,
} from './commands.ts'
import { StreamingCard } from './card/streaming.ts'
import { buildFooterInput } from './card/footer.ts'
import { LarkCardTransport, type LarkCardTransportOptions } from './card/transport.ts'
import { FeishuAskUser, type AskTransport } from './ask.ts'
import { resolveContextWindow } from './contextwin.ts'
import { readUsage } from './usage.ts'
import { trace } from './trace.ts'
import { FeishuMedia } from './media.ts'
import { createImageResolver } from './card/images.ts'
import { createBotOpenId, type BotInfoReader } from './bot.ts'
import { RecentContacts, type SeenSender } from './recent.ts'
import type { ResolvedConfig } from './config.ts'

export interface FeishuCardRuntime {
  start(): Promise<void>
  stop(): Promise<void>
  /** Drive one raw Feishu message through the whole pipeline. */
  inbound(raw: RawFeishuMessage): Promise<void>
  /** People the bot has already seen, newest first (panel shortcut row). */
  recent(): SeenSender[]
  /** Chats the bot has already seen, newest first (panel shortcut row). */
  recentChats(): { chatId: string; at: number }[]
  status(): {
    connected: boolean
    sessions: number
    allowlist: number
    groupAllowlist: number
  }
}

/** Injection points for tests (and future non-Lark transports). */
export interface RuntimeDeps {
  createGateway?: (options: GatewayOptions) => FeishuGateway
  createSender?: (options: SenderOptions) => FeishuSender
  createCardTransport?: (options: LarkCardTransportOptions) => LarkCardTransport
  createReactor?: (options: ReactionOptions) => FeishuReactor
  /** Quoted-message reader; injected in tests. */
  createQuote?: (options: QuoteOptions) => FeishuQuoteFetcher
  /**
   * Bot-info reader, so "was I mentioned?" needs no live call in tests.
   *
   * Resolving the bot's own open_id is what keeps `@李四` from waking this bot
   * in a group; without an injected reader every group message pays one HTTP
   * round trip (cached per app, but a test has no app).
   */
  createBotReader?: (config: { appId: string; appSecret: string; domain: Lark.Domain }) => BotInfoReader
  /**
   * Reverse name lookup for the `[发送人 姓名 (open_id)]` header.
   *
   * The panel's `DirectorySearch` is passed in: it runs on the delegated user
   * token (the tenant token can only see one person) and caches per id, so an
   * unauthorized profile simply yields no name instead of a broken header.
   */
  directory?: {
    names(ids: readonly string[]): Promise<{ names: Record<string, string>; error?: string }>
  }
  /**
   * Disk-backed id → name cache.
   *
   * Used by the message header so `[发送人 张三]` keeps working after the
   * delegated token expires: the last known name is better than a bare open_id.
   */
  names?: { user(id: string): string | undefined; rememberUsers(names: Record<string, string>): void }
  /** Shared with the panel's shortcut route when supplied. */
  recent?: RecentContacts
}

/**
 * Whether a finished turn still needs its answer posted as a plain text message.
 *
 * A streamed card carries the answer, so normally not. Two exceptions:
 *   - the card never delivered the answer (creation or write failed) → the user
 *     must get it somewhere, so send it;
 *   - the turn was STOPPED and its card exists → the card already says 已停止 and
 *     the answer is usually empty, so "（本轮无输出）" underneath it is pure noise
 *     (user feedback 2026-11-10).
 *
 * @param result - what the bridge reported for the turn
 * @returns true when the runtime should post `result.text`
 */
export function shouldSendTextFallback(result: {
  carded: boolean
  cardCreated: boolean
  reason: TurnEnd
}): boolean {
  if (result.carded) return false
  return !(result.reason === 'stopped' && result.cardCreated)
}

/**
 * Whether a stop attempt must be refused because it is not the requester's turn.
 *
 * Both entry points (the card's ◯ 停止 and `/stop`) go through this, so the
 * button cannot be bypassed by typing the command. `undefined` = allowed.
 *
 * An UNKNOWN clicker is allowed on purpose: a payload-shape change must not
 * brick the button, and this is a courtesy guard, not an authorisation boundary
 * (the sender already passed the allowlist to start the turn).
 *
 * @param owner - who opened the running turn (undefined = nothing running)
 * @param clicker - who pressed stop (undefined = payload did not say)
 * @returns the refusal text, or undefined when the stop may proceed
 */
export function stopDenied(owner: string | undefined, clicker: string | undefined): string | undefined {
  if (!owner || !clicker || owner === clicker) return undefined
  return '只有发起这条消息的人可以停止本轮回复'
}

/** Chinese label for an attachment kind, used in the synthetic turn text. */
function labelOf(kind: 'image' | 'file' | 'audio' | 'media'): string {
  switch (kind) {
    case 'image':
      return '图片'
    case 'audio':
      return '语音'
    case 'media':
      return '视频'
    case 'file':
      return '文件'
  }
}

/**
 * @param ctx dsh context
 * @param read live config reader (volatile refs are re-read per message)
 * @param initial snapshot taken at startup, used for one-shot credentials
 * @param deps optional transport injection points (tests)
 */
export function createRuntime(
  ctx: Context,
  read: () => ResolvedConfig,
  initial: ResolvedConfig,
  deps: RuntimeDeps = {},
): FeishuCardRuntime {
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const store = new SessionStore(path.join(home, 'feishu-card', 'sessions.json'))
  // The redelivery window is persisted next to the session map so a restart
  // does not replay every event Feishu re-sent while dsh was down.
  const dedup = new Dedup(initial.dedupTtlMs, Date.now, path.join(home, 'feishu-card', 'seen.json'))
  // Our own open_id, so a mention can be told apart from someone else's.
  const botOpenId = createBotOpenId({
    read,
    ...(deps.createBotReader === undefined ? {} : { createClient: deps.createBotReader }),
    log: (message) => ctx.logger.debug(message),
  })
  // Who has talked to us. The only people source that needs no Feishu
  // permission, and the ids are already this app's. Supplied by the entry point
  // so the panel's route and the inbound pipeline share one instance.
  const recent =
    deps.recent ??
    new RecentContacts({
      file: path.join(home, 'feishu-card', 'recent.json'),
      log: (message) => ctx.logger.debug(message),
    })
  // Attachments land here so the agent can open them like any other file.
  const media = new FeishuMedia({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    dir: path.join(home, 'feishu-card', 'media'),
    logger: { warn: (message) => ctx.logger.warn(message), debug: (m) => ctx.logger.debug(m) },
  })
  const resolveImages = createImageResolver({
    upload: (bytes, name) => media.uploadImage(bytes, name),
    log: (message) => ctx.logger.debug(message),
  })
  /**
   * Live cards, indexed both ways.
   *
   * `im.message.recalled_v1` reports the *message* id, while every CardKit call
   * needs the *card* id, so the transport's create call hands us the pair and
   * this table turns one into the other. Message protection needs exactly this
   * hop: a recalled card must stop being written to.
   */
  const cardsById = new Map<string, StreamingCard>()
  const cardIdByMessage = new Map<string, string>()
  const sender = (deps.createSender ?? ((options: SenderOptions) => new FeishuSender(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: ctx.logger,
  })
  /**
   * Receipt reaction on the user's own message.
   *
   * Created here (not per turn) so the "already reacted" memory survives across
   * turns, and injected in tests so no network call happens.
   */
  const reactor = (deps.createReactor ?? ((options: ReactionOptions) => new FeishuReactor(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: { warn: (message) => ctx.logger.warn(message) },
  })
  /**
   * Quoted-message reader.
   *
   * A quote-reply carries only `parent_id`; the text lives in the message it
   * points at. Without this the agent sees "这条你再看下" and nothing else.
   */
  const quote = (deps.createQuote ?? ((options: QuoteOptions) => new FeishuQuoteFetcher(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: { warn: (message) => ctx.logger.warn(message) },
  })
  const cardTransport = (deps.createCardTransport ??
    ((options: LarkCardTransportOptions) => new LarkCardTransport(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: { warn: (message) => ctx.logger.warn(message) },
    onCardMessage: ({ cardId, messageId }) => {
      cardIdByMessage.set(messageId, cardId)
      // Bound memory: only the newest few hundred cards can still be alive.
      if (cardIdByMessage.size > 500) {
        const oldest = cardIdByMessage.keys().next()
        if (!oldest.done) cardIdByMessage.delete(oldest.value)
      }
    },
  })
  // Feishu-side ask_user_question: without it an agent's question blocks on the
  // desktop GUI's dialog, which the Feishu user can neither see nor answer.
  // Sequence is per card id and must start at 1 (CardKit rejects 0).
  const askSequences = new Map<string, number>()
  const askTransport: AskTransport = {
    sendCard: (chatId, card) => cardTransport.createCard(chatId, card),
    updateCard: (cardId, card) => {
      const sequence = (askSequences.get(cardId) ?? 0) + 1
      askSequences.set(cardId, sequence)
      return cardTransport.updateCard(cardId, card, sequence)
    },
  }
  const ask = new FeishuAskUser({
    transport: askTransport,
    log: (message) => ctx.logger.debug(message),
  })
  /**
   * Own a new session in the workspace registry.
   *
   * `agents.create()` leaves the session unowned: it lands in the right
   * directory but no workspace lists it, so the GUI shows it under an untitled
   * group ("未命名") and refuses to open its history. The app's own creation
   * path attaches right after creating; this mirrors that. Best-effort — a
   * profile without the registry simply keeps the old behaviour.
   */
  const attachWorkspace = async (sessionId: string, cwd: string): Promise<void> => {
    const registry = ctx.get('workspaceRegistry') as
      | {
          resolveByPath(path: string): Promise<{ attachSession(id: string): Promise<void> } | undefined>
        }
      | undefined
    if (!registry) return
    const workspace = await registry.resolveByPath(cwd)
    if (!workspace) {
      ctx.logger.debug(`feishu-card: no workspace registered for ${cwd}; session stays ungrouped`)
      return
    }
    await workspace.attachSession(sessionId)
    trace('workspace-attached', { sessionId, cwd })
  }
  const bridge = new FeishuBridge(ctx, {
    store,
    // Read live: switching workspace in the panel applies to new sessions.
    defaultWorkspace: () => read().defaultWorkspace,
    // Explicit model route for created agents; absent = the host's default.
    // Without a selection the prompt assembly has no {{model}} variable and
    // every turn fails with "prompt variable \"{{model}}\" has no value".
    // Read per session so a panel edit or /model applies to the next session.
    model: () => {
      const config = read()
      return config.provider && config.model
        ? { provider: config.provider, model: config.model }
        : undefined
    },
    ask,
    attachWorkspace,
    turnTimeoutMs: read().turnTimeoutMs,
    /**
     * One card per turn, or undefined for a plain-text reply.
     *
     * The `replyMode` check lives INSIDE this function, not around it: closing
     * over it once meant switching between 流式卡片 and 纯文本 in the panel only
     * took effect after restarting dsh, the one thing every other setting
     * manages without.
     *
     * `state` is this turn's own object, so two chats streaming at once never
     * read each other's round count or tool list.
     */
    createCard: (chatId, agent, state, replyToMessageId) => {
      if (read().replyMode !== 'streaming') return undefined
      const config = read()
      // `card` is assigned before start() runs (the bridge starts it), so the
      // onCardId callback can safely close over it.
      const card: StreamingCard = new StreamingCard({
        transport: cardTransport,
        chatId,
        footerFields: config.footerFields,
        flushIntervalMs: config.flushIntervalMs,
        showReasoning: config.showReasoning,
        panelExpanded: config.panelExpanded,
        sessionKey: state.sessionKey,
        // Only the person who asked may press ◯ 停止 (see handleCardAction).
        ...(state.ownerOpenId ? { stopOwnerOpenId: state.ownerOpenId } : {}),
        log: (message) => ctx.logger.debug(message),
        resolveImages,
        onCardId: (cardId) => {
          cardsById.set(cardId, card)
          if (cardsById.size > 500) {
            const oldest = cardsById.keys().next()
            if (!oldest.done) cardsById.delete(oldest.value)
          }
        },
        // The panel's header repeats the model, shortened the same way the
        // footer shortens it, plus the reasoning-round and tool counts.
        panelModel: () => {
          const model = agent.options?.model || read().model || undefined
          return model ? model.replace(/^auto\//, '') : undefined
        },
        panelRounds: () => state.rounds,
        replyToMessageId,
        footerSource: () => {
          // Live readings for the footer: the agent's real model, the
          // request-reported window (registry as the fallback), and occupancy
          // from the session projection — with the turn's own usage sample
          // standing in while the projection is still empty, which is the whole
          // streaming window.
          const live = read()
          const model = agent.options?.model || live.model || undefined
          const projected = readUsage(
            ctx,
            agent,
            resolveContextWindow(model, live.contextWindows),
          )
          const usage = {
            ...projected,
            usedTokens: projected.usedTokens ?? undefined,
            // Same bucket names the projection reports, so the footer's
            // formatter sees one shape whichever source won.
            usage:
              projected.usage ??
              (state.usage.inputTokens || state.usage.outputTokens
                ? {
                    uncachedInputTokens: state.usage.inputTokens,
                    outputTokens: state.usage.outputTokens,
                    cacheReadTokens: state.usage.cacheReadTokens,
                    cacheWriteTokens: state.usage.cacheWriteTokens,
                  }
                : undefined),
          }
          trace('footer', {
            chatId,
            model,
            usedTokens: usage.usedTokens ?? null,
            contextWindow: usage.contextWindow ?? null,
            uncachedInput: usage.usage?.uncachedInputTokens ?? null,
            output: usage.usage?.outputTokens ?? null,
            cacheRead: usage.usage?.cacheReadTokens ?? null,
            cacheWrite: usage.usage?.cacheWriteTokens ?? null,
          })
          return buildFooterInput({ status: '思考中', model, ...usage })
        },
      })
      return card
    },
  })

  const gateway = (deps.createGateway ?? ((options: GatewayOptions) => new FeishuGateway(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
      debug: (message) => ctx.logger.debug(message),
    },
    onUnsupported: ({ chatId, chatType, type, senderOpenId, mentioned }) => {
      // Access first. Replying "only text is supported" to a stranger both
      // leaks that the bot is alive and contradicts the silent-deny rule the
      // whole bridge is built around.
      const decision = decideAccess(
        {
          chatType,
          chatId,
          senderOpenId: senderOpenId ?? '',
          mentioned: Boolean(mentioned),
          mentionAllOnly: false,
        },
        read(),
      )
      if (!decision.allowed) {
        ctx.logger.debug(
          `feishu-card: unsupported ${type} from ${senderOpenId} in ${chatId} not answered (${decision.reason})`,
        )
        return
      }
      if (chatType !== 'p2p') return
      void sender
        .sendText(chatId, `暂时只支持文字消息（收到 ${type}）。`)
        .catch(() => undefined)
    },
    onCardAction: (data) => handleCardAction(data),
    // Message protection: the user recalled the card, so stop writing to it.
    onMessageRecalled: ({ messageId }) => {
      const cardId = cardIdByMessage.get(messageId)
      const card = cardId ? cardsById.get(cardId) : undefined
      if (!card) return
      card.markUnavailable('recalled')
      cardIdByMessage.delete(messageId)
      cardsById.delete(cardId!)
      trace('card-recalled', { messageId, cardId })
      ctx.logger.info(`feishu-card: card ${cardId} was recalled; stopped updating it`)
    },
    onMessage: inbound,
    onAttachment: (attachment) => {
      // Fire and forget: the SDK acknowledges the frame when this returns, and
      // a download must never hold that up.
      void handleAttachment(attachment).catch((error) => {
        ctx.logger.warn(`feishu-card: attachment handling failed: ${error}`)
      })
    },
  })

  /**
   * A picture / file / voice message.
   *
   * Gated BEFORE the download (an unlisted stranger must not be able to make
   * the host fetch files), then saved locally and handed to the agent as a
   * path — the agent has file tools, but no way to read a Feishu file_key.
   */
  async function handleAttachment(info: RawFeishuAttachment): Promise<void> {
    if (!dedup.check(info.eventId)) return
    // Recorded before the gate: the person who just got denied is exactly who
    // the allowlist should gain next.
    recent.note(info.senderOpenId, info.chatId)
    const mentionedBotId = info.mentions?.length ? await botOpenId() : undefined
    const message = normalizeInbound(
      {
        messageId: info.messageId,
        eventId: info.eventId,
        chatId: info.chatId,
        chatType: info.chatType,
        senderOpenId: info.senderOpenId,
        senderType: info.senderType,
        text: '',
        mentions: info.mentions,
      },
      mentionedBotId,
    )
    const decision = decideAccess(message, read())
    if (!decision.allowed) {
      ctx.logger.info(
        `feishu-card: denied ${info.type} from ${info.senderOpenId}: ${describeDeny(decision.reason)}`,
      )
      return
    }
    const kind = info.type as 'image' | 'file' | 'audio' | 'media'
    let localPath: string
    try {
      localPath = await media.saveResource({
        messageId: info.messageId,
        fileKey: info.fileKey!,
        kind,
        fileName: info.fileName,
      })
    } catch (error) {
      ctx.logger.warn(`feishu-card: download failed (${info.type}): ${error}`)
      await sender
        .sendText(info.chatId, `这个${labelOf(kind)}我没能下载下来：${String(error).slice(0, 160)}`)
        .catch(() => undefined)
      return
    }
    trace('attachment-saved', { chatId: info.chatId, type: info.type, path: localPath })
    const text = `[用户发来${labelOf(kind)}${info.fileName ? `：${info.fileName}` : ''}]\n已保存到本地：${localPath}`
    await inbound({
      messageId: info.messageId,
      eventId: `${info.eventId}:media`,
      chatId: info.chatId,
      chatType: info.chatType,
      senderOpenId: info.senderOpenId,
      senderType: info.senderType,
      text,
    })
  }

  /**
   * One entry point for every card button.
   *
   * Two kinds exist: the question card's option buttons and the streaming
   * card's ◯ 停止. The asker claims its own by the marker key inside the
   * callback value; anything left over is ours.
   *
   * A stop is restricted to the person who opened the turn (2026-11-10). Feishu
   * renders one card for the whole chat, so the button cannot be hidden from
   * anybody — the refusal has to happen here, when it is pressed.
   */
  async function handleCardAction(data: unknown): Promise<unknown> {
    const askResponse = await ask.handleCardAction(data)
    if (askResponse) return askResponse
    const value = (data as { action?: { value?: unknown } } | undefined)?.action?.value
    if (!value || typeof value !== 'object') return undefined
    const stop = value as { feishuCardStop?: unknown; sessionKey?: unknown; ownerOpenId?: unknown }
    if (stop.feishuCardStop !== 'stop' || typeof stop.sessionKey !== 'string') return undefined
    const owner = typeof stop.ownerOpenId === 'string' ? stop.ownerOpenId : undefined
    const clicker = operatorOpenId(data)
    const denied = stopDenied(owner, clicker)
    if (denied) {
      trace('card-stop-refused', { sessionKey: stop.sessionKey, owner, clicker })
      return { toast: { type: 'warning', content: denied } }
    }
    trace('card-stop', { sessionKey: stop.sessionKey, owner: owner ?? null, clicker: clicker ?? null })
    await bridge.stop(stop.sessionKey)
    return { toast: { type: 'info', content: '已请求停止当前任务' } }
  }

  /**
   * The open_id of whoever clicked a card button.
   *
   * v2 payloads carry `operator.open_id`; older ones put it at the top level or
   * under `context`. All three are read so a payload-shape change degrades to
   * "unknown clicker" (and the stop still works) instead of bricking the button.
   */
  function operatorOpenId(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined
    const payload = data as {
      operator?: { open_id?: unknown }
      open_id?: unknown
      context?: { open_id?: unknown }
    }
    for (const candidate of [payload.operator?.open_id, payload.open_id, payload.context?.open_id]) {
      if (typeof candidate === 'string' && candidate) return candidate
    }
    return undefined
  }

  /**
   * Who sent it, who else was @-ed, and what it replies to.
   *
   * Every piece is best effort. A profile without directory authorization, a
   * recalled parent message or an unavailable API yields a smaller header — it
   * must never cost the turn.
   */
  async function describeEnvelope(
    raw: RawFeishuMessage,
    message: {
      chatType: 'p2p' | 'group'
      senderOpenId: string
      othersMentioned?: RawMention[]
      threadId?: string
    },
  ): Promise<MessageEnvelope> {
    const others = message.othersMentioned ?? []
    const ids = [message.senderOpenId, ...others.map((mention) => mention.openId ?? '')].filter(
      (id) => id.length > 0,
    )
    // Cache first: free, and it keeps working when the delegated token is dead.
    let senderName = deps.names?.user(message.senderOpenId)
    if (!senderName && deps.directory && ids.length > 0) {
      try {
        const resolved = (await deps.directory.names(ids)).names
        senderName = resolved[message.senderOpenId]
        if (senderName) deps.names?.rememberUsers({ [message.senderOpenId]: senderName })
      } catch (error) {
        ctx.logger.debug(`feishu-card: sender name lookup failed: ${String(error).slice(0, 160)}`)
      }
    }
    const envelope: MessageEnvelope = {
      chatType: message.chatType,
      senderOpenId: message.senderOpenId,
      ...(senderName ? { senderName } : {}),
      others,
    }
    // `parent_id` is the message being answered. `root_id` only means the same
    // thing inside a topic thread, so it is a fallback for that case alone — a
    // plain quote-reply also carries a root_id, and quoting the thread opener
    // there would attach the wrong text.
    const quoteId = raw.parentId ?? (message.threadId ? raw.rootId : undefined)
    if (quoteId) {
      try {
        const quoted = await quote.fetch(quoteId)
        if (quoted) {
          if (!quoted.senderName && quoted.senderOpenId && deps.directory) {
            const { names } = await deps.directory.names([quoted.senderOpenId])
            const name = names[quoted.senderOpenId]
            if (name) quoted.senderName = name
          }
          envelope.quote = quoted
          trace('quote-attached', {
            chatId: raw.chatId,
            quoteId,
            length: quoted.text.length,
            sender: quoted.senderOpenId ?? null,
          })
        }
      } catch (error) {
        ctx.logger.debug(`feishu-card: quote lookup failed: ${String(error).slice(0, 160)}`)
      }
    }
    return envelope
  }

  /** The inbound pipeline, exposed so tests (and future channels) can drive it. */
  async function inbound(raw: RawFeishuMessage): Promise<void> {
    trace('inbound', {
      chatId: raw.chatId,
      chatType: raw.chatType,
      sender: raw.senderOpenId,
      text: (raw.text ?? '').slice(0, 120),
    })
    if (!dedup.check(raw.eventId)) {
      ctx.logger.debug(`feishu-card: duplicate event ${raw.eventId} ignored`)
      trace('dedup-skipped', { eventId: raw.eventId })
      return
    }
    // Recorded before the gate: the person who just got denied is exactly who
    // the allowlist should gain next, and their open_id here is already this
    // app's (no contact permission involved).
    recent.note(raw.senderOpenId, raw.chatId)
    // Needed so "mentioned" means "mentioned ME": the mentions array lists every
    // @ in the message, colleagues included. Only looked up when the message
    // carries mentions at all (most do not), and cached after the first call.
    const mentionedBotId = raw.mentions?.length ? await botOpenId() : undefined
    const message = normalizeInbound(raw, mentionedBotId)
    const config = read()
    const sessionKey = sessionKeyFor(message, config.sessionScope)
    const decision = decideAccess(message, config)
    if (!decision.allowed) {
      // Info, not debug: "the bot ignores me" is the single most common report,
      // and debug-level lines never reach a user who runs without a log viewer.
      ctx.logger.info(
        `feishu-card: denied ${sessionKey} from ${message.senderOpenId}: ` +
          `${decision.reason} (${describeDeny(decision.reason)})`,
      )
      return
    }

    // "I saw you." Posted the moment the gate passes, before the first card
    // round trip: a card takes a couple of seconds to appear and the process
    // panel only shows up once a tool runs, so without this the sender cannot
    // tell "received" from "ignored". Fire-and-forget on purpose — a receipt
    // must never delay the turn, and `ack()` swallows its own failures.
    void reactor.ack(raw.messageId, ACK_EMOJI)

    // Everything below runs under one settle: the receipt is a STATE. ✅ once a
    // reply went out (2026-11-10 feedback: a finished answer still showing "on
    // it" is wrong), nothing at all when it did not — a check mark after a
    // failure would be a lie.
    const answered = await answerAccepted(raw, message, sessionKey, mentionedBotId)
    void (answered ? reactor.settle(raw.messageId, DONE_EMOJI) : reactor.clear(raw.messageId))
  }

  /**
   * The accepted-message path: a question for a pending ask, a slash command, or
   * a full agent turn.
   *
   * @returns whether the sender got a reply (false = no answer was produced, so
   * the receipt reaction is removed rather than completed)
   */
  async function answerAccepted(
    raw: RawFeishuMessage,
    message: NormalizedMessage,
    sessionKey: string,
    mentionedBotId: string | undefined,
  ): Promise<boolean> {
    if (!message.text) {
      ctx.logger.debug(`feishu-card: empty text after mention strip in ${sessionKey}`)
      return false
    }

    // A pending question owns the next message from its session, whatever it
    // says: answering "北京" must not start a new turn.
    const sessionId = bridge.describe(sessionKey).sessionId
    if (sessionId && ask.handleChatMessage(sessionId, message.text)) {
      trace('ask-answered', { sessionKey, length: message.text.length })
      return false
    }

    // Bridge commands are answered locally and never reach the agent.
    const parsed = parseInput(message.text)
    if (parsed.command) {
      await sender.sendText(
        message.chatId,
        await handleCommand(parsed.command, sessionKey, message.chatId, parsed.args, message.senderOpenId),
        raw.messageId,
      )
      return true
    }

    ctx.logger.info(`feishu-card: turn in ${sessionKey} from ${message.senderOpenId}`)
    // Who is speaking, who else was @-ed, and what they are replying to. The
    // agent used to get none of this: "这条你再看下" arrived with no quote and no
    // sender (user comparison against Hermes, 2026-11-09). Resolved here rather
    // than earlier so a slash command costs no directory/quote round trip.
    const envelope = await describeEnvelope(raw, message)
    // `text` is what the model reads: sender + mentions + quote header, then the
    // user's own words. The raw text stays in the trace so a bad header is easy
    // to spot.
    const turnText = composeTurnText(message.text, envelope)
    trace('turn-start', {
      sessionKey,
      text: message.text.slice(0, 120),
      composed: turnText.length,
      hasQuote: Boolean(envelope.quote),
      senderName: envelope.senderName ?? null,
    })
    try {
      const result = await bridge.handleMessage({
        sessionKey,
        chatId: message.chatId,
        text: turnText,
        replyToMessageId: raw.messageId,
        chatType: message.chatType,
        // Ownership of the turn: only this person may stop it.
        senderOpenId: message.senderOpenId,
        ...(mentionedBotId ? { botOpenId: mentionedBotId } : {}),
      })
      trace('turn-result', {
        sessionKey,
        carded: result.carded,
        timedOut: result.timedOut,
        model: result.model,
        textLength: result.text.length,
        text: result.text.slice(0, 200),
      })
      // A streamed card already carries the answer; only the text path (and
      // the card-failure fallback) needs an explicit message. Either way it
      // quotes the message being answered.
      //
      // A STOPPED turn is the exception (2026-11-10): its card already says
      // 已停止, and the answer is usually empty, so posting "（本轮无输出）" right
      // under it just adds a second bubble saying nothing.
      if (shouldSendTextFallback(result)) {
        await sender.sendText(message.chatId, result.text, raw.messageId)
      }
      return true
    } catch (error) {
      ctx.logger.warn(`feishu-card: turn failed in ${sessionKey}: ${error}`)
      trace('turn-error', { sessionKey, error: String(error) })
      await sender
        .sendText(
          message.chatId,
          `出错了：${error instanceof Error ? error.message : String(error)}`,
          raw.messageId,
        )
        .catch(() => undefined)
      return false
    }
  }

  let connected = false

  /** Bridge-side slash commands: answered here, never sent to the agent. */
  const handleCommand = async (
    command: BridgeCommand,
    sessionKey: string,
    chatId: string,
    args: string[],
    /** Who sent the command; `/stop` is owner-only (see the case below). */
    requester: string,
  ): Promise<string> => {
    const config = read()
    switch (command) {
      case 'help':
        return formatHelp()
      case 'status': {
        const info = bridge.describe(sessionKey)
        const override = bridge.modelOverride(sessionKey)
        return formatStatus({
          connected,
          sessionKey,
          sessionId: info.sessionId,
          model: override
            ? `${override.provider}/${override.model}（/model 覆盖）`
            : info.model ?? config.model,
          dmPolicy: config.dmPolicy,
          allowlist: config.allowlist,
          groupPolicy: config.groupPolicy,
          groupAllowlist: config.groupAllowlist,
          requireMentionInGroups: config.requireMentionInGroups,
          replyMode: config.replyMode,
          sessions: store.size,
        })
      }
      case 'model': {
        const requested = args[0]
        const info = bridge.describe(sessionKey)
        const override = bridge.modelOverride(sessionKey)
        if (!requested) {
          if (override) return formatModel(override)
          if (info.model) {
            const live = read()
            return formatModel({ provider: live.provider || '（宿主默认）', model: info.model })
          }
          return formatModel(undefined)
        }
        // A conversation-level switch, NOT a write to the host's global default:
        // retuning every other chat and the GUI as a side effect of one `/model`
        // is surprising, and with an explicit panel model configured the global
        // default was ignored anyway — the command silently did nothing.
        const slash = requested.indexOf('/')
        if (slash <= 0 || slash === requested.length - 1) {
          return formatModel(undefined, requested)
        }
        const selection = {
          provider: requested.slice(0, slash),
          model: requested.slice(slash + 1),
        }
        void bridge
          .setModel(sessionKey, selection)
          .catch((error) => {
            ctx.logger.warn(`feishu-card: /model switch failed: ${error}`)
            void sender.sendText(chatId, `模型切换失败：${error}`).catch(() => undefined)
          })
        return formatModel(undefined, requested)
      }
      case 'new': {
        // `/new` also stops the running turn (reset → stop), so it needs the
        // same ownership rule; otherwise it is the back door for the button.
        const denied = stopDenied(bridge.turnOwner(sessionKey), requester)
        if (denied) return denied
        // One bubble, and it is the real answer: the old code replied
        // "正在结束当前会话…" and then a SECOND message with the outcome, so
        // `/new` always cost two notifications for one question (2026-11-10).
        return formatReset(await bridge.reset(sessionKey))
      }
      case 'stop': {
        const running = bridge.describe(sessionKey).running
        // Same ownership rule as the card's ◯ 停止: typing /stop must not be a
        // back door around a button that only the requester may press.
        const denied = stopDenied(bridge.turnOwner(sessionKey), requester)
        if (denied) return denied
        // Same single-bubble rule as /new. The card settles 已停止 immediately
        // (the settler fires before dispose), so the user sees the result while
        // this message is still being written.
        return formatStop((await bridge.stop(sessionKey)) || running)
      }
    }
  }

  return {
    async start() {
      await store.load()
      await dedup.load()
      await recent.load()
      await gateway.start()
      connected = true
      const config = read()
      ctx.logger.info(
        `feishu-card: bridge armed (dm=${config.dmPolicy}/${config.allowlist.length} ids, ` +
          `group=${config.groupPolicy}/${config.groupAllowlist.length} chats)`,
      )
    },
    async stop() {
      connected = false
      ask.dispose()
      await recent.flush()
      await gateway.stop()
      await bridge.dispose()
    },
    /** Drive one raw Feishu message through the whole pipeline (tests, other channels). */
    inbound,
    recent: () => recent.list(),
    recentChats: () => recent.chats(),
    status: () => ({
      connected,
      sessions: store.size,
      allowlist: read().allowlist.length,
      groupAllowlist: read().groupAllowlist.length,
    }),
  }
}
