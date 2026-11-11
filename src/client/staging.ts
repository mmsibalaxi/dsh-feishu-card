/**
 * Staged-form logic for the settings panel.
 *
 * The host's own form model (`SettingsFormModel` in
 * `@deepseek-ai/dsh-client-ui-primitives`) stages every edit in the browser and
 * writes once, on 保存: `dirty` = "a staged edit exists", `overridden` = "the
 * user layer owns this field", a refused write keeps the draft and shows
 * `failed`. This module is that contract, reduced to the fields our panel
 * shows, and kept free of React so it can be unit-tested.
 *
 * Two host facts shape it:
 *  - `appSecret` is `.role('secret')`: it never comes back, so an empty box
 *    means "keep the stored secret" and must produce no op.
 *  - Every field is `.volatile()`, so a `set` op lands in the profile patch and
 *    the host re-reads it live — no restart.
 */
import type {
  BotPolicy,
  Brand,
  DmPolicy,
  FeishuCardConfig,
  FooterField,
  GroupPolicy,
  ReplyMode,
  SessionScope,
} from '../shared/types.js'

/** One secret position as the settings view reports it. */
export interface SecretPosition {
  path: string[]
  set: boolean
}

/** The subset of the config the panel edits, as the browser holds it. */
export interface Draft {
  appId: string
  /** Only ever what was typed; never a value read back from the host. */
  appSecret: string
  brand: Brand
  dmPolicy: DmPolicy
  groupPolicy: GroupPolicy
  allowlist: string[]
  groupAllowlist: string[]
  groupSenderAllowlist: string[]
  requireMentionInGroups: boolean
  respondToMentionAll: boolean
  allowBots: BotPolicy
  sessionScope: SessionScope
  replyMode: ReplyMode
  footerFields: FooterField[]
  flushIntervalMs: number
  turnTimeoutMs: number
  showReasoning: boolean
  panelExpanded: boolean
  model: string
  provider: string
  defaultWorkspace: string
}

/** Mirror of the wire op shape; see ConfigForm.mutate in dsh-client-ui-settings. */
export type PathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** What a form snapshot carries beyond the value itself. */
export interface Snapshot {
  value?: FeishuCardConfig
  base?: Record<string, unknown>
  user?: Record<string, unknown>
}

export function draftFrom(value: FeishuCardConfig): Draft {
  return {
    appId: value.appId ?? '',
    appSecret: '',
    brand: value.brand ?? 'feishu',
    dmPolicy: value.dmPolicy ?? 'allowlist',
    groupPolicy: value.groupPolicy ?? 'allowlist',
    allowlist: [...(value.allowlist ?? [])],
    groupAllowlist: [...(value.groupAllowlist ?? [])],
    groupSenderAllowlist: [...(value.groupSenderAllowlist ?? [])],
    // `?? true` matches CONFIG_DEFAULTS: showing "否" for a host that did not
    // report the field let one 保存 turn group-mention gating off by accident.
    requireMentionInGroups: value.requireMentionInGroups ?? true,
    respondToMentionAll: value.respondToMentionAll ?? false,
    allowBots: value.allowBots ?? 'none',
    sessionScope: value.sessionScope ?? 'chat',
    replyMode: value.replyMode ?? 'streaming',
    footerFields: [...(value.footerFields ?? [])],
    flushIntervalMs: value.flushIntervalMs ?? 200,
    turnTimeoutMs: value.turnTimeoutMs ?? 600000,
    showReasoning: value.showReasoning ?? false,
    panelExpanded: value.panelExpanded ?? false,
    model: value.model ?? '',
    provider: value.provider ?? '',
    defaultWorkspace: value.defaultWorkspace ?? '',
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/** Field-by-field equality; `appSecret` is compared as "was something typed". */
export function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.appId === b.appId &&
    a.appSecret === b.appSecret &&
    a.brand === b.brand &&
    a.dmPolicy === b.dmPolicy &&
    a.groupPolicy === b.groupPolicy &&
    sameList(a.allowlist, b.allowlist) &&
    sameList(a.groupAllowlist, b.groupAllowlist) &&
    sameList(a.groupSenderAllowlist, b.groupSenderAllowlist) &&
    a.requireMentionInGroups === b.requireMentionInGroups &&
    a.respondToMentionAll === b.respondToMentionAll &&
    a.allowBots === b.allowBots &&
    a.sessionScope === b.sessionScope &&
    a.replyMode === b.replyMode &&
    sameList(a.footerFields, b.footerFields) &&
    a.flushIntervalMs === b.flushIntervalMs &&
    a.turnTimeoutMs === b.turnTimeoutMs &&
    a.showReasoning === b.showReasoning &&
    a.panelExpanded === b.panelExpanded &&
    a.model === b.model &&
    a.provider === b.provider &&
    a.defaultWorkspace === b.defaultWorkspace
  )
}

/** Whether the 保存 button should be enabled. */
export function isDirty(draft: Draft, saved: Draft): boolean {
  return !sameDraft(draft, saved)
}

/**
 * The ops one 保存 writes: only fields that actually changed, so an unrelated
 * field's stored value is never rewritten (and a revision conflict stays
 * unlikely). An empty secret box is deliberately not an op.
 */
