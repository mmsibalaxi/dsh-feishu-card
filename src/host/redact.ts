/**
 * Secret masking for outbound Feishu cards — a pure, dependency-free last line
 * of defence before model/tool text reaches a whole group.
 *
 * Why this exists: tool output (env dumps, `git remote -v`, config files, curl
 * commands) routinely carries credentials, and a card posted to a group is
 * archived and searchable. The caller decides WHEN to run this (e.g. only for
 * group chats); this module knows nothing about chats, I/O or configuration.
 *
 * Placeholder format: `⟨已打码·<label>⟩`. Only four well-known FAMILY prefixes
 * are kept — `sk-`, `gh[pousr]_`, `AKIA`, `cli_` — because they tell the reader
 * WHAT leaked without exposing any of the remaining entropy. Longer prefixes
 * (`github_pat_`, `xoxb-`, `AIza`) are masked whole: a uniform 3–4 character
 * allowlist is easier to audit for accidental leaks than a per-vendor list.
 * The same reasoning makes the e-mail rule keep the domain (that is routing
 * information the reader needs) while masking the entire local part.
 *
 * Correctness notes:
 * - every pattern is global and applied with a FUNCTION replacement, so `$&`
 *   or `$1` inside matched text can never be expanded into the output;
 * - the placeholder contains no ASCII key material, so a second pass cannot
 *   nest placeholders (the rules simply do not match their own output);
 * - a non-string value is blanked defensively instead of coerced: this sits on
 *   the card-send path, where throwing would lose the whole reply.
 */

/** A rule that masks one class of secret. */
export interface RedactRule {
  /** Stable id used in trace lines and tests. */
  readonly id: string
  /** Human label shown in the panel's "what was masked" hint (Chinese). */
  readonly label: string
  /** Global regex; every match is replaced by mask(). */
  readonly pattern: RegExp
}

/** Result of one pass. */
export interface Redacted {
  /** Text with every hit replaced. Unchanged text is returned as-is by identity check. */
  readonly text: string
  /** Rule ids that fired, deduplicated, in rule order. */
  readonly hits: readonly string[]
}

/** Internal rule: public shape plus the renderer that builds its placeholder. */
interface MaskableRule extends RedactRule {
  /** Replacement text for one match; `captures` holds the regex groups. */
  readonly mask: (match: string, captures: readonly string[]) => string
}

/** Build the visible mask token for one label. */
const placeholder = (label: string): string => `⟨已打码·${label}⟩`

/**
 * Mask, but keep the family prefix that says WHICH credential leaked. The
 * prefix itself carries no secret worth protecting and is capped at 4 chars.
 */
const familyMask = (prefix: string, label: string): string => `${prefix}${placeholder(label)}`

/*
 * Patterns are hoisted: a quick scan of the const block is the auditable list
 * of what this module can touch. All are `g` because `replace` walks every hit.
 */

/** PEM private key of any flavour: RSA/EC/OPENSSH/ENCRYPTED/PGP. */
const RE_PRIVATE_KEY =
  /-----BEGIN [^\n]*PRIVATE KEY[^\n]*-----[\s\S]*?-----END [^\n]*PRIVATE KEY[^\n]*-----/g

/** Feishu app id: `cli_` plus exactly 16 lowercase alphanumerics. */
const RE_FEISHU_APP_ID = /(?<![A-Za-z0-9_])cli_[a-z0-9]{16}(?![A-Za-z0-9_])/g

/**
 * `app_secret` / `appSecret` assignments of a 24+ character literal that also
 * contains a digit (real Feishu secrets are mixed alphanumeric). The key part
 * is captured so the card still shows which field leaked.
 */
const RE_FEISHU_APP_SECRET =
  /(\bapp_?secret\b["']?\s*[:=]\s*["']?)(?=[A-Za-z0-9+/=_-]*\d)([A-Za-z0-9+/=_-]{24,})/gi

/** JWT: three base64url segments, the first starting with the `eyJ` header. */
const RE_JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])/g

