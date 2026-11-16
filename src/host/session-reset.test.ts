/**
 * The two reset clocks, tested without waiting six hours.
 *
 * hermes resets a conversation on an idle gap and on a fixed morning hour; the
 * user asked for both (2026-11-16). The edge that matters is "which session is
 * stale", so every case pins an exact pair of timestamps.
 */
import { describe, expect, it } from 'vitest'
import {
  lastDailyBoundary,
  localDay,
  resetNotice,
  resetReason,
  type ResetPolicy,
} from './session-reset.ts'
import type { SessionRecord } from './sessions.ts'

const HOUR = 3_600_000
const OFF: ResetPolicy = { idleHours: 0, dailyHour: -1 }

/** Local time on a fixed date, without depending on the machine's zone. */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute, 0, 0).getTime()

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: 's1',
  workspace: '',
  updatedAt: at(16, 10),
  createdAt: at(16, 9),
  ...over,
})

describe('resetReason', () => {
  it('keeps the session while the policy is off', () => {
    expect(resetReason(record({ updatedAt: 0 }), OFF, at(16, 10))).toBeUndefined()
  })

  it('drops a session that has been idle for the configured gap', () => {
    const policy: ResetPolicy = { idleHours: 6, dailyHour: -1 }
    // 5h59m: still the same conversation.
    expect(resetReason(record({ updatedAt: at(16, 4, 1) }), policy, at(16, 10))).toBeUndefined()
    // 6h00m: exactly at the line, it resets.
    expect(resetReason(record({ updatedAt: at(16, 4) }), policy, at(16, 10, 0))).toBe('idle')
    // 7h
    expect(resetReason(record({ updatedAt: at(16, 3) }), policy, at(16, 10))).toBe('idle')
  })

  it('does not compare against a corrupt timestamp', () => {
    const policy: ResetPolicy = { idleHours: 6, dailyHour: -1 }
    expect(resetReason(record({ updatedAt: Number.NaN }), policy, at(16, 10))).toBeUndefined()
  })

  it('drops a session that started before the daily hour', () => {
    const policy: ResetPolicy = { idleHours: 0, dailyHour: 4 }
    // Started yesterday evening, spoke this morning before 4am.
    expect(
      resetReason(record({ createdAt: at(15, 20), updatedAt: at(16, 3) }), policy, at(16, 5)),
    ).toBe('daily')
    // Started this morning at 4:30: today's thread, keep it.
    expect(
      resetReason(record({ createdAt: at(16, 4, 30), updatedAt: at(16, 5) }), policy, at(16, 9)),
    ).toBeUndefined()
  })

  it('the daily clock only fires once the day actually turned', () => {
    const policy: ResetPolicy = { idleHours: 0, dailyHour: 4 }
    // 03:59 — the boundary is still yesterday 04:00, and the session is newer.
    expect(
      resetReason(record({ createdAt: at(16, 4, 10), updatedAt: at(16, 4, 20) }), policy, at(16, 3, 59)),
    ).toBeUndefined()
    // 04:01 — the boundary moved to today 04:00; a session from yesterday is stale.
    expect(
      resetReason(record({ createdAt: at(15, 9), updatedAt: at(15, 23) }), policy, at(16, 4, 1)),
    ).toBe('daily')
  })

  it('falls back to updatedAt for records written before createdAt existed', () => {
    const policy: ResetPolicy = { idleHours: 0, dailyHour: 4 }
    expect(
      resetReason({ sessionId: 's1', workspace: '', updatedAt: at(15, 23) }, policy, at(16, 9)),
    ).toBe('daily')
  })

  it('idle wins when both clocks would fire', () => {
    const policy: ResetPolicy = { idleHours: 2, dailyHour: 4 }
    expect(
      resetReason(record({ createdAt: at(15, 1), updatedAt: at(15, 2) }), policy, at(16, 5)),
    ).toBe('idle')
  })

  it('no record means nothing to reset', () => {
    expect(resetReason(undefined, { idleHours: 1, dailyHour: 4 }, at(16, 10))).toBeUndefined()
  })
})

describe('lastDailyBoundary / localDay', () => {
  it('returns today hour when it already passed', () => {
    expect(lastDailyBoundary(at(16, 10), 4)).toBe(at(16, 4))
  })

  it('returns yesterday hour when it has not', () => {
    expect(lastDailyBoundary(at(16, 2), 4)).toBe(at(15, 4))
  })

  it('localDay is the local calendar date', () => {
    expect(localDay(at(16, 0, 5))).toBe('2026-11-16')
    expect(localDay(at(16, 23, 55))).toBe('2026-11-16')
  })
})

describe('resetNotice', () => {
  it('says the idle gap in hours', () => {
    expect(resetNotice('idle', { idleHours: 6, dailyHour: -1 })).toContain('6 小时')
  })

  it('says sub-hour gaps in minutes', () => {
    expect(resetNotice('idle', { idleHours: 0.5, dailyHour: -1 })).toContain('30 分钟')
  })

  it('names the daily hour in HH:00', () => {
    expect(resetNotice('daily', { idleHours: 0, dailyHour: 4 })).toContain('04:00')
  })
})