export function saveOps(draft: Draft, saved: Draft): PathOp[] {
  const ops: PathOp[] = []
  const set = (path: string, value: unknown) => {
    const previous = (saved as unknown as Record<string, unknown>)[path]
    if (JSON.stringify(value) !== JSON.stringify(previous)) {
      ops.push({ op: 'set', path: [path], value })
    }
  }
  set('appId', draft.appId)
  if (draft.appSecret) ops.push({ op: 'set', path: ['appSecret'], value: draft.appSecret })
  set('brand', draft.brand)
  set('dmPolicy', draft.dmPolicy)
  set('groupPolicy', draft.groupPolicy)
  set('allowlist', draft.allowlist)
  set('groupAllowlist', draft.groupAllowlist)
  set('groupSenderAllowlist', draft.groupSenderAllowlist)
  set('requireMentionInGroups', draft.requireMentionInGroups)
  set('respondToMentionAll', draft.respondToMentionAll)
  set('allowBots', draft.allowBots)
  set('sessionScope', draft.sessionScope)
  set('replyMode', draft.replyMode)
  set('footerFields', draft.footerFields)
  set('flushIntervalMs', draft.flushIntervalMs)
  set('turnTimeoutMs', draft.turnTimeoutMs)
  set('showReasoning', draft.showReasoning)
  set('panelExpanded', draft.panelExpanded)
  set('model', draft.model)
  set('provider', draft.provider)
  set('defaultWorkspace', draft.defaultWorkspace)
  return ops
}

/**
 * Which fields the user layer owns — the host's own definition of "overridden",
 * and therefore of when the 恢复默认 button appears. A value that merely equals
 * the default is NOT overridden; only a stored override is.
 */
export function overriddenFields(snapshot: Snapshot): Set<string> {
  const user = snapshot.user
  if (!user) return new Set()
  return new Set(Object.keys(user))
}

/** The op that hands one field back to the deployment default. */
export function resetOp(field: keyof Draft): PathOp {
  return { op: 'unset', path: [field] }
}

/** Toggle one footer field, keeping the array's order stable. */
export function toggleFooterField(fields: FooterField[], field: FooterField): FooterField[] {
  return fields.includes(field)
    ? fields.filter((item) => item !== field)
    : [...fields, field]
}

/** Add an id to an allowlist, ignoring blanks and duplicates. */
export function addId(ids: string[], id: string): string[] {
  const clean = id.trim()
  if (!clean || ids.includes(clean)) return ids
  return [...ids, clean]
}

/** Remove one id from an allowlist. */
export function removeId(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id)
}

/** `ou_0000000000…0000` — enough to recognise an id in a chip without wrapping. */
export function shortId(id: string): string {
  return id.length <= 20 ? id : `${id.slice(0, 18)}…${id.slice(-4)}`
}

/** Render an id list back into the paste box. */
export function formatIds(ids: readonly string[]): string {
  return ids.join('\n')
}

/**
 * Parse whatever a human pasted into ids.
 *
 * Deliberately greedy, because this is a paste target and every habit exists:
 * newlines, half/full-width commas, semicolon, tabs, `#` comments, and two ids
 * written **with no separator at all** (`ou_abc123ou_def456`) all resolve to
 * the same list. The last one works by marking every occurrence of the prefix
 * that is not at the start, so the normal split can do the rest.
 *
 * A leading `@` is read as a mention decoration: `@张三 (ou_abc123)` yields
 * the id only, while `@ou_abc123` (an id that merely carries the sign) is kept.
 *
 * @param text - raw paste-box content
 * @param prefix - the id prefix this list expects (`ou_` or `oc_`)
 */
export function parseIds(text: string | undefined, prefix: string): string[] {
  if (!text) return []
  // 1. Comments run to the end of the line; ids never contain '#'.
  const bare = text.replace(/#[^\n]*/g, ' ')
  // 2. Mark EVERY id-shaped prefix that is not at position 0, not just this
  //    list's own: `ou_aoc_b` must become two rows (one of them flagged) rather
  //    than one glued nonsense id. Ids never contain '_', so no inner match.
  const marked = bare.replace(/(?<!^)(?:ou_|oc_)/g, (match) => `\n${match}`)
  const out: string[] = []
  for (const raw of marked.split(/[\r\n,，;；\s]+/)) {
    let id = raw.trim()
    if (!id) continue
    // 3. A mention decoration: keep what follows only when it is an id.
    if (id.startsWith('@')) {
      const inner = id.slice(1)
      if (!inner.startsWith(prefix)) continue
      id = inner
    }
    // 4. Strip wrapping punctuation a copy may have brought along.
    id = id
      .replace(/^[(（<]/, '')
      .replace(/[>)）]$/, '')
      .trim()
    if (id) out.push(id)
  }
  return [...new Set(out)]
}

/** Whether an id looks like the kind this list holds. */
export function idFormatOk(id: string, prefix: string): boolean {
  return id.startsWith(prefix)
}

/** The entries that do not match the expected prefix, for the warning line. */
export function malformedIds(ids: readonly string[], prefix: string): string[] {
  return ids.filter((id) => !idFormatOk(id, prefix))
}

/**
 * Whether a `role('secret')` field currently holds a value.
 *
 * This CANNOT be read from the form snapshot: `ConfigFormController.derive()`
 * projects only `revision`/`base`/`user`/`writable`/`value` onto its store, so
 * the host's `secrets` positions never reach it (verified in the shipped
 * bundle — the App Secret badge read `undefined` and always said 未配置).
 * The shared describe mirror carries the descriptors verbatim, so that is where
 * this reads from.
 *
 * @param view - the mirror snapshot's `view`, or undefined while loading
 * @param entryId - our settings namespace
 */
export function secretConfigured(
  view:
    | {
        namespaces?: readonly { ns?: string; secrets?: readonly SecretPosition[] }[]
      }
    | undefined,
  entryId: string,
): boolean {
  const namespaces = view?.namespaces ?? []
  const mine = namespaces.find((candidate) => candidate.ns === entryId)
  return (mine?.secrets ?? []).some((secret) => secret.set)
}