/** GitHub classic token; the prefix (`ghp_`, `gho_`, …) is the family signal. */
const RE_GITHUB_TOKEN = /\b(gh[pousr]_)[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g

/** GitHub fine-grained token. */
const RE_GITHUB_PAT = /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])/g

/** OpenAI (and compatible) keys, including `sk-proj-…` / `sk-ant-…`. */
const RE_OPENAI_KEY = /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g

/** AWS access key id: `AKIA` plus 16 uppercase alphanumerics. */
const RE_AWS_KEY = /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])/g

/** Slack token, all historical families: xoxb/xoxa/xoxp/xoxr/xoxs. */
const RE_SLACK_TOKEN = /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])/g

/** Google API key: `AIza` plus exactly 35 url-safe characters. */
const RE_GOOGLE_API_KEY = /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g

/** Database / broker connection strings whose userinfo carries credentials. */
const RE_DATABASE_URL =
  /(?<![A-Za-z0-9+.-])(mysql|postgresql|postgres|redis|rediss|mongodb\+srv|mongodb|mssql|amqp):\/\/([^\s:@/]*):([^\s@/]+)@([^\s/]+)/gi

/** Any other scheme with embedded userinfo credentials. */
const RE_URL_CREDENTIALS =
  /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]{1,15}):\/\/([^\s:@/]*):([^\s@/]+)@([^\s/]+)/g

/** `Bearer <token>`, the most common transport wrapper for keys. */
const RE_BEARER = /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/gi

/** `authorization: [Scheme] <token>` header. */
const RE_AUTHORIZATION =
  /\b(authorization[ \t]*:[ \t]*)(?:(Bearer|Basic|Token|Digest)[ \t]+)?([A-Za-z0-9._~+/=-]{8,})/gi

/**
 * Private IPv4 only: 10/8, 172.16/12 and 192.168/16. The dotted lookarounds
 * keep a four-octet prefix from matching inside a longer dotted run, and the
 * ranges deliberately exclude loopback (127.0.0.1) and public addresses.
 */
