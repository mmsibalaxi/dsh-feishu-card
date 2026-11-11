import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ApprovalMemory, FeishuApprovals, buildApprovalCard } from './approvals.ts'

/** Fake card transport that records what would have been sent. */
function fakeTransport(options: { fail?: boolean } = {}) {
  const sent: { chatId: string; card: unknown }[] = []
  const updated: { cardId: string; card: unknown }[] = []
  return {
    sent,
    updated,
    async sendCard(chatId: string, card: unknown): Promise<string | undefined> {
      if (options.fail) throw new Error('cardkit unavailable')
      sent.push({ chatId, card })
      return `card_${sent.length}`
    },
    async updateCard(cardId: string, card: unknown): Promise<void> {
      updated.push({ cardId, card })
    },
  }
}

/** Dig the approval id out of the rendered buttons, the way Feishu would. */
function approvalIdOf(card: unknown): string {
  const value = buttonValue(card)
  const id = value?.approvalId
  if (typeof id !== 'string') throw new Error('no approval id in card')
  return id
}

function buttonValue(card: unknown): Record<string, unknown> | undefined {
  const elements = (card as { body?: { elements?: unknown[] } }).body?.elements ?? []
  for (const element of elements) {
    const columns = (element as { columns?: unknown[] }).columns ?? []
    for (const column of columns) {
      const children = (column as { elements?: unknown[] }).elements ?? []
      for (const child of children) {
        const behaviors = (child as { behaviors?: { value?: Record<string, unknown> }[] }).behaviors
        if (behaviors?.[0]?.value) return behaviors[0].value
      }
    }
  }
  return undefined
}

/** Click one of the card's buttons. */
function click(action: 'once' | 'always' | 'deny', approvalId: string): unknown {
  return { action: { value: { feishuCardApproval: 'decide', approvalId, action } } }
}

const NEVER = () => Promise.resolve('unavailable' as const)

/** Wait until `condition` holds; the prompt posts its card synchronously-ish. */
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('ApprovalMemory', () => {
  it('remembers a grant and expires it', () => {
    let now = 1_000
    const memory = new ApprovalMemory({ ttlMs: 100, now: () => now })
    expect(memory.allowed('oc_a', 'shell')).toBe(false)
    memory.remember('oc_a', 'shell')
    expect(memory.allowed('oc_a', 'shell')).toBe(true)
    // Scoped to the chat: the same tool in another group is not granted.
    expect(memory.allowed('oc_b', 'shell')).toBe(false)
    now += 101
    expect(memory.allowed('oc_a', 'shell')).toBe(false)
  })

  it('persists across instances and forgets on demand', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feishu-approvals-'))
    const file = path.join(dir, 'approvals.json')
    const first = new ApprovalMemory({ file })
    first.remember('oc_a', 'shell')
    first.remember('oc_a', 'write')

    const second = new ApprovalMemory({ file })
    expect(second.allowed('oc_a', 'shell')).toBe(true)
    expect(second.list()).toHaveLength(2)

    expect(second.forgetAll()).toBe(2)
    const stored = JSON.parse(await readFile(file, 'utf8')) as { grants?: unknown[] }
    // The file is rewritten, not just emptied in memory: a restart must not
    // resurrect a grant the user revoked.
    expect(stored.grants).toEqual([])
    expect(new ApprovalMemory({ file }).allowed('oc_a', 'shell')).toBe(false)
  })

  it('treats an unreadable file as no grants', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feishu-approvals-'))
    const file = path.join(dir, 'broken.json')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, '{ not json', 'utf8')
    const memory = new ApprovalMemory({ file })
    expect(memory.allowed('oc_a', 'shell')).toBe(false)
  })
})

describe('buildApprovalCard', () => {
  it('names the tool, shows the reason and offers three buttons', () => {
    const card = buildApprovalCard({ id: 'apr_1', toolName: 'shell', reason: '要执行 rm -rf' })
    const text = JSON.stringify(card)
    expect(text).toContain('shell')
    expect(text).toContain('要执行 rm -rf')
    expect(text).toContain('允许一次')
    expect(text).toContain('本群总是允许')
    expect(text).toContain('拒绝')
  })

  it('masks a secret quoted in the reason', () => {
    const card = buildApprovalCard({
      id: 'apr_1',
      toolName: 'shell',
      reason: 'curl -H "Authorization: Bearer abcdef0123456789abcdef" https://x',
    })
    const text = JSON.stringify(card)
    expect(text).not.toContain('abcdef0123456789abcdef')
    expect(text).toContain('已打码')
  })

  it('says plainly that tool arguments are not available', () => {
    const card = buildApprovalCard({ id: 'apr_1', toolName: 'shell' })
    expect(JSON.stringify(card)).toContain('拿不到工具参数')
  })

  it('drops the buttons once settled', () => {
    const card = buildApprovalCard({ id: 'apr_1', toolName: 'shell' }, { settled: 'deny' })
    expect(buttonValue(card)).toBeUndefined()
    expect(JSON.stringify(card)).toContain('已拒绝')
  })
})

