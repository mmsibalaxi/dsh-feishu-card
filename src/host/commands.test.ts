import { describe, expect, it } from 'vitest'
import {
  BRIDGE_COMMANDS,
  formatAllowlist,
  formatHelp,
  formatModel,
  formatReset,
  formatStatus,
  formatStop,
  parseInput,
} from './commands.ts'
describe('parseInput', () => {
  it('recognises bridge commands', () => {
    expect(parseInput('/status')).toEqual({ command: 'status', args: [], text: '' })
    expect(parseInput('/new')).toEqual({ command: 'new', args: [], text: '' })
    expect(parseInput('/stop')).toEqual({ command: 'stop', args: [], text: '' })
    expect(parseInput('/help')).toEqual({ command: 'help', args: [], text: '' })
  })

  it('passes unknown slash commands through to the agent', () => {
    expect(parseInput('/compact 帮我压缩')).toEqual({
      args: [],
      text: '/compact 帮我压缩',
    })
  })

  it('passes plain text through', () => {
    expect(parseInput('帮我看看构建为什么失败')).toEqual({
      args: [],
      text: '帮我看看构建为什么失败',
    })
  })

  it('tolerates whitespace and case', () => {
    expect(parseInput('  /STATUS  ').command).toBeUndefined()
    expect(parseInput(' /status ').command).toBe('status')
  })

  it('never treats a lone slash as a command', () => {
    expect(parseInput('/').command).toBeUndefined()
  })

  it('exports the command list for /help', () => {
    expect(BRIDGE_COMMANDS).toEqual(['status', 'new', 'stop', 'help', 'model'])
  })
})

describe('formatStatus', () => {
  const base = {
    connected: true,
    sessionKey: 'oc_g1',
    sessionId: 's-1',
    model: 'deepseek-chat',
    dmPolicy: 'allowlist',
    allowlist: ['ou_a', 'ou_b'],
    groupPolicy: 'allowlist',
    groupAllowlist: ['oc_g1'],
    requireMentionInGroups: true,
    replyMode: 'streaming',
    sessions: 3,
  }

  it('reports the whole posture', () => {
    const text = formatStatus(base)
    expect(text).toContain('连接：已连接')
    expect(text).toContain('session：s-1')
    expect(text).toContain('模型：deepseek-chat')
    expect(text).toContain('私聊：allowlist（2 个 open_id）')
    expect(text).toContain('群聊：allowlist（1 个群）')
    expect(text).toContain('本机会话数：3')
  })

  it('says so when no session exists yet', () => {
    expect(formatStatus({ ...base, sessionId: undefined })).toContain('（尚未创建')
  })

  it('never echoes secrets', () => {
    const text = formatStatus({ ...base, allowlist: ['ou_a'] })
    expect(text).not.toContain('appSecret')
    expect(text).not.toContain('secret')
  })
})

describe('other formatters', () => {
  it('help lists every command', () => {
    const text = formatHelp()
    for (const command of BRIDGE_COMMANDS) expect(text).toContain(`/${command}`)
  })

  it('reset/stop confirmations', () => {
    expect(formatReset(true)).toContain('已结束')
    expect(formatReset(false)).toContain('没有活动会话')
    expect(formatStop(true)).toContain('已停止')
    expect(formatStop(false)).toContain('没有正在跑')
  })

  it('allowlist rendering', () => {
    expect(formatAllowlist(['ou_a', 'ou_b'])).toBe('ou_a\nou_b')
    expect(formatAllowlist([])).toBe('（空）')
  })
})

describe('formatModel', () => {
  it('reports the current model, or that none is pinned', () => {
    expect(formatModel({ provider: 'magpie', model: 'auto/step-5-preview' })).toBe(
      '当前模型：magpie/auto/step-5-preview',
    )
    expect(formatModel(undefined)).toContain('跟随默认模型')
  })

  it('confirms a well-formed switch', () => {
    expect(formatModel(undefined, 'magpie/auto-step-5-preview')).toContain(
      '已将模型切换为 magpie/auto-step-5-preview',
    )
  })

  it('rejects a malformed route instead of silently accepting it', () => {
    expect(formatModel(undefined, 'magpie')).toContain('无法解析')
    expect(formatModel(undefined, 'magpie/')).toContain('无法解析')
    expect(formatModel(undefined, '/model')).toContain('无法解析')
  })
})