const RE_PRIVATE_IPV4 =
  /(?<![\d.])(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(?![\d.])/g

/** Mainland Chinese mobile number, outside any longer alphanumeric run. */
const RE_CN_PHONE = /(?<![0-9A-Za-z_])1[3-9]\d{9}(?![0-9A-Za-z_])/g

/** E-mail address; the local part is the secret, the domain is kept. */
const RE_EMAIL =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g

/**
 * Rules run most-specific first, so a secret gets the most informative label:
 * a JWT inside `Bearer` is a JWT, a credential inside `postgres://` is a database
 * connection string, and an API key inside `Authorization:` stays an API key.
 */
const RULES: readonly MaskableRule[] = [
  {
    id: 'private-key',
    label: '私钥',
    pattern: RE_PRIVATE_KEY,
    mask: () => placeholder('私钥'),
  },
  {
    id: 'feishu-app-secret',
    label: '飞书 App Secret',
    pattern: RE_FEISHU_APP_SECRET,
    // Keep `"app_secret": "` so the reader knows which field to rotate.
    mask: (_match, captures) => `${captures[0] ?? ''}${placeholder('飞书 App Secret')}`,
  },
  {
    id: 'feishu-app-id',
    label: '飞书 App ID',
    pattern: RE_FEISHU_APP_ID,
    mask: () => familyMask('cli_', '飞书 App ID'),
  },
  {
    id: 'jwt',
    label: 'JWT 令牌',
    pattern: RE_JWT,
    mask: () => placeholder('JWT 令牌'),
  },
  {
    id: 'github-pat',
    label: 'GitHub 细粒度令牌',
    pattern: RE_GITHUB_PAT,
    mask: () => placeholder('GitHub 细粒度令牌'),
  },
  {
    id: 'github-token',
    label: 'GitHub 令牌',
    pattern: RE_GITHUB_TOKEN,
    mask: (_match, captures) => familyMask(captures[0] ?? 'ghp_', 'GitHub 令牌'),
  },
  {
    id: 'openai-key',
    label: 'API Key',
    pattern: RE_OPENAI_KEY,
    mask: () => familyMask('sk-', 'API Key'),
  },
  {
    id: 'aws-key',
    label: 'AWS 访问密钥',
    pattern: RE_AWS_KEY,
    mask: () => familyMask('AKIA', 'AWS 访问密钥'),
  },
  {
    id: 'slack-token',
    label: 'Slack 令牌',
    pattern: RE_SLACK_TOKEN,
    mask: () => placeholder('Slack 令牌'),
  },
  {
    id: 'google-api-key',
    label: 'Google API 密钥',
    pattern: RE_GOOGLE_API_KEY,
    mask: () => placeholder('Google API 密钥'),
  },
  {
    id: 'database-url',
    label: '数据库连接串',
    pattern: RE_DATABASE_URL,
    // Keep scheme and host: the reader still needs to know WHICH database.
    mask: (_match, captures) =>
      `${captures[0] ?? 'mysql'}://${placeholder('数据库连接串')}@${captures[3] ?? ''}`,
  },
  {
    id: 'url-credentials',
    label: 'URL 凭据',
    pattern: RE_URL_CREDENTIALS,
    mask: (_match, captures) =>
      `${captures[0] ?? ''}://${placeholder('URL 凭据')}@${captures[3] ?? ''}`,
  },
  {
    id: 'bearer-token',
    label: '访问令牌',
    pattern: RE_BEARER,
    mask: () => `Bearer ${placeholder('访问令牌')}`,
  },
  {
    id: 'authorization-header',
    label: 'Authorization 头',
    pattern: RE_AUTHORIZATION,
    // Keep header name and auth scheme (`Basic`), mask the value.
    mask: (_match, captures) =>
      `${captures[0] ?? 'authorization: '}${captures[1] ? `${captures[1]} ` : ''}${placeholder('Authorization 头')}`,
  },
  {
    id: 'private-ipv4',
    label: '内网 IP',
    pattern: RE_PRIVATE_IPV4,
    mask: () => placeholder('内网 IP'),
  },
  {
    id: 'phone-cn',
    label: '手机号',
    pattern: RE_CN_PHONE,
    mask: () => placeholder('手机号'),
  },
  {
    id: 'email',
    label: '邮箱',
    pattern: RE_EMAIL,
    // Keep the domain; the local part is the identifying secret.
    mask: (_match, captures) => `${placeholder('邮箱')}@${captures[1] ?? ''}`,
  },
]

/** The public rule table, in evaluation order. Extra renderer fields stay private. */
export const REDACT_RULES: readonly RedactRule[] = RULES

/**
 * Mask secrets in `text`.
 *
 * @param text raw model/tool text
 * @param options.enabled `false` returns the input untouched (zero-cost)
 * @returns masked text plus the ids of the rules that fired, in rule order
 */
export function redact(text: string, options: { enabled?: boolean } = {}): Redacted {
  // Defensive: a malformed projection value typed as string must not take down
  // the send path. Blanking is safer than coercing it into `[object Object]`.
  if (typeof text !== 'string' || text.length === 0) {
    return { text: typeof text === 'string' ? text : '', hits: [] }
  }
  // Disabled passes are truly zero-cost: no regex is executed at all.
  if (options?.enabled === false) return { text, hits: [] }

  const hits: string[] = []
  let output = text

  for (const rule of RULES) {
    let fired = false
    // Function replacer: a string replacement would expand `$&` / `$1` found in
    // the matched secret and corrupt the surrounding card text.
    output = output.replace(rule.pattern, (...args: unknown[]) => {
      fired = true
      const match = typeof args[0] === 'string' ? args[0] : ''
      // Callback args are match, capture groups, offset, whole string.
      const captures = args
        .slice(1, -2)
        .map((value) => (typeof value === 'string' ? value : ''))
      return rule.mask(match, captures)
    })
    if (fired && !hits.includes(rule.id)) hits.push(rule.id)
  }

  // No hits: hand the original string back instead of a needless copy.
  return hits.length === 0 ? { text, hits } : { text: output, hits }
}