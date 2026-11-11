/**
 * Live trace for the Feishu bridge.
 *
 * `ctx.logger` never reaches a CLI stdout (only the GUI log viewer sees it), so
 * a bridge failure observed from Feishu is otherwise undebuggable: the user
 * reports "no reply" and there is nothing to look at. This module appends one
 * JSON line per interesting moment to `~/.dsh/feishu-card/trace.log` and, when
 * `FEISHU_CARD_DEBUG=1`, mirrors it to stdout so a locally booted profile can
 * be watched live.
 *
 * It is deliberately tiny and failure-proof: a trace must never be the reason
 * a bridge breaks, so every write is wrapped and swallowed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const file = path.join(home, 'feishu-card', 'trace.log')

/**
 * Never trace from inside a test run.
 *
 * The suite exercises failure paths on purpose — a fake transport without
 * `createCard`, a projection registry that throws "no projections" — and those
 * lines were landing in the PRODUCTION trace next to real events. A parity audit
 * reading that file then reported 46 phantom `card-start-failed`s and 44 phantom
 * `usage-snapshot-failed`s (2026-11-10), all of them from `sessionKey: "oc_dm"`
 * fixtures. Set `FEISHU_CARD_TRACE=1` to force tracing under test.
 */
const underTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
const enabled = !underTest || process.env.FEISHU_CARD_TRACE === '1'

let counter = 0

/** Record one event. `data` must be JSON-serializable (strings/numbers/bools). */
export function trace(event: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return
  counter += 1
  const line = JSON.stringify({ t: new Date().toISOString(), n: counter, event, ...data })
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${line}\n`)
  } catch {
    // A trace failure is never worth failing a turn over.
  }
  if (process.env.FEISHU_CARD_DEBUG) console.log(`[feishu-card] ${line}`)
}

/** The trace file path, so a doctor command can print it. */
export function tracePath(): string {
  return file
}

/** Truncate the trace (used by tests and by /doctor). */
export function resetTrace(): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
  } catch {
    // ignore
  }
}
