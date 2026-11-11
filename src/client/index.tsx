/**
 * Browser half — the plugin's settings page.
 *
 * Shape copied from the official `dsh-client-ui-settings-shell` client (read
 * out of the shipped bundle), which is the pattern that actually renders:
 *   - inject: ['slots', 'configForms']  (NOT 'remote.settings' — an unresolvable
 *     service name keeps the module pending forever and apply() never runs)
 *   - gate the registration on `configForms.whileServed([entryId], …)`, so the
 *     page only exists while the Host serves our namespace
 *   - register into `plugins.item` with id/order/label, which is the slot the
 *     sidebar Plugins page lists under 内置插件配置 ("查看 飞书")
 *
 * Reads/writes go through `ctx.configForms.get('feishu-card')`:
 *   - getSnapshot() → { status, value, base, user, secrets, revision, writable }
 *   - mutate(pathOps, revision) → Host settings service → profile patch
 *
 * The form's behaviour is the Host's own (SettingsFormModel): edits stage in the
 * browser, 保存 writes once, a refused write keeps the draft and says so, and
 * 恢复默认 hands one field back to the deployment default. Controls are copies
 * of the Host's primitives (see styles.ts) rather than imports of them.
 *
 * Every label is Chinese: the person configuring this is the same person
 * reading Feishu, not a developer reading the schema.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import {
  FOOTER_FIELDS,
  PLUGIN_ID,
  type BotPolicy,
  type Brand,
  type DmPolicy,
  type FeishuCardConfig,
  type FooterField,
  type GroupPolicy,
  type ReplyMode,
  type SessionScope,
} from '../shared/types.js'
import { cls, ensureStyles } from './styles.ts'
import {
  addId,
  draftFrom,
  idFormatOk,
  isDirty,
  malformedIds,
  overriddenFields,
  parseIds,
  removeId,
  resetOp,
  saveOps,
  secretConfigured,
  shortId,
  toggleFooterField,
  type Draft,
  type PathOp,
} from './staging.ts'
import { MODELS_PATH, parseModels, type ModelCatalog } from './models-api.ts'
import { RECENT_PATH, agoText, parseRecent, type RecentSnapshot } from './recent-api.ts'
import {
  authUrl,
  chatSearchUrl,
  namesUrl,
  parseAuth,
  parseFound,
  parseFoundChats,
  parseNames,
  searchUrl,
  type AuthState,
  type FoundChat,
  type FoundPerson,
} from './auth-api.ts'
import { decodeModelRoute, modelRouteOf } from './model-route.ts'

export const inject = ['slots', 'configForms']

/** The shared settings describe mirror, captured in apply() for the secret probe. */
let describeMirror: {
  subscribe(listener: () => void): () => void
  getSnapshot(): {
    view?: {
      namespaces?: readonly { ns?: string; secrets?: readonly { path: string[]; set: boolean }[] }[]
    }
  }
}

/** One secret position as the settings view reports it. */
interface SecretPosition {
  path: string[]
  set: boolean
}

/**
 * Reads "is a secret stored" for one namespace.
 *
 * The form snapshot cannot answer it: the Host's `ConfigFormController` projects
 * only revision/base/user/value onto its store and drops the `secrets` positions
 * it was sent (verified against the shipped bundle), which is why the App Secret
 * badge used to say 未配置 even with a secret in the profile patch. The shared
 * describe mirror keeps them, so this subscribes there instead.
 */
function useSecretConfigured(entryId: string): boolean {
  const mirror = describeMirror
  return useSyncExternalStore(
    (listener) => mirror.subscribe(listener),
    () => secretConfigured(mirror.getSnapshot().view, entryId),
  )
}

export function apply(ctx: Context): void {
  // The shared describe mirror, held for the secret probe above. `describe()`
  // is the mirror itself (see ConfigForms.describe), so one subscription serves
  // every namespace this page cares about.
  describeMirror = ctx.configForms.describe()

  // Styles belong to the page, so they are registered with it and removed with
  // it — never appended to document.body.
  ctx.effect(() => {
    ensureStyles()
    return () => {}
  }, 'feishu-card: panel styles')

  // Our own reactive form handle (subscribe + getSnapshot). It is injected
  // under `ownForm` because the page host passes its OWN `form` prop
  // ({ state, mutate }) — see the plugin manager's formFor() — and the two
  // must not collide.
  const ownForm = ctx.configForms.get<FeishuCardConfig>(PLUGIN_ID)

  ctx.effect(() => {
    const off = ctx.configForms.whileServed([PLUGIN_ID], () =>
      ctx.slots.inject('plugins.item', () =>
        ctx.slots.register(
          {
            name: 'plugins.item',
            id: PLUGIN_ID,
            order: 50,
            label: () => '飞书',
            inject: () => ({ ownForm, useSecretConfigured }),
          },
          SettingsCard,
        ),
      ),
    )
    return () => off()
  })
}

/** The form the page host hands the component (plugin manager formFor()). */
interface HostForm {
  state?: { value?: FeishuCardConfig; writable?: boolean }
  mutate(ops: readonly PathOp[], expectedRevision?: number): Promise<boolean>
}

