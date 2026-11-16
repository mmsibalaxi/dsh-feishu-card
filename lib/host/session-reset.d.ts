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
import type { SessionRecord } from './sessions.ts';
export interface ResetPolicy {
    /** Start a new session after this many hours without a message. 0 = never. */
    idleHours: number;
    /** Local wall-clock hour (0-23) at which every conversation starts over. -1 = never. */
    dailyHour: number;
}
export declare const DEFAULT_RESET_POLICY: ResetPolicy;
export type ResetReason = 'idle' | 'daily';
/** Local calendar day of an instant, as `YYYY-MM-DD`. */
export declare function localDay(at: number): string;
/** The most recent occurrence of `hour:00` local time at or before `now`. */
export declare function lastDailyBoundary(now: number, hour: number): number;
/**
 * Why a stored session should be dropped, or `undefined` to keep it.
 *
 * @param record - the persisted session for this conversation
 * @param policy - the configured reset rules
 * @param now - current epoch ms (injectable for tests)
 * @returns the reason the conversation must start fresh
 */
export declare function resetReason(record: SessionRecord | undefined, policy: ResetPolicy, now?: number): ResetReason | undefined;
/** One Chinese line for the card, so the user knows why context vanished. */
export declare function resetNotice(reason: ResetReason, policy: ResetPolicy): string;
