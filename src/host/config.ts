/**
 * Plugin configuration schema.
 *
 * Notes that matter for the desktop plugin manager:
 * - Every panel-editable field is `.volatile()`. The settings service only
 *   projects volatile fields into a form (see dsh-settings README).
 * - `appSecret` is `.role('secret')`: the value never crosses the wire back to
 *   the browser; the card only learns whether one exists. Writes therefore go
 *   through path-addressed `mutate` ops instead of a wholesale `replace`.
 * - Defaults live here, NOT in cordis.patch.yml: the patch only inserts the
 *   plugin row, and panel edits land in the profile patch as an override.
 */
import Schema from '@deepseek-ai/schemastery'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { CONFIG_DEFAULTS, FOOTER_FIELDS, type FeishuCardConfig, type FooterField } from '../shared/types.js'

const brand = Schema.union([
  Schema.const('feishu'),
  Schema.const('lark'),
]).default(CONFIG_DEFAULTS.brand)

const dmPolicy = Schema.union([
  Schema.const('open'),
  Schema.const('pairing'),
  Schema.const('allowlist'),
  Schema.const('disabled'),
]).default(CONFIG_DEFAULTS.dmPolicy)

const groupPolicy = Schema.union([
  Schema.const('open'),
  Schema.const('allowlist'),
  Schema.const('disabled'),
]).default(CONFIG_DEFAULTS.groupPolicy)

const sessionScope = Schema.union([
  Schema.const('chat'),
  Schema.const('thread'),
  Schema.const('sender'),
]).default(CONFIG_DEFAULTS.sessionScope)

const replyMode = Schema.union([
  Schema.const('streaming'),
  Schema.const('text'),
]).default(CONFIG_DEFAULTS.replyMode)

export const Config = Schema.object({
  appId: Schema.string()
    .description('飞书应用 App ID（cli_ 开头）。留空则插件不启动桥接，只注册工具')
    .volatile(),
  appSecret: Schema.string()
    .role('secret')
    .description('飞书应用 App Secret。只写不回显；留空表示不修改已保存的密钥')
    .volatile(),
  brand: brand.volatile(),
  dmPolicy: dmPolicy.volatile(),
  allowlist: Schema.array(Schema.string())
    .description('私聊 open_id 白名单（一行一个）。dmPolicy=allowlist 时只放行名单内的人')
    .volatile(),
  groupPolicy: groupPolicy.volatile(),
  groupAllowlist: Schema.array(Schema.string())
    .description('群 chat_id 白名单（oc_ 开头，一行一个）。groupPolicy=allowlist 时只在这些群响应')
    .volatile(),
  groupSenderAllowlist: Schema.array(Schema.string())
    .description('可选：群内只响应这些人（open_id）。留空 = 白名单群里所有人都可以')
    .volatile(),
  requireMentionInGroups: Schema.boolean()
    .default(CONFIG_DEFAULTS.requireMentionInGroups)
    .description('群里需要 @机器人 才响应')
    .volatile(),
  respondToMentionAll: Schema.boolean()
    .default(CONFIG_DEFAULTS.respondToMentionAll)
    .description('@所有人 是否算作提及')
    .volatile(),
  sessionScope: sessionScope.volatile(),
  replyMode: replyMode.volatile(),
  footerFields: Schema.array(Schema.union(FOOTER_FIELDS.map((f) => Schema.const(f))))
    .default([...CONFIG_DEFAULTS.footerFields])
    .description('底部状态行字段，顺序即展示顺序')
    .volatile(),
  flushIntervalMs: Schema.number()
    .default(CONFIG_DEFAULTS.flushIntervalMs)
    .description('流式卡片刷新节流（毫秒）')
    .volatile(),
  contextWindows: Schema.object({})
    .description('模型 id → 上下文窗口 token 数，用于底部「已用/窗口 (占比)」')
    .volatile(),
  provider: Schema.string()
    .default(CONFIG_DEFAULTS.provider)
    .description('模型所属的 provider 路由，和「模型」一起填。留空跟随默认模型')
    .volatile(),
  model: Schema.string()
    .default(CONFIG_DEFAULTS.model)
    .description('桥接创建的 agent 使用的模型 id。留空跟随默认模型')
    .volatile(),
  allowBots: Schema.union([Schema.const('none'), Schema.const('mentions'), Schema.const('all')])
    .default(CONFIG_DEFAULTS.allowBots)
    .description('是否让机器人/应用发送的消息驱动 agent。none=一律忽略（推荐）')
    .volatile(),
  defaultWorkspace: Schema.string()
    .default(CONFIG_DEFAULTS.defaultWorkspace)
    .description('新会话的默认工作目录（绝对路径）。留空则不属于任何工作区，Harness 里点不开它的历史')
    .volatile(),
  dedupTtlMs: Schema.number()
    .default(CONFIG_DEFAULTS.dedupTtlMs)
    .description('消息去重窗口（毫秒）'),
  turnTimeoutMs: Schema.number()
    .default(CONFIG_DEFAULTS.turnTimeoutMs)
    .description('单个回合最长等待（毫秒），超时会取消 agent 并封卡')
    .volatile(),
  showReasoning: Schema.boolean()
    .default(CONFIG_DEFAULTS.showReasoning)
    .description('在卡片的思考面板里显示模型的推理过程')
    .volatile(),
  showPanel: Schema.boolean()
    .default(CONFIG_DEFAULTS.showPanel)
    .description('显示过程面板（工具调用/轮数/耗时），关闭后卡片只有正文')
    .volatile(),
  panelExpanded: Schema.boolean()
    .default(CONFIG_DEFAULTS.panelExpanded)
    .description('回合结束后保持思考面板展开')
    .volatile(),
})

