import { describe, expect, it } from 'vitest'
import { decideAccess, type AccessRequest } from './access.ts'
import { CONFIG_DEFAULTS, parseIdList, formatIdList } from '../shared/types.ts'

const base = {
  dmPolicy: 'allowlist',
  allowlist: [] as string[],
  groupPolicy: 'allowlist',
  groupAllowlist: [] as string[],
  requireMentionInGroups: true,
  respondToMentionAll: false,
  allowBots: 'none',
} as const

const dm = (over: Partial<AccessRequest> = {}): AccessRequest => ({
  chatType: 'p2p',
  chatId: 'oc_dm',
  senderOpenId: 'ou_a',
  mentioned: true,
  mentionAllOnly: false,
  ...over,
})

const group = (over: Partial<AccessRequest> = {}): AccessRequest => ({
  ...dm(),
  chatType: 'group',
  chatId: 'oc_g1',
  mentioned: true,
  ...over,
})

describe('parseIdList', () => {
  it('splits lines, drops comments and blanks, de-duplicates', () => {
    expect(parseIdList('# 白名单\n\nou_a\nou_b\nou_a\n')).toEqual(['ou_a', 'ou_b'])
  })

  it('tolerates pasted "@张三 (ou_xxx)" and comma separated values', () => {
    expect(parseIdList('ou_a, ou_b\nou_c')).toEqual(['ou_a', 'ou_b', 'ou_c'])
  })

  it('round-trips through formatIdList', () => {
    const ids = parseIdList('ou_a\nou_b')
    expect(parseIdList(formatIdList(ids))).toEqual(ids)
  })
})

describe('decideAccess — 私聊', () => {
  it('allowlist 策略 + 空名单 = 谁都不放行（fail-closed）', () => {
    expect(decideAccess(dm(), base)).toEqual({ allowed: false, reason: 'dm-not-allowed' })
  })

  it('名单内的 open_id 放行', () => {
    const config = { ...base, allowlist: ['ou_a'] }
    expect(decideAccess(dm(), config).allowed).toBe(true)
  })

  it('名单外的人被拒', () => {
    const config = { ...base, allowlist: ['ou_b'] }
    expect(decideAccess(dm(), base)).toEqual({ allowed: false, reason: 'dm-not-allowed' })
    expect(decideAccess(dm(), config)).toEqual({ allowed: false, reason: 'dm-not-allowed' })
  })

  it('dmPolicy=disabled 一律拒绝', () => {
    const config = { ...base, dmPolicy: 'disabled' as const, allowlist: ['ou_a'] }
    expect(decideAccess(dm(), config)).toEqual({ allowed: false, reason: 'dm-disabled' })
  })

  it('dmPolicy=open 且 sender 名单为空 → 放行', () => {
    const config = { ...base, dmPolicy: 'open' as const }
    expect(decideAccess(dm(), config).allowed).toBe(true)
  })

  it('dmPolicy=open 就是任何人（残留的名单不再偷偷拦截）', () => {
    // The panel hides 允许的人 when the policy is not 白名单, so a leftover list
    // used to mute DMs with no visible reason. `open` now really means open.
    const config = { ...base, dmPolicy: 'open' as const, allowlist: ['ou_b'] }
    expect(decideAccess(dm(), config).allowed).toBe(true)
  })
})