describe('FeishuApprovals', () => {
  it('delegates a request for an agent it does not own', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    let delegated = 0
    const outcome = await approvals.handleRequest({ agent: { id: 'other' }, toolName: 'shell' }, () => {
      delegated += 1
      return Promise.resolve('unavailable')
    })
    expect(outcome).toBe('unavailable')
    expect(delegated).toBe(1)
    expect(transport.sent).toHaveLength(0)
  })

  it('answers allowed-once without a card when the chat already trusts the tool', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    approvals.memory.remember('oc_a', 'shell')
    const outcome = await approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell' }, NEVER)
    expect(outcome).toBe('allowed-once')
    expect(transport.sent).toHaveLength(0)
  })

  it('posts a card and maps a click to the outcome', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    const pending = approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell', reason: 'rm' }, NEVER)
    await until(() => transport.sent.length === 1, 'the approval card')
    const card = transport.sent[0]?.card
    expect(transport.sent[0]?.chatId).toBe('oc_a')

    const response = await approvals.handleCardAction(click('deny', approvalIdOf(card)))
    expect(response?.toast?.content).toContain('已拒绝')
    expect(await pending).toBe('rejected')
    // The card is redrawn so the same buttons cannot be pressed twice.
    expect(transport.updated).toHaveLength(1)
  })

  it('a second click on the same prompt is ignored', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    const pending = approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell' }, NEVER)
    await until(() => transport.sent.length === 1, 'the approval card')
    const id = approvalIdOf(transport.sent[0]?.card)
    await approvals.handleCardAction(click('once', id))
    expect(await approvals.handleCardAction(click('once', id))).toBeUndefined()
    expect(await pending).toBe('allowed-once')
  })

  it('"always" grants the tool for the chat and answers allowed-once', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    const pending = approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell' }, NEVER)
    await until(() => transport.sent.length === 1, 'the approval card')
    await approvals.handleCardAction(click('always', approvalIdOf(transport.sent[0]?.card)))
    expect(await pending).toBe('allowed-once')
    expect(approvals.memory.allowed('oc_a', 'shell')).toBe(true)
    expect(approvals.memory.allowed('oc_b', 'shell')).toBe(false)
  })

  it('times out to cancelled and settles the card', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport, timeoutMs: 30 })
    approvals.bind('sess', 'oc_a')
    expect(await approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell' }, NEVER)).toBe(
      'cancelled',
    )
    expect(transport.updated).toHaveLength(1)
  })

  it('a withdrawn request settles cancelled', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    const controller = new AbortController()
    const pending = approvals.handleRequest(
      { agent: { id: 'sess' }, toolName: 'shell', signal: controller.signal },
      NEVER,
    )
    await until(() => transport.sent.length === 1, 'the approval card')
    controller.abort()
    expect(await pending).toBe('cancelled')
  })

  it('delegates when the card cannot be sent, so the GUI can still ask', async () => {
    const transport = fakeTransport({ fail: true })
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    let delegated = 0
    const outcome = await approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell' }, () => {
      delegated += 1
      return Promise.resolve('rejected')
    })
    expect(outcome).toBe('rejected')
    expect(delegated).toBe(1)
  })

  it('dispose answers every pending prompt with cancelled', async () => {
    const transport = fakeTransport()
    const approvals = new FeishuApprovals({ transport })
    approvals.bind('sess', 'oc_a')
    const pending = approvals.handleRequest({ agent: { id: 'sess' }, toolName: 'shell' }, NEVER)
    await until(() => transport.sent.length === 1, 'the approval card')
    expect(approvals.pendingCount).toBe(1)
    approvals.dispose()
    expect(await pending).toBe('cancelled')
    expect(approvals.pendingCount).toBe(0)
  })
})