/** The resolved config type the host half reads. */
export type ResolvedConfig = FeishuCardConfig

/** What the plugin's `ctx.config` actually looks like: volatile fields are references. */
export type RawConfig = Record<keyof FeishuCardConfig, unknown>

/**
 * Unwrap the Volatile references cordis hands us for `.volatile()` fields.
 *
 * Volatile is a feature, not a nuisance: the settings service updates the
 * reference in place when the panel saves, so reading through this helper on
 * every message makes panel edits take effect without restarting dsh.
 *
 * `raw` is undefined when the profile row carries no `config` block at all
 * (cordis passes `undefined` straight through), so every field falls back to
 * its schema default here.
 */
export function readConfig(raw: RawConfig | undefined): ResolvedConfig {
  const source = (raw ?? {}) as Partial<RawConfig>
  const plain = <T>(value: unknown, fallback: T): T => {
    const resolved = isVolatile(value) ? value.get() : value
    return (resolved ?? fallback) as T
  }
  return {
    appId: plain(source.appId, ''),
    appSecret: plain(source.appSecret, ''),
    brand: plain(source.brand, CONFIG_DEFAULTS.brand),
    dmPolicy: plain(source.dmPolicy, CONFIG_DEFAULTS.dmPolicy),
    allowlist: [...plain<string[]>(source.allowlist, [])],
    groupPolicy: plain(source.groupPolicy, CONFIG_DEFAULTS.groupPolicy),
    groupAllowlist: [...plain<string[]>(source.groupAllowlist, [])],
    groupSenderAllowlist: [...plain<string[]>(source.groupSenderAllowlist, [])],
    requireMentionInGroups: plain(
      source.requireMentionInGroups,
      CONFIG_DEFAULTS.requireMentionInGroups,
    ),
    respondToMentionAll: plain(source.respondToMentionAll, CONFIG_DEFAULTS.respondToMentionAll),
    sessionScope: plain(source.sessionScope, CONFIG_DEFAULTS.sessionScope),
    replyMode: plain(source.replyMode, CONFIG_DEFAULTS.replyMode),
    footerFields: [...plain<FooterField[]>(source.footerFields, CONFIG_DEFAULTS.footerFields)],
    flushIntervalMs: plain(source.flushIntervalMs, CONFIG_DEFAULTS.flushIntervalMs),
    model: plain(source.model, CONFIG_DEFAULTS.model),
    provider: plain(source.provider, CONFIG_DEFAULTS.provider),
    allowBots: plain(source.allowBots, CONFIG_DEFAULTS.allowBots),
    contextWindows: { ...plain<Record<string, number>>(source.contextWindows, {}) },
    defaultWorkspace: plain(source.defaultWorkspace, CONFIG_DEFAULTS.defaultWorkspace),
    dedupTtlMs: plain(source.dedupTtlMs, CONFIG_DEFAULTS.dedupTtlMs),
    turnTimeoutMs: plain(source.turnTimeoutMs, CONFIG_DEFAULTS.turnTimeoutMs),
    showReasoning: plain(source.showReasoning, CONFIG_DEFAULTS.showReasoning),
    showPanel: plain(source.showPanel, CONFIG_DEFAULTS.showPanel),
    panelExpanded: plain(source.panelExpanded, CONFIG_DEFAULTS.panelExpanded),
  }
}

export default Config
