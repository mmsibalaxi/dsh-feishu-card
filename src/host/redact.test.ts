import { describe, expect, it } from 'vitest'
import { REDACT_RULES, redact } from './redact.ts'

/*
 * Fixtures are assembled from harmless fragments at runtime. Nothing below is
 * a real credential, and no complete key/token literal appears in this file.
 */
const KEY_BODY = 'MIIEowIBAAKCAQEA' + 'AbCdEf0123456789'.repeat(2)
const PRIVATE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  KEY_BODY,
  '-----END RSA PRIVATE KEY-----',
].join('\n')

const JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIx' + 'MjM0NTY3ODkw',
  'c'.repeat(43),
].join('.')

const APP_SECRET = ['Zx9Qw8Er', '7Ty6Ui5O', 'p4As3Df2', 'Gh1Jk0Lm'].join('')
const APP_ID = 'cli_' + 'a1b2c3d4' + 'e5f6a7b8'
const CHAT_ID = 'oc_' + 'a1b2c3d4' + 'e5f6a7b8'
const OPEN_ID = 'ou_' + '1234567890' + 'abcdef'

const OPENAI_KEY = 'sk-' + 'proj-' + 'a1B2c3D4e5F6g7H8' + 'i9J0k1L2'
const OPENAI_KEY_2 = 'sk-' + 'proj-' + 'q7W8e9R0t1Y2' + 'u3I4o5P6'
const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8' + 'i9J0k1L2m3N4'
const GITHUB_PAT = 'github_pat_' + 'a1B2c3D4e5F6g7H8' + 'i9J0k1L2m3N4'
const AWS_KEY = 'AKIA' + 'ABCDEFG' + 'HIJKLMNOP'
const SLACK_TOKEN = 'xoxb-' + '1234567890' + '-' + 'abcdefghij'
const GOOGLE_KEY = 'AIza' + 'a'.repeat(35)

const DB_PASSWORD = 's3cr3t' + 'Pass456'
const URL_PASSWORD = 'p4ss' + 'w0rdZz'
const BEARER_TOKEN = 'abcDEF' + '1234567890'
const BASIC_TOKEN = 'dXNlcjpwYXNz' + 'd29yZA=='
const CN_PHONE = '1' + '38' + '0013' + '8000'
const EMAIL = 'alice.wang' + '@' + 'example.com'

