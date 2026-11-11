/**
 * The receipt reaction, in both of its states.
 *
 * 2026-11-09: 收到消息要有回复的表情 → an "on it" emoji on the user's message.
 * 2026-11-10: 回复完成之后改成 DONE → the receipt is replaced when the answer
 * lands, and removed when the turn failed.
 *
 * The interesting behaviour is the failure path (a missing scope, a recalled
 * message, a rate limit must never cost the turn) and the replacement order
 * (add the new emoji BEFORE deleting the old one, so the message never blinks).
 */
import { describe, expect, it } from 'vitest'
import { ACK_EMOJI, DONE_EMOJI, FeishuReactor } from './reaction.ts'

function makeReactor(
  over: {
    create?: (id: string, emoji: string) => Promise<unknown>
    remove?: (id: string, reactionId: string) => Promise<unknown>
  } = {},
) {
  const calls: { kind: 'add' | 'remove'; messageId: string; value: string }[] = []
  const warnings: string[] = []
  let nextId = 0
  const reactor = new FeishuReactor({
    appId: 'cli_test',
    appSecret: 'secret',
    brand: 'feishu',
    logger: { warn: (message) => warnings.push(message) },
    create:
      over.create ??
      (async (messageId, emoji) => {
        calls.push({ kind: 'add', messageId, value: emoji })
        nextId += 1
        return { data: { reaction_id: `re_${nextId}` } }
      }),
    remove:
      over.remove ??
      (async (messageId, reactionId) => {
        calls.push({ kind: 'remove', messageId, value: reactionId })
        return { code: 0 }
      }),
  })
  return { reactor, calls, warnings }
}

describe('FeishuReactor.ack', () => {
  it('reacts with the "on it" emoji (not a check mark: the work just started)', async () => {
    const { reactor, calls } = makeReactor()
    await expect(reactor.ack('om_1')).resolves.toBe(true)
    expect(calls).toEqual([{ kind: 'add', messageId: 'om_1', value: ACK_EMOJI }])
    expect(ACK_EMOJI).toBe('OnIt')
  })

  it('never reacts twice to the same message', async () => {
    const { reactor } = makeReactor()
    await reactor.ack('om_1')
    await expect(reactor.ack('om_1')).resolves.toBe(false)
  })

  it('swallows a Feishu failure: a receipt must never cost the answer', async () => {
    const { reactor, warnings } = makeReactor({
      create: async () => {
        throw new Error('code=99991672 no permission')
      },
    })
    await expect(reactor.ack('om_1')).resolves.toBe(false)
    expect(warnings.join(' ')).toContain('reaction')
    expect(warnings.join(' ')).toContain('99991672')
  })

  it('ignores an empty message id', async () => {
    const { reactor, calls } = makeReactor()
    await expect(reactor.ack('')).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})

describe('FeishuReactor.settle', () => {
  it('removes the old receipt BEFORE adding the new one', async () => {
    // User preference 2026-11-11: the two states must never coexist, not even
    // for the instant an add-first order leaves them side by side.
    const { reactor, calls } = makeReactor()
    await reactor.ack('om_1')
    await expect(reactor.settle('om_1')).resolves.toBe(true)
    expect(calls.map((call) => `${call.kind}:${call.value}`)).toEqual([
      'add:OnIt',
      'remove:re_1',
      'add:DONE',
    ])
    expect(reactor.placedEmoji('om_1')).toBe(DONE_EMOJI)
  })

  it('is a no-op when the message already carries DONE', async () => {
    const { reactor, calls } = makeReactor()
    await reactor.ack('om_1')
    await reactor.settle('om_1')
    const before = calls.length
    await reactor.settle('om_1')
    expect(calls).toHaveLength(before)
  })

  it('still lands DONE on a message whose ack failed earlier', async () => {
    let first = true
    const { reactor, calls } = makeReactor({
      create: async (messageId, emoji) => {
        if (first) {
          first = false
          throw new Error('code=99991672')
        }
        calls.push({ kind: 'add', messageId, value: emoji })
        return { data: { reaction_id: 're_9' } }
      },
    })
    await reactor.ack('om_1')
    await expect(reactor.settle('om_1')).resolves.toBe(true)
    expect(calls).toEqual([{ kind: 'add', messageId: 'om_1', value: 'DONE' }])
  })

  it('puts the old receipt back when the final emoji cannot be added', async () => {
    // Remove-first means a failed add leaves the message bare, so the previous
    // receipt is restored best-effort.
    let failedDone = false
    const { reactor, calls } = makeReactor({
      create: async (messageId, emoji) => {
        if (emoji === DONE_EMOJI && !failedDone) {
          failedDone = true
          throw new Error('rate limited')
        }
        calls.push({ kind: 'add', messageId, value: emoji })
        return { data: { reaction_id: emoji === ACK_EMOJI ? 're_1' : 're_2' } }
      },
    })
    await reactor.ack('om_1')
    await expect(reactor.settle('om_1')).resolves.toBe(false)
    expect(calls.map((call) => `${call.kind}:${call.value}`)).toEqual([
      'add:OnIt',
      'remove:re_1',
      'add:OnIt',
    ])
    expect(reactor.placedEmoji('om_1')).toBe(ACK_EMOJI)
  })
})

describe('FeishuReactor.clear', () => {
  it('removes the receipt (a failed turn must not claim done)', async () => {
    const { reactor, calls } = makeReactor()
    await reactor.ack('om_1')
    await expect(reactor.clear('om_1')).resolves.toBe(true)
    expect(calls.at(-1)).toEqual({ kind: 'remove', messageId: 'om_1', value: 're_1' })
    expect(reactor.placedEmoji('om_1')).toBeUndefined()
  })

  it('is a no-op when no reaction id is known', async () => {
    const { reactor, calls } = makeReactor({
      create: async () => ({ code: 0 }),
    })
    await reactor.ack('om_1')
    await expect(reactor.clear('om_1')).resolves.toBe(false)
    expect(calls.filter((call) => call.kind === 'remove')).toEqual([])
  })

  it('swallows a failed delete', async () => {
    const { reactor, warnings } = makeReactor({
      remove: async () => {
        throw new Error('code=230002 message not found')
      },
    })
    await reactor.ack('om_1')
    await expect(reactor.clear('om_1')).resolves.toBe(false)
    expect(warnings.join(' ')).toContain('230002')
  })
})