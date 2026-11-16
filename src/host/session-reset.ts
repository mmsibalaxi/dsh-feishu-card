/**
 * When a conversation should forget everything and start over.
 *
 * Users leave a chatbot for lunch and come back to an agent that still remembers
 * a thread from six hours ago, at whatever context cost that implies. hermes
 * resets on two clocks — a fixed hour each morning, and an idle gap — and the
 * user asked for the same here (2026-11-16).
 *
 * Both are pure functions of the record + the configured policy so every edge
 * (midnight crossing, DST-free local time, "never been used") is testable
 * without waiting six hours.
 */
import type { SessionRecord } from './sessions.ts'

export interface ResetPolicy {
  /** Start a new session after this many hours without a message. 0 = never. */
  idleHours: number
  /** Local wall-clock hour (0-23) at which every conversation starts over. -1 = never. */
  dailyHour: number
}

export const DEFAULT_RESET_POLICY: ResetPolicy = { idleHours: 0, dailyHour: -1 }

export type ResetReason = 'idle' | 'daily'

/** Local calendar day of an instant, as `YYYY-MM-DD`. */
export function localDay(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The most recent occurrence of `hour:00` local time at or before `now`. */
export function lastDailyBoundary(now: number, hour: number): number {
  const date = new Date(now)
  const boundary = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0)
  // Before today's hour: the boundary that matters is yesterday's.
  if (boundary.getTime() > now) boundary.setDate(boundary.getDate() - 1)
  return boundary.getTime()
}

/**
 * Why a stored session should be dropped, or `undefined` to keep it.
 *
 * @param record - the persisted session for this conversation
 * @param policy - the configured reset rules
 * @param now - current epoch ms (injectable for tests)
 * @returns the reason the conversation must start fresh
 */
export function resetReason(
  record: SessionRecord | undefined,
  policy: ResetPolicy,
  now: number = Date.now(),
): ResetReason | undefined {
  if (!record) return undefined
  if (policy.idleHours > 0) {
    const gap = now - record.updatedAt
    if (Number.isFinite(record.updatedAt) && gap >= policy.idleHours * 3_600_000) return 'idle'
  }
  if (policy.dailyHour >= 0 && policy.dailyHour <= 23) {
    // The daily clock is anchored on the FIRST message of the old session, so a
    // conversation that began after today's hour is never reset by it — only a
    // session that is actually carrying yesterday's thread is.
    const startedAt = record.createdAt ?? record.updatedAt
    const boundary = lastDailyBoundary(now, policy.dailyHour)
    if (Number.isFinite(startedAt) && startedAt < boundary) return 'daily'
  }
  return undefined
}

/** One Chinese line for the card, so the user knows why context vanished. */
export function resetNotice(reason: ResetReason, policy: ResetPolicy): string {
  if (reason === 'idle') {
    const hours = policy.idleHours >= 1 ? `${Number(policy.idleHours.toFixed(1))} 小时` : `${Math.round(policy.idleHours * 60)} 分钟`
    return `（距上次对话已超过 ${hours}，开了个新会话）`
  }
  const hour = String(policy.dailyHour).padStart(2, '0')
  return `（每天 ${hour}:00 自动开新会话）`
}