describe('redact — 规则逐条', () => {
  it('私钥块整体打码，公钥不动', () => {
    const out = redact(PRIVATE_KEY)
    expect(out.text).toBe('⟨已打码·私钥⟩')
    expect(out.hits).toEqual(['private-key'])

    const publicKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----'
    expect(redact(publicKey)).toEqual({ text: publicKey, hits: [] })
  })

  it('飞书 App ID 保留 cli_ 家族前缀，oc_/ou_ 不受影响', () => {
    const out = redact(`app_id: ${APP_ID}`)
    expect(out.text).toBe('app_id: cli_⟨已打码·飞书 App ID⟩')
    expect(out.hits).toEqual(['feishu-app-id'])

    const chat = `chat_id: ${CHAT_ID}`
    expect(redact(chat).hits).toEqual([])
    expect(redact(chat).text).toBe(chat)
  })

  it('飞书 App Secret 的 JSON / camelCase 赋值都打码，短字面量不动', () => {
    const json = `{"app_secret":"${APP_SECRET}"}`
    const jsonOut = redact(json)
    expect(jsonOut.text).toBe('{"app_secret":"⟨已打码·飞书 App Secret⟩"}')
    expect(jsonOut.hits).toEqual(['feishu-app-secret'])

    const ts = `const appSecret = "${APP_SECRET}"`
    expect(redact(ts).text).toBe('const appSecret = "⟨已打码·飞书 App Secret⟩"')

    // Too short, and a long value without any digit, are not treated as secrets.
    const short = '{"app_secret":"local-dev"}'
    expect(redact(short).text).toBe(short)
    const wordy = '{"app_secret":"local-development-placeholder"}'
    expect(redact(wordy).text).toBe(wordy)
  })

  it('JWT 三段落打码，缺段不误伤', () => {
    const out = redact(`token=${JWT}`)
    expect(out.text).toBe('token=⟨已打码·JWT 令牌⟩')
    expect(out.hits).toEqual(['jwt'])

    const fragment = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx'
    expect(redact(fragment).text).toBe(fragment)
  })

  it('GitHub 经典令牌保留家族前缀', () => {
    const out = redact(GITHUB_TOKEN)
    expect(out.text).toBe('ghp_⟨已打码·GitHub 令牌⟩')
    expect(out.hits).toEqual(['github-token'])

    const short = 'ghp_short'
    expect(redact(short).text).toBe(short)
  })

  it('GitHub 细粒度令牌整体打码', () => {
    const out = redact(GITHUB_PAT)
    expect(out.text).toBe('⟨已打码·GitHub 细粒度令牌⟩')
    expect(out.hits).toEqual(['github-pat'])

    const short = 'github_pat_short'
    expect(redact(short).text).toBe(short)
  })

  it('OpenAI 风格 sk- 密钥保留前缀，普通单词不误伤', () => {
    const out = redact(`key=${OPENAI_KEY}`)
    expect(out.text).toBe('key=sk-⟨已打码·API Key⟩')
    expect(out.hits).toEqual(['openai-key'])

    expect(redact('sk-short').text).toBe('sk-short')
    expect(redact('task-oriented').text).toBe('task-oriented')
  })

  it('AWS access key 保留 AKIA 前缀', () => {
    const out = redact(AWS_KEY)
    expect(out.text).toBe('AKIA⟨已打码·AWS 访问密钥⟩')
    expect(out.hits).toEqual(['aws-key'])

    const short = 'AKIA123'
    expect(redact(short).text).toBe(short)
  })

  it('Slack 令牌整体打码', () => {
    const out = redact(SLACK_TOKEN)
    expect(out.text).toBe('⟨已打码·Slack 令牌⟩')
    expect(out.hits).toEqual(['slack-token'])

    const short = 'xoxb-12345'
    expect(redact(short).text).toBe(short)
  })

  it('Google API key 长度必须精确', () => {
    const out = redact(GOOGLE_KEY)
    expect(out.text).toBe('⟨已打码·Google API 密钥⟩')
    expect(out.hits).toEqual(['google-api-key'])

    // One character short is a version-ish identifier, not a key.
    const short = GOOGLE_KEY.slice(0, -1)
    expect(redact(short).text).toBe(short)
  })

  it('数据库连接串保留协议与主机，无凭据的普通串不动', () => {
    for (const scheme of ['mysql', 'postgres', 'redis', 'mongodb']) {
      const connection = `${scheme}://app_user:${DB_PASSWORD}@db.internal:5432/main`
      const out = redact(connection)
      expect(out.text).toBe(`${scheme}://⟨已打码·数据库连接串⟩@db.internal:5432/main`)
      expect(out.hits).toEqual(['database-url'])
    }

    const plain = 'postgres://localhost:5432/main'
    expect(redact(plain).text).toBe(plain)
  })

  it('URL 内置凭据只打码 userinfo', () => {
    const out = redact(`https://alice:${URL_PASSWORD}@example.com/path`)
    expect(out.text).toBe('https://⟨已打码·URL 凭据⟩@example.com/path')
    expect(out.hits).toEqual(['url-credentials'])

    const plain = 'https://example.com/path?x=1'
    expect(redact(plain).text).toBe(plain)
  })

  it('Bearer 令牌整体打码，短值不动', () => {
    const out = redact(
      `curl -H "Authorization: Bearer ${BEARER_TOKEN}" https://api.example.com`,
    )
    expect(out.text).toBe(
      'curl -H "Authorization: Bearer ⟨已打码·访问令牌⟩" https://api.example.com',
    )
    expect(out.hits).toEqual(['bearer-token'])

    expect(redact('Bearer short').text).toBe('Bearer short')
  })

  it('Authorization 头保留认证方案，只遮值', () => {
    const out = redact(`Authorization: Basic ${BASIC_TOKEN}`)
    expect(out.text).toBe('Authorization: Basic ⟨已打码·Authorization 头⟩')
    expect(out.hits).toEqual(['authorization-header'])

    const negative = 'authorization: none'
    expect(redact(negative).text).toBe(negative)
  })

  it('只打码私有 IPv4，loopback 与公网地址保真', () => {
    for (const address of ['10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.10']) {
      const out = redact(`内网 ${address} 可达`)
      expect(out.text).toBe('内网 ⟨已打码·内网 IP⟩ 可达')
      expect(out.hits).toEqual(['private-ipv4'])
    }

    for (const address of ['127.0.0.1', '8.8.8.8', '172.32.0.1', '192.169.1.1']) {
      const text = `地址 ${address}`
      expect(redact(text).text).toBe(text)
    }
  })

  it('中文手机号不匹配更长数字串', () => {
    const out = redact(`联系电话 ${CN_PHONE}`)
    expect(out.text).toBe('联系电话 ⟨已打码·手机号⟩')
    expect(out.hits).toEqual(['phone-cn'])

    const order = '订单号 213800138000123'
    expect(redact(order).text).toBe(order)
    const date = '日期 2026-11-11'
    expect(redact(date).text).toBe(date)
  })

  it('邮箱只遮本地部分，域名保留', () => {
    const out = redact(`联系 ${EMAIL} 即可`)
    expect(out.text).toBe('联系 ⟨已打码·邮箱⟩@example.com 即可')
    expect(out.hits).toEqual(['email'])

    const pkg = '@larksuiteoapi/node-sdk'
    expect(redact(pkg).text).toBe(pkg)
  })

  it('飞书 chat id / open id / npm 包名不误伤', () => {
    const text = `chat ${CHAT_ID} user ${OPEN_ID} pkg @larksuiteoapi/node-sdk @deepseek-ai/cordis`
    const out = redact(text)
    expect(out.text).toBe(text)
    expect(out.hits).toEqual([])
  })
})