interface CardProps {
  ownForm: {
    getSnapshot(): {
      status: 'loading' | 'ready' | 'unavailable'
      value: FeishuCardConfig | undefined
      base?: Record<string, unknown>
      user?: Record<string, unknown>
      secrets?: SecretPosition[]
      revision?: number
      writable: boolean
    }
    subscribe(listener: () => void): () => void
    mutate(ops: readonly PathOp[], expectedRevision?: number): Promise<boolean>
  }
  /** Host-provided; undefined when the namespace is not served. */
  form?: HostForm
  /** Reads whether the App Secret is stored; see useSecretConfigured. */
  useSecretConfigured?: (entryId: string) => boolean
  /** 'summary' renders the one-liner under the bundle title; 'page' the form. */
  view?: 'summary' | 'page'
}

function useForm(ownForm: CardProps['ownForm']) {
  return useSyncExternalStore(
    (listener) => ownForm.subscribe(listener),
    () => ownForm.getSnapshot(),
  )
}

/** Footer field labels (order = display order). */
const FIELD_LABELS: Record<FooterField, string> = {
  status: '状态',
  model: '模型',
  context: '上下文占比',
  elapsed: '耗时',
  tokens: 'Token 用量',
}

const DM_OPTIONS: { value: DmPolicy; label: string }[] = [
  { value: 'allowlist', label: '白名单' },
  { value: 'open', label: '任何人' },
  { value: 'disabled', label: '关闭私聊' },
]

const GROUP_OPTIONS: { value: GroupPolicy; label: string }[] = [
  { value: 'allowlist', label: '白名单' },
  { value: 'open', label: '任何群' },
  { value: 'disabled', label: '关闭群聊' },
]

const SCOPE_OPTIONS: { value: SessionScope; label: string }[] = [
  { value: 'chat', label: '每个群' },
  { value: 'thread', label: '每个话题' },
  { value: 'sender', label: '每个人' },
]

const MODE_OPTIONS: { value: ReplyMode; label: string }[] = [
  { value: 'streaming', label: '流式卡片' },
  { value: 'text', label: '纯文本' },
]

const BRAND_OPTIONS: { value: Brand; label: string }[] = [
  { value: 'feishu', label: '飞书' },
  { value: 'lark', label: 'Lark' },
]

const BOT_OPTIONS: { value: BotPolicy; label: string }[] = [
  { value: 'none', label: '都不响应' },
  { value: 'mentions', label: '仅 @ 它时' },
  { value: 'all', label: '全部响应' },
]

/* ------------------------------------------------------------------ controls */

function Tag({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cls.tag} data-tone={tone}>
      {children}
    </span>
  )
}

function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange(next: boolean): void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cls.switch}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={cls.thumb} />
    </button>
  )
}

/** A row whose control sits on the right — the host's toggle row. */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange(next: boolean): void
}) {
  return (
    <div className={cls.field}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={cls.label}>{label}</div>
          {hint ? <p className={cls.hint}>{hint}</p> : null}
        </div>
        <Switch checked={checked} label={label} disabled={disabled} onChange={onChange} />
      </div>
    </div>
  )
}