describe('decideAccess — 群聊', () => {
  it('未在白名单的群 → 静默拒绝', () => {
    const config = { ...base, allowlist: ['ou_a'], groupAllowlist: ['oc_g2'] }
    expect(decideAccess(group(), config)).toEqual({ allowed: false, reason: 'group-not-allowed' })
  })

  it('群白名单命中 + sender 名单命中 → 放行', () => {
    const config = { ...base, allowlist: ['ou_a'], groupAllowlist: ['oc_g1'] }
    expect(decideAccess(group(), config).allowed).toBe(true)
  })

  it('群命中时，私聊名单不再约束群内发言人', () => {
    // The regression this replaces: adding yourself to the DM allowlist muted
    // every colleague in an allowed group, silently.
    const config = { ...base, allowlist: ['ou_b'], groupAllowlist: ['oc_g1'] }
    expect(decideAccess(group(), config).allowed).toBe(true)
  })

  it('可选的群内发言人名单：填了就只放行名单内的人', () => {
    const strict = { ...base, groupAllowlist: ['oc_g1'], groupSenderAllowlist: ['ou_a'] }
    expect(decideAccess(group(), strict).allowed).toBe(true)
    expect(decideAccess(group({ senderOpenId: 'ou_other' }), strict)).toEqual({
      allowed: false,
      reason: 'sender-not-allowed',
    })
  })

  it('群内发言人名单为空 = 不限制', () => {
    const config = { ...base, groupAllowlist: ['oc_g1'], groupSenderAllowlist: [] }
    expect(decideAccess(group({ senderOpenId: 'ou_anyone' }), config).allowed).toBe(true)
  })

  it('groupPolicy=disabled 一律拒绝', () => {
    const config = { ...base, allowlist: ['ou_a'], groupPolicy: 'disabled' as const }
    expect(decideAccess(group(), config)).toEqual({ allowed: false, reason: 'group-disabled' })
  })

  it('groupPolicy=open + sender 名单为空 → 任何群放行', () => {
    const config = { ...base, allowlist: ['ou_a'], groupPolicy: 'open' as const }
    expect(decideAccess(group({ chatId: 'oc_anything' }), config).allowed).toBe(true)
  })

  it('群消息未 @机器人 → 拒绝（即使群和人都在名单里）', () => {
    const config = { ...base, allowlist: ['ou_a'], groupAllowlist: ['oc_g1'] }
    expect(decideAccess(group({ mentioned: false }), config)).toEqual({
      allowed: false,
      reason: 'mention-required',
    })
  })

  it('requireMentionInGroups=false 时不要求 @', () => {
    const config = {
      ...base,
      allowlist: ['ou_a'],
      groupAllowlist: ['oc_g1'],
      requireMentionInGroups: false,
    }
    expect(decideAccess(group({ mentioned: false }), config).allowed).toBe(true)
  })

  it('@所有人 默认不算提及；respondToMentionAll=true 时算', () => {
    const strict = { ...base, allowlist: ['ou_a'], groupAllowlist: ['oc_g1'] }
    expect(decideAccess(group({ mentioned: false, mentionAllOnly: true }), strict)).toEqual({
      allowed: false,
      reason: 'mention-required',
    })
    const loose = { ...strict, respondToMentionAll: true }
    expect(decideAccess(group({ mentioned: false, mentionAllOnly: true }), loose).allowed).toBe(true)
  })

  it('私聊不受提及规则影响', () => {
    const config = { ...base, allowlist: ['ou_a'] }
    expect(decideAccess(dm({ mentioned: false }), config).allowed).toBe(true)
  })
})

describe('bot-sender gate (hermes default: drop all app traffic)', () => {
  it('drops app/bot senders by default, even on the open policy', () => {
    const config = { ...base, dmPolicy: 'open' as const }
    expect(decideAccess(dm({ fromBot: true }), config)).toEqual({
      allowed: false,
      reason: 'bot-sender',
    })
  })

  it('lets bot traffic through when allowBots=all', () => {
    const config = { ...base, dmPolicy: 'open' as const, allowBots: 'all' as const }
    expect(decideAccess(dm({ fromBot: true }), config).allowed).toBe(true)
  })

  it('allowBots=mentions only lets mentioned bots through', () => {
    const config = { ...base, dmPolicy: 'open' as const, allowBots: 'mentions' as const }
    expect(decideAccess(dm({ fromBot: true, mentioned: false }), config).allowed).toBe(false)
    expect(decideAccess(dm({ fromBot: true, mentioned: true }), config).allowed).toBe(true)
  })

  it('normal users are unaffected', () => {
    const config = { ...base, dmPolicy: 'open' as const }
    expect(decideAccess(dm({ fromBot: false }), config).allowed).toBe(true)
  })
})

describe('CONFIG_DEFAULTS', () => {
  it('默认 fail-closed：两个 allowlist 都为空', () => {
    expect(CONFIG_DEFAULTS.allowlist).toEqual([])
    expect(CONFIG_DEFAULTS.groupAllowlist).toEqual([])
    expect(CONFIG_DEFAULTS.dmPolicy).toBe('allowlist')
    expect(CONFIG_DEFAULTS.groupPolicy).toBe('allowlist')
  })
})