describe('redact — 幂等与边界', () => {
  const mixed = [
    `app_id: ${APP_ID}`,
    `app_secret: "${APP_SECRET}"`,
    `jwt: ${JWT}`,
    `api: ${OPENAI_KEY}`,
    `db: postgres://app:${DB_PASSWORD}@db.internal:5432/main`,
    `webhook: https://user:${URL_PASSWORD}@hooks.example.com/x`,
    `Authorization: Basic ${BASIC_TOKEN}`,
    `phone: ${CN_PHONE}`,
    'ip: 192.168.1.10',
    `mail: ${EMAIL}`,
  ].join('\n')

  it('重复执行不会嵌套占位符', () => {
    const once = redact(mixed)
    expect(once.hits.length).toBeGreaterThan(0)
    expect(once.text).not.toContain('⟨已打码·⟨')
    expect(once.text).not.toContain(APP_SECRET)
    expect(once.text).not.toContain(CN_PHONE)

    const twice = redact(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.hits).toEqual([])
  })

  it('enabled=false 原样返回，且不执行任何规则', () => {
    const out = redact(mixed, { enabled: false })
    expect(out.text).toBe(mixed)
    expect(out.hits).toEqual([])
  })

  it('没有命中时原样返回', () => {
    const prose = '这是一段普通说明，没有密钥。'
    expect(redact(prose)).toEqual({ text: prose, hits: [] })
    expect(redact('')).toEqual({ text: '', hits: [] })
  })

  it('非字符串输入不抛错（发送路径防御）', () => {
    expect(redact(null as unknown as string)).toEqual({ text: '', hits: [] })
    expect(redact(undefined as unknown as string)).toEqual({ text: '', hits: [] })
    expect(redact(42 as unknown as string)).toEqual({ text: '', hits: [] })
    expect(redact({} as unknown as string)).toEqual({ text: '', hits: [] })
  })

  it('hits 去重并按规则顺序排列', () => {
    const text = `${OPENAI_KEY} 与 ${OPENAI_KEY_2}，电话 ${CN_PHONE}`
    const out = redact(text)
    expect(out.hits).toEqual(['openai-key', 'phone-cn'])
    expect((out.text.match(/⟨已打码·API Key⟩/g) ?? []).length).toBe(2)
    expect(out.text).not.toContain(CN_PHONE)
  })

  it('保留 markdown 结构、普通正文与无密钥的代码块', () => {
    const doc = [
      '# 部署说明',
      '',
      '普通中文正文，含版本 1.2.3、日期 2026-11-11，路径 C:\\work\\repo\\src\\index.ts。',
      '',
      '```ts',
      `const chatId = '${CHAT_ID}'`,
      `const openId = '${OPEN_ID}'`,
      "const pkg = '@larksuiteoapi/node-sdk'",
      'const answer = 42',
      '```',
      '',
      '- **要点**：`code` 与 [链接](https://example.com/docs) 保持原样。',
    ].join('\n')
    const out = redact(doc)
    expect(out.text).toBe(doc)
    expect(out.hits).toEqual([])
  })
})

describe('REDACT_RULES', () => {
  it('每条规则的 id 唯一、pattern 为全局、label 非空', () => {
    const ids = REDACT_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of REDACT_RULES) {
      expect(rule.pattern.global).toBe(true)
      expect(rule.label.length).toBeGreaterThan(0)
    }
  })

  it('覆盖需求里的全部秘密类别', () => {
    expect(new Set(REDACT_RULES.map((rule) => rule.id))).toEqual(
      new Set([
        'private-key',
        'feishu-app-secret',
        'feishu-app-id',
        'jwt',
        'github-pat',
        'github-token',
        'openai-key',
        'aws-key',
        'slack-token',
        'google-api-key',
        'database-url',
        'url-credentials',
        'bearer-token',
        'authorization-header',
        'private-ipv4',
        'phone-cn',
        'email',
      ]),
    )
  })
})