/** The host's segmented enum control: role=tablist, arrow keys, sliding thumb. */
function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  disabled?: boolean
  onChange(next: T): void
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = options[(index + delta + options.length) % options.length]
    if (next && next.value !== value) onChange(next.value)
  }
  return (
    <div
      className={cls.seg}
      role="tablist"
      aria-label={label}
      style={
        {
          '--fc-segment-count': String(options.length),
          '--fc-segment-index': String(index),
        } as React.CSSProperties
      }
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className={cls.segIndicator} />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={cls.segTab}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** One labelled control: label + badges above, control below, hint underneath. */
function Field({
  label,
  htmlFor,
  hint,
  error,
  badges,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  badges?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cls.field}>
      <div className={cls.head}>
        <div className={cls.labelGroup}>
          <label className={cls.label} htmlFor={htmlFor}>
            {label}
          </label>
        </div>
        {badges ? <div className={cls.badges}>{badges}</div> : null}
      </div>
      {children}
      {error ? (
        <p className={cls.invalid}>{error}</p>
      ) : hint ? (
        <p className={cls.hint}>{hint}</p>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cls.section}>
      <h3 className={cls.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

/** An allowlist rendered as chips, with the picker and a manual fallback. */
/**
 * An allowlist, entered by hand.
 *
 * Feishu will not let a bot search the directory by name (`search/v1/user`
 * needs a user_access_token), and this app's 通讯录 data scope is a single
 * person, so an auto-picker could only ever show one row. Manual entry plus a
 * hint that says where the id comes from — and that the agent can fetch it —
 * is honest about that. See references/panel-rules.md §12.
 */
/**
 * An allowlist as a list: paste anything, it becomes rows.
 *
 * Feishu will not let a bot search the directory by name (`search/v1/user`
 * needs a user_access_token) and this app's 通讯录 data scope is a single
 * person, so an auto-picker could only ever show one row. Manual entry is
 * honest about that — and it is made forgiving instead of strict, because this
 * is a paste target: commas, spaces, newlines, `#` comments, and two ids with
 * no separator at all all resolve to the same list.
 *
 * Entries that do not carry the expected prefix are kept but flagged, so a
 * typo surfaces here instead of silently never matching.
 */
function IdListField({
  label,
  ids,
  prefix,
  placeholder,
  hint,
  disabled,
  badges,
  suggestions,
  searchable,
  searchChats,
  names,
  unknownLabel = '未知',
  note,
  onAuthChange,
  onChange,
}: {
  label: string
  ids: string[]
  /** `ou_` for people, `oc_` for groups — used to split and to validate. */
  prefix: string
  placeholder: string
  hint: string
  disabled?: boolean
  badges?: React.ReactNode
  /** Already-seen ids the bot collected, offered as one-click additions. */
  suggestions?: { id: string; note: string }[]
  /** Show the delegated "search by name" box (people lists only). */
  searchable?: boolean
  /** Show the bot-identity group search box (group lists only). */
  searchChats?: boolean
  /** id → display name. The panel shows the name and NEVER the raw id. */
  names?: Record<string, string>
  /** Shown when a name is not known yet (e.g. 未知用户 / 未知群). */
  unknownLabel?: string
  /** One-line explanation under the chips (e.g. why a name is missing). */
  note?: string
  /** Passed to the search box: re-resolve names after an authorisation. */
  onAuthChange?(state: AuthState): void
  onChange(next: string[]): void
}) {
  const [text, setText] = useState('')
  const bad = malformedIds(ids, prefix)
  const fresh = (suggestions ?? []).filter((row) => !ids.includes(row.id)).slice(0, 8)

  const commit = () => {
    const parsed = parseIds(text, prefix)
    if (parsed.length > 0) onChange(parsed.reduce(addId, ids))
    setText('')
  }

  return (
    <Field label={label} hint={hint} badges={badges}>
      {searchable ? (
        <DirectorySearchBox
          disabled={disabled}
          onPick={(person) => onChange(addId(ids, person.openId))}
          {...(onAuthChange ? { onAuthChange } : {})}
        />
      ) : null}
      {searchChats ? (
        <GroupSearchBox
          disabled={disabled}
          onPick={(chat) => onChange(addId(ids, chat.chatId))}
        />
      ) : null}
      <input
        className={cls.input}
        value={text}
        aria-label={`${label}（粘贴 id 后回车）`}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter and comma both commit, so "paste a comma-separated line"
          // becomes rows without the user having to think about it.
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
      />
      {ids.length > 0 ? (
        <div className={cls.chips}>
          {ids.map((id) => {
            const name = names?.[id]
            const ok = idFormatOk(id, prefix)
            return (
              <span
                key={id}
                className={cls.chip}
                data-tone={ok ? undefined : 'warning'}
                // The id stays reachable on hover: the person configuring this
                // never needs to read it, but support/debugging sometimes does.
                title={id}
              >
                {name ? (
                  <span className={cls.chipName}>{name}</span>
                ) : (
                  <span className={cls.chipName} data-tone="unknown">
                    {unknownLabel}
                  </span>
                )}
                <button
                  type="button"
                  className={cls.chipX}
                  aria-label={`移除 ${name ?? id}`}
                  disabled={disabled}
                  onClick={() => onChange(removeId(ids, id))}
                >
                  ✕
                </button>
              </span>
            )
          })}
        </div>
      ) : null}
      {bad.length > 0 ? (
        <p className={cls.invalid}>
          ⚠ 有 {bad.length} 个不是 {prefix} 开头（{bad.map((id) => shortId(id)).join('、')}），保存了也不会生效
        </p>
      ) : null}
      {note ? <p className={cls.suggestLabel}>{note}</p> : null}
      {fresh.length > 0 ? (
        <div className={cls.suggest}>
          <span className={cls.suggestLabel}>机器人见过的人，点一下加入：</span>
          {fresh.map((row) => (
            <button
              key={row.id}
              type="button"
              className={cls.chip}
              title={row.id}
              disabled={disabled}
              onClick={() => onChange(addId(ids, row.id))}
            >
              <span className={cls.chipName}>{names?.[row.id] ?? unknownLabel}</span>
              <span className={cls.suggestNote}>{row.note}</span>
            </button>
          ))}
        </div>
      ) : null}
    </Field>
  )
}

/**
 * Search the directory **as the person configuring this**.
 *
 * Feishu's `search/v1/user` is user-token only, so this runs on a delegated token
 * obtained through the Device Flow (no redirect URL, no callback listener). The
 * `open_id` it returns is this app's namespace — the same value the allowlist
 * stores — which is the whole reason it is worth the extra authorisation: the
 * bot's own 通讯录 scope sees one person, the person's own sees the company.
 */
function DirectorySearchBox({
  disabled,
  onPick,
  onAuthChange,
}: {
  disabled?: boolean
  onPick(person: { openId: string; name: string }): void
  /** Fired on every auth-state read, so the caller can re-resolve names. */
  onAuthChange?(state: AuthState): void
}) {
  const [auth, setAuth] = useState<AuthState>({ authorized: false })
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundPerson[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  const refresh = () => {
    fetch(authUrl('state'))
      .then((response) => response.json())
      .then((payload) => {
        const parsed = parseAuth(payload)
        setAuth(parsed)
        onAuthChange?.(parsed)
      })
      .catch(() => undefined)
  }
  useEffect(() => {
    refresh()
  }, [])

  // While a code is on screen, poll every few seconds: Feishu rate-limits
  // polling, and the panel only needs to notice "confirmed" within a breath.
  useEffect(() => {
    if (!auth.pending) return
    const timer = setInterval(() => {
      fetch(authUrl('poll'))
        .then((response) => response.json())
        .then((payload) => {
          const parsed = parseAuth(payload)
          setAuth(parsed)
          // A freshly authorised token is exactly when names become resolvable:
          // without this the chips kept showing the placeholder until a reload.
          onAuthChange?.(parsed)
        })
        .catch(() => undefined)
    }, 4000)
    return () => clearInterval(timer)
  }, [auth.pending?.userCode])

  const begin = async () => {
    setBusy(true)
    setNote(undefined)
    try {
      const response = await fetch(authUrl('begin'))
      setAuth(parseAuth(await response.json()))
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    await fetch(authUrl('forget'))
    setAuth({ authorized: false })
    setFound([])
  }

  const search = async () => {
    if (!query.trim()) return
    setBusy(true)
    setNote(undefined)
    try {
      const response = await fetch(searchUrl(query))
      const payload = await response.json()
      const parsed = parseFound(payload)
      setFound(parsed.people)
      if (parsed.error) {
        setNote(parsed.error)
        // A token error means the host's state changed under us: re-read it so
        // the box can offer 重新授权 instead of failing the next query too.
        refresh()
      } else if (parsed.people.length === 0) setNote('没搜到人。换个关键词试试，或者直接粘贴 open_id。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cls.auth}>
      {auth.pending ? (
        <div className={cls.authPending}>
          <span>
            在飞书里确认授权：<strong className={cls.authCode}>{auth.pending.userCode}</strong>
          </span>
          <a
            className="fc-link"
            href={auth.pending.verificationUriComplete}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开授权页 →
          </a>
          <span className={cls.suggestLabel}>等待确认…（这个码 10 分钟内有效）</span>
        </div>
      ) : auth.needAuth ? (
        // The token is dead and cannot be refreshed. Saying so beats a search box
        // that answers every query with a token error (2026-11-10).
        <div className={cls.authRow}>
          <span className={cls.suggestLabel}>
            授权已过期{auth.userName ? `（${auth.userName}）` : ''}，需要重新授权一次；
            已缓存的人名不受影响。
          </span>
          <button type="button" className={cls.ghost} disabled={disabled || busy} onClick={() => void begin()}>
            {busy ? '准备中…' : '重新授权'}
          </button>
          <button type="button" className={cls.reset} disabled={disabled} onClick={() => void forget()}>
            断开
          </button>
        </div>
      ) : auth.authorized ? (
        <div className={cls.authRow}>
          <input
            className={cls.input}
            value={query}
            placeholder="输入姓名搜索通讯录，回车"
            aria-label="按姓名搜索通讯录"
            spellCheck={false}
            disabled={disabled || busy}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void search()
              }
            }}
          />
          <button
            type="button"
            className={cls.ghost}
            disabled={disabled || busy || !query.trim()}
            onClick={() => void search()}
          >
            {busy ? '搜索中…' : '搜索'}
          </button>
          <button type="button" className={cls.reset} disabled={disabled} onClick={() => void forget()}>
            {auth.userName ? `已授权为 ${auth.userName} · 断开` : '断开授权'}
          </button>
        </div>
      ) : (
        <div className={cls.authRow}>
          <span className={cls.suggestLabel}>
            机器人看不到通讯录（应用可见范围只有个别人），但可以用<strong>你自己的身份</strong>搜人。
          </span>
          <button type="button" className={cls.ghost} disabled={disabled || busy} onClick={() => void begin()}>
            {busy ? '准备中…' : '用我的身份搜索通讯录'}
          </button>
        </div>
      )}
      {found.length > 0 ? (
        <div className={cls.suggest}>
          {found.map((person) => (
            <button
              key={person.openId}
              type="button"
              className={cls.chip}
              // Name only: the panel never shows a raw id (2026-11-10). The id
              // stays on the tooltip for support/debugging.
              title={person.openId}
              disabled={disabled}
              onClick={() => onPick(person)}
            >
              <span className={cls.chipName}>{person.name}</span>
              <span className={cls.suggestNote}>点一下加入</span>
            </button>
          ))}
        </div>
      ) : null}
      {note ? <p className={cls.invalid}>{note}</p> : null}
      {auth.error ? <p className={cls.invalid}>{auth.error}</p> : null}
    </div>
  )
}

/**
 * Search the groups the BOT can see, by name.
 *
 * `im/v1/chats/search` runs on the bot's own identity, so unlike the people
 * search this needs no delegation and never expires with one. Adding a group by
 * hand used to mean pasting an `oc_…` id copied out of a payload — the user asked
 * for the same convenience the people list has (2026-11-10).
 */
function GroupSearchBox({
  disabled,
  onPick,
}: {
  disabled?: boolean
  onPick(chat: FoundChat): void
}) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundChat[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  const runSearch = async (text: string) => {
    setBusy(true)
    setNote(undefined)
    try {
      const response = await fetch(chatSearchUrl(text))
      const parsed = parseFoundChats(await response.json())
      setFound(parsed.chats)
      if (parsed.error) setNote(parsed.error)
      else if (parsed.chats.length === 0 && text.trim()) {
        setNote('没搜到群。机器人只能搜到「自己在的群」，先把它拉进群再试。')
      }
    } catch (error) {
      setNote(`搜索失败：${String(error).slice(0, 160)}`)
    } finally {
      setBusy(false)
    }
  }

  // Open with the bot's own chat list: a picker that starts empty makes the
  // person guess a keyword they do not know (2026-11-10).
  useEffect(() => {
    void runSearch('')
  }, [])

  return (
    <div className={cls.auth}>
      <div className={cls.authRow}>
        <input
          className={cls.input}
          value={query}
          placeholder="输入群名称搜索，回车"
          aria-label="按名称搜索群"
          spellCheck={false}
          disabled={disabled || busy}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void runSearch(query)
            }
          }}
        />
        <button
          type="button"
          className={cls.ghost}
          disabled={disabled || busy || !query.trim()}
          onClick={() => void runSearch(query)}
        >
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>
      {found.length > 0 ? (
        <div className={cls.suggest}>
          {found.map((chat) => (
            <button
              key={chat.chatId}
              type="button"
              className={cls.chip}
              title={chat.chatId}
              disabled={disabled}
              onClick={() => onPick(chat)}
            >
              <span className={cls.chipName}>{chat.name}</span>
              <span className={cls.suggestNote}>点一下加入</span>
            </button>
          ))}
        </div>
      ) : null}
      {note ? <p className={cls.invalid}>{note}</p> : null}
    </div>
  )
}

/* --------------------------------------------------------------------- page */
/**
 * The page as the Plugins manager asks for it. Split from {@link SettingsPage}
 * so the summary/loading/unavailable paths never run the form's hooks.
 */
function SettingsCard({ ownForm, form: hostForm, useSecretConfigured, view }: CardProps) {
  const snapshot = useForm(ownForm)
  const value = snapshot.value

  // The bundle title area renders this one-liner; the detail page the form.
  if (view === 'summary') {
    return <div className="text-sm opacity-70">飞书机器人接入：白名单、流式卡片、底部状态行</div>
  }
  if (snapshot.status === 'loading') return <div className="p-4 text-sm opacity-60">加载中…</div>
  if (snapshot.status === 'unavailable' || !value) {
    return (
      <div className="p-4 text-sm opacity-60">
        插件未启用或宿主未暴露配置（entry id：<code>{PLUGIN_ID}</code>）。
      </div>
    )
  }
  return (
    <SettingsPage
      snapshot={snapshot}
      value={value}
      hostForm={hostForm}
      ownForm={ownForm}
      secretSet={useSecretConfigured ? useSecretConfigured(PLUGIN_ID) : false}
    />
  )
}

function SettingsPage({
  snapshot,
  value,
  hostForm,
  ownForm,
  secretSet,
}: {
  snapshot: ReturnType<CardProps['ownForm']['getSnapshot']>
  value: FeishuCardConfig
  hostForm?: HostForm
  ownForm: CardProps['ownForm']
  secretSet: boolean
}) {
  // `saved` follows the host snapshot; `edits` holds what was typed since. A
  // field the host changed elsewhere (another window, a patch reload) shows
  // through unless it has a local edit on top.
  const saved = useMemo(() => draftFrom(value), [value])
  const [edits, setEdits] = useState<Partial<Draft>>({})
  const draft: Draft = { ...saved, ...edits }
  const dirty = isDirty(draft, saved)
  const overridden = overriddenFields(snapshot)
  const writable = snapshot.writable !== false
  const disabled = !writable

  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [savedNote, setSavedNote] = useState<string | undefined>(undefined)
  // The Host's model catalog, for the one dropdown that replaced the
  // provider/id pair. Fetched once: adapters register at startup.
  const [catalog, setCatalog] = useState<ModelCatalog>({ choices: [] })

  useEffect(() => {
    let alive = true
    fetch(MODELS_PATH)
      .then((response) => response.json())
      .then((payload) => {
        if (alive) setCatalog(parseModels(payload))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // People/chats the bot has already heard from — the one shortcut source that
  // needs no Feishu permission, and whose ids are already this app's.
  const [recentSeen, setRecentSeen] = useState<RecentSnapshot>({ people: [], chats: [] })

  useEffect(() => {
    let alive = true
    const load = () => {
      fetch(RECENT_PATH)
        .then((response) => response.json())
        .then((payload) => {
          if (alive) setRecentSeen(parseRecent(payload))
        })
        .catch(() => undefined)
    }
    load()
    // Refresh while the page is open, so a message that arrives in Feishu
    // shows up here without reopening the panel.
    const timer = setInterval(load, 15_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // id → 显示名 for every chip on this page: people (delegated token) AND groups
  // (bot token). The panel never shows a raw id (2026-11-10), so this has to
  // cover the suggestions row too — otherwise "点一下加入" would be a row of ou_…
  // The Host caches both kinds on disk, so this stays cheap after the first ask.
  const [names, setNames] = useState<Record<string, string>>({})
  /** True once a names answer has landed, so the "unresolved" note cannot flash. */
  const [namesReady, setNamesReady] = useState(false)
  /** Bumped when the delegated authorisation changes, to re-resolve names. */
  const [namesEpoch, setNamesEpoch] = useState(0)
  const nameIds = [
    ...draft.allowlist,
    ...draft.groupSenderAllowlist,
    ...draft.groupAllowlist,
    ...recentSeen.people.map((row) => row.openId),
    ...recentSeen.chats.map((row) => row.chatId),
  ]
    .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index)
    .slice(0, 60)
    .join(',')
  /** Why some names could not be resolved (authorisation vs. scope). */
  const [namesError, setNamesError] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!nameIds) {
      setNames({})
      setNamesReady(true)
      return
    }
    let alive = true
    setNamesReady(false)
    fetch(namesUrl(nameIds.split(',')))
      .then((response) => response.json())
      .then((payload) => {
        if (!alive) return
        setNames(parseNames(payload))
        setNamesError(
          typeof (payload as { error?: unknown }).error === 'string'
            ? ((payload as { error: string }).error ?? undefined)
            : undefined,
        )
        setNamesReady(true)
      })
      .catch(() => {
        if (alive) setNamesReady(true)
      })
    return () => {
      alive = false
    }
  }, [nameIds, namesEpoch])

  /**
   * 「有几个 id 解析不出名字」 — either the delegation is dead (the Host says so)
   * or the person is outside the app's contact scope, which is a data-permission
   * fact the user can act on. Said in words because the panel deliberately never
   * prints the id.
   */
  const unresolved = (ids: string[]): string | undefined => {
    if (!namesReady) return undefined
    const missing = ids.filter((id) => id && !names[id]).length
    if (missing === 0) return undefined
    if (namesError) return namesError
    return `有 ${missing} 个名字解析不出来（可能不在应用可见范围内），鼠标悬停可以看到对应 id。`
  }

  const mutate = async (ops: PathOp[]): Promise<boolean> => {
    const target = hostForm ?? ownForm
    return target.mutate(ops, snapshot.revision)
  }
  const set = <K extends keyof Draft>(key: K, next: Draft[K]) => {
    setSavedNote(undefined)
    setEdits((previous) => ({ ...previous, [key]: next }))
  }

  const save = async () => {
    if (!dirty || saving) return
    const ops = saveOps(draft, saved)
    setSaving(true)
    setFailed(false)
    const ok = ops.length === 0 ? true : await mutate(ops)
    setSaving(false)
    if (ok) {
      setEdits({})
      setSavedNote('已保存')
    } else {
      setFailed(true)
    }
  }

  const discard = () => {
    setEdits({})
    setFailed(false)
    setSavedNote(undefined)
  }

  const resetField = async (field: keyof Draft) => {
    setSavedNote(undefined)
    const ok = await mutate([resetOp(field)])
    if (ok) {
      setEdits((previous) => {
        const next = { ...previous }
        delete next[field]
        return next
      })
    } else {
      setFailed(true)
    }
  }

  // `secretSet` is read from the describe mirror, not the form snapshot: the
  // client's ConfigForm drops the host's secret positions (see
  // useSecretConfigured), which made this badge always say 未配置.
  const showAllowlist = draft.dmPolicy === 'allowlist'
  const showGroups = draft.groupPolicy === 'allowlist'

  // The dropdown's selected value; '' means "follow the host default".
  const modelRoute = modelRouteOf(draft.provider, draft.model)
  const choices = catalog.choices
  const fallbackLabel = catalog.fallback
    ? `${catalog.fallback.provider}/${catalog.fallback.model}`
    : undefined
  const modelHint =
    choices.length > 0
      ? `留空跟随默认模型${fallbackLabel ? `（${fallbackLabel}）` : ''}`
      : (catalog.error ?? '没有可选的模型，请手动填写模型 id')
  const modelError = choices.length > 0 ? undefined : catalog.error

  /** 已覆盖 badge + 恢复默认, the host's own per-field override affordance. */
  const badge = (field: keyof Draft) =>
    overridden.has(field) ? (
      <>
        <Tag tone="neutral">已覆盖</Tag>
        <button
          type="button"
          className={cls.reset}
          disabled={disabled}
          onClick={() => void resetField(field)}
        >
          恢复默认
        </button>
      </>
    ) : null

  return (
    <div className={cls.form}>
      <Section title="连接">
        <Field label="App ID" htmlFor="feishu-app-id" badges={badge('appId')}>
          <input
            id="feishu-app-id"
            className={cls.input}
            value={draft.appId}
            placeholder="cli_ 开头"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => set('appId', event.target.value)}
          />
        </Field>
        <Field
          label="App Secret"
          htmlFor="feishu-app-secret"
          hint="留空表示不修改已保存的密钥"
          badges={
            <>
              {secretSet ? <Tag tone="success">已保存密钥</Tag> : <Tag tone="quiet">未配置</Tag>}
              {badge('appSecret')}
            </>
          }
        >
          <input
            id="feishu-app-secret"
            className={cls.input}
            type="password"
            autoComplete="new-password"
            value={draft.appSecret}
            placeholder={secretSet ? '已保存' : '粘贴 App Secret'}
            disabled={disabled}
            onChange={(event) => set('appSecret', event.target.value)}
          />
        </Field>
        <Field label="版本" badges={badge('brand')}>
          <Segmented
            label="版本"
            value={draft.brand}
            options={BRAND_OPTIONS}
            disabled={disabled}
            onChange={(next) => set('brand', next)}
          />
        </Field>
      </Section>

      <Section title="访问控制">
        <Field label="私聊策略" badges={badge('dmPolicy')}>
          <Segmented
            label="私聊策略"
            value={draft.dmPolicy}
            options={DM_OPTIONS}
            disabled={disabled}
            onChange={(next) => set('dmPolicy', next)}
          />
        </Field>
        {showAllowlist ? (
          <IdListField
            label="允许的人"
            ids={draft.allowlist}
            prefix="ou_"
            placeholder="粘贴 open_id，回车加入；逗号、空格、连着写都能认"
            hint="open_id 按应用隔离，同一个人在不同应用下不一样。不会取可以让 agent 代劳，它能按姓名从飞书查到。"
            disabled={disabled}
            badges={badge('allowlist')}
            searchable
            names={names}
            unknownLabel="未知用户"
            note={unresolved(draft.allowlist)}
            onAuthChange={(state) => {
              // Newly authorised (or re-authorised) → the names are reachable
              // again; asking now is what turns 未知用户 into 张三 without a reload.
              if (state.authorized) setNamesEpoch((value) => value + 1)
            }}
            suggestions={recentSeen.people.map((row) => ({
              id: row.openId,
              note: `${agoText(row.at)}${row.count > 1 ? ` · ${row.count} 条` : ''}`,
            }))}
            onChange={(next) => set('allowlist', next)}
          />
        ) : null}
        <Field label="群聊策略" badges={badge('groupPolicy')}>
          <Segmented
            label="群聊策略"
            value={draft.groupPolicy}
            options={GROUP_OPTIONS}
            disabled={disabled}
            onChange={(next) => set('groupPolicy', next)}
          />
        </Field>
        {showGroups ? (
          <>
            <IdListField
              label="允许的群"
              ids={draft.groupAllowlist}
              prefix="oc_"
              placeholder="粘贴 chat_id，回车加入；逗号、空格、连着写都能认"
              hint="chat_id 是 oc_ 开头的一串字符。可以让 agent 从群消息报文里取（message.chat_id）。"
              disabled={disabled}
              badges={badge('groupAllowlist')}
              names={names}
              unknownLabel="未知群"
              note={unresolved(draft.groupAllowlist)}
              searchChats
              suggestions={recentSeen.chats.map((row) => ({ id: row.chatId, note: agoText(row.at) }))}
              onChange={(next) => set('groupAllowlist', next)}
            />
            <IdListField
              label="群里只响应这些人（可选）"
              ids={draft.groupSenderAllowlist}
              prefix="ou_"
              placeholder="不填就是群里所有人都可以"
              hint="填了就只有名单内的人能跟机器人说话。ou_ 开头的 open_id。"
              disabled={disabled}
              badges={badge('groupSenderAllowlist')}
              names={names}
              unknownLabel="未知用户"
              suggestions={recentSeen.people.map((row) => ({
                id: row.openId,
                note: agoText(row.at),
              }))}
              onChange={(next) => set('groupSenderAllowlist', next)}
            />
          </>
        ) : null}
        <ToggleRow
          label="群里需要 @机器人 才响应"
          checked={draft.requireMentionInGroups}
          disabled={disabled}
          onChange={(next) => set('requireMentionInGroups', next)}
        />
        <ToggleRow
          label="@所有人 也算提及"
          hint="关闭时，@所有人 不会触发机器人（推荐关闭）"
          checked={draft.respondToMentionAll}
          disabled={disabled}
          onChange={(next) => set('respondToMentionAll', next)}
        />
        <Field
          label="别人/其它机器人的消息"
          hint="默认忽略，避免两个机器人互相触发死循环"
          badges={badge('allowBots')}
        >
          <Segmented
            label="机器人消息策略"
            value={draft.allowBots}
            options={BOT_OPTIONS}
            disabled={disabled}
            onChange={(next) => set('allowBots', next)}
          />
        </Field>
      </Section>

      <Section title="会话与回复">
        <Field label="会话粒度" hint="哪几条消息算同一个上下文" badges={badge('sessionScope')}>
          <Segmented
            label="会话粒度"
            value={draft.sessionScope}
            options={SCOPE_OPTIONS}
            disabled={disabled}
            onChange={(next) => set('sessionScope', next)}
          />
        </Field>
        <Field label="回复模式" badges={badge('replyMode')}>
          <Segmented
            label="回复模式"
            value={draft.replyMode}
            options={MODE_OPTIONS}
            disabled={disabled}
            onChange={(next) => set('replyMode', next)}
          />
        </Field>
        <Field
          label="默认工作目录"
          htmlFor="feishu-workspace"
          hint="留空则会话不属于任何工作区，Harness 里点不开它的历史"
          badges={badge('defaultWorkspace')}
        >
          <input
            id="feishu-workspace"
            className={cls.input}
            value={draft.defaultWorkspace}
            placeholder="例如 D:\workspace"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => set('defaultWorkspace', event.target.value)}
          />
        </Field>
        <Field
          label="模型"
          htmlFor="feishu-model"
          hint={modelHint}
          badges={badge('model')}
        >
          {choices.length > 0 ? (
            <span className="fc-selectWrap">
              <select
                id="feishu-model"
                className={cls.input}
                value={modelRoute}
                disabled={disabled}
                onChange={(event) => {
                  const route = decodeModelRoute(event.target.value)
                  if (!route) {
                    set('provider', '')
                    set('model', '')
                    return
                  }
                  set('provider', route.provider)
                  set('model', route.model)
                }}
              >
                <option value="">跟随默认模型{fallbackLabel ? `（${fallbackLabel}）` : ''}</option>
                {choices.map((choice) => (
                  <option
                    key={`${choice.provider}\u0000${choice.model}`}
                    value={`${choice.provider}\u0000${choice.model}`}
                  >
                    {choice.provider}/{choice.model}
                    {choice.label && choice.label !== choice.model ? ` · ${choice.label}` : ''}
                  </option>
                ))}
              </select>
              <span aria-hidden="true" className="fc-selectArrow">
                ▾
              </span>
            </span>
          ) : (
            <>
              <input
                id="feishu-model"
                className={cls.input}
                value={draft.model}
                placeholder="例如 auto/step-5-preview"
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                onChange={(event) => set('model', event.target.value)}
              />
              {modelError ? <p className={cls.invalid}>{modelError}</p> : null}
            </>
          )}
        </Field>
      </Section>

      <Section title="过程面板">
        <ToggleRow
          label="显示模型的思考过程"
          hint="打开后卡片里会出现「🧠 …」，长回合能看到它在想什么；会多刷几次卡片"
          checked={draft.showReasoning}
          disabled={disabled}
          onChange={(next) => set('showReasoning', next)}
        />
        <ToggleRow
          label="回合结束后保持面板展开"
          hint="关闭时答案占满整张卡片（hermes 默认行为）"
          checked={draft.panelExpanded}
          disabled={disabled}
          onChange={(next) => set('panelExpanded', next)}
        />
        <Field
          label="单回合超时（毫秒）"
          htmlFor="feishu-timeout"
          hint="超过就取消这一轮并封卡，避免它一直跑；默认 600000（10 分钟）"
          badges={badge('turnTimeoutMs')}
        >
          <input
            id="feishu-timeout"
            className={cls.input}
            type="number"
            min={30000}
            step={30000}
            value={String(draft.turnTimeoutMs)}
            disabled={disabled}
            onChange={(event) => set('turnTimeoutMs', Number(event.target.value) || 0)}
          />
        </Field>
      </Section>

      <Section title="底部状态行">
        <Field label="显示哪些内容" badges={badge('footerFields')}>
          <div className={cls.toggles}>
            {FOOTER_FIELDS.map((field) => {
              const on = draft.footerFields.includes(field)
              return (
                <button
                  key={field}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => set('footerFields', toggleFooterField(draft.footerFields, field))}
                >
                  <Tag tone={on ? 'info' : 'quiet'}>
                    {on ? '✓ ' : ''}
                    {FIELD_LABELS[field]}
                  </Tag>
                </button>
              )
            })}
          </div>
        </Field>
        <Field
          label="刷新间隔（毫秒）"
          htmlFor="feishu-flush"
          hint="流式卡片更新的最小间隔，太小容易撞飞书的频率限制"
          badges={badge('flushIntervalMs')}
        >
          <input
            id="feishu-flush"
            className={cls.input}
            type="number"
            min={200}
            step={100}
            value={String(draft.flushIntervalMs)}
            disabled={disabled}
            onChange={(event) => set('flushIntervalMs', Number(event.target.value) || 0)}
          />
        </Field>
      </Section>

      <div className={cls.footer}>
        {failed ? (
          <p className={cls.failed} role="status">
            没有保存成功，请再点一次「保存」。
          </p>
        ) : null}
        {!failed && savedNote ? <Tag tone="success">{savedNote}</Tag> : null}
        <span style={{ flex: 1 }} />
        {dirty ? (
          <button type="button" className={cls.ghost} onClick={discard} disabled={saving}>
            放弃更改
          </button>
        ) : null}
        <button
          type="button"
          className={cls.save}
          onClick={() => void save()}
          disabled={!dirty || saving || disabled}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {!writable ? (
        <p className={cls.hint} role="status" style={{ paddingTop: 12 }}>
          当前 profile 不接受表单写入（只读），请编辑 profile patch。
        </p>
      ) : null}
    </div>
  )
}


