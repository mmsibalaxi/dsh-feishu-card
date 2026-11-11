/**
 * Markdown safety for Feishu cards — a faithful port of the user's
 * hermes-lark-streaming pipeline (`cardkit/md.py`), which is battle-tested
 * against Feishu's parser quirks.
 *
 * Pipeline (same order as Hermes):
 *   clampUtf8 → optimizeMarkdownStyle → downgradeTables → escapeAsterisks
 *
 * Why each step exists:
 * - Feishu's markdown parser is more aggressive than CommonMark: an unpaired
 *   `*` in `2*4000+4*3000` starts an italic run and eats the rest of the card.
 * - A single card is capped around 30 KB of JSON; Chinese text is 3 bytes per
 *   character, so `length` underestimates the payload ~3x.
 * - Feishu renders at most a handful of tables per card; overflow degrades to
 *   plain lists.
 */

/** Answer budget in UTF-8 bytes (~4300 Chinese characters). */
export const ANSWER_MAX_BYTES = 13000

/** Tables per card before overflow degrades to lists (streaming: lenient). */
export const MAX_CARD_TABLES = 20

const TRUNCATION_SUFFIX = '\n\n…（内容过长已截断，防卡片溢出）…'

/** Marker appended when an answer needs more than one card. */
export const MORE_FOLLOWS_SUFFIX = '\n\n…（内容过长，已续到下一张卡片）…'

const RE_FENCED_CODE = /```[\s\S]*?```/g
const RE_INLINE_CODE = /`[^`]+`/g
const RE_BOLD = /\*{2,3}(?!\s)((?:(?!\*{2,3}).)+?)(?<!\s)\*{2,3}/g
const RE_VALID_ITALIC = /(?<![a-zA-Z0-9_])\*(?!\s)((?:(?!\*).)+?)(?<!\s)\*/g
const RE_UNPAIRED_ASTERISK = /(?<!\\)\*(?=[^\s*])/g
const RE_IMAGE_REF = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const RE_CODE_BLOCK_EXTRACT = /(^|\n)(`{3,})([^\n]*)\n[\s\S]*?\n\2(?=\n|$)/g
const RE_HEADING_DEMOTE = /^#{2,6} (.+)$/gm
const RE_H1_DEMOTE = /^# (.+)$/gm
const RE_MULTI_NEWLINE = /\n{3,}/g
const RE_SHORT_MD_CHECK = /^#{1,6} |\n#{1,6} |```|!\[|\n{3,}/
const RE_TABLE_BLOCK = /^\|.+\|\n\|[-:| ]+\|[\s\S]*?(?=\n\n|\n(?!\|)|$)/gm

const utf8Length = (text: string): number => Buffer.byteLength(text, 'utf8')

/**
 * Clamp by UTF-8 bytes, keeping a visible marker. Binary-searches the largest
 * character prefix that fits the budget minus the marker.
 */
export function clampUtf8(text: string, maxBytes: number = ANSWER_MAX_BYTES): string {
  if (utf8Length(text) <= maxBytes) return text
  const budget = maxBytes - utf8Length(TRUNCATION_SUFFIX)
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (utf8Length(text.slice(0, mid)) <= budget) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + TRUNCATION_SUFFIX
}

/** Escape asterisks Feishu would pair up by mistake, sparing real code/bold. */
export function escapeAsterisks(text: string): string {
  if (text.includes('\x00')) text = text.replace(/\x00/g, '')
  if (!text.includes('*')) return text

  const protectedSpans: string[] = []
  const save = (match: string) => {
    protectedSpans.push(match)
    return `\x00P${protectedSpans.length - 1}P\x00`
  }

  // Order matters: code first (it may contain asterisks), then bold, then italic.
  let out = text
  out = out.replace(RE_FENCED_CODE, save)
  out = out.replace(RE_INLINE_CODE, save)
  out = out.replace(RE_BOLD, save)
  out = out.replace(RE_VALID_ITALIC, save)
  out = out.replace(RE_UNPAIRED_ASTERISK, '\\*')

  for (let i = protectedSpans.length - 1; i >= 0; i--) {
    // Function replacement: a string replacement expands `$&` / `$1` inside the
    // restored span, so code containing `$&` came back mangled (and, worse,
    // carrying a copy of the surrounding text).
    const span = protectedSpans[i]!
    out = out.replace(`\x00P${i}P\x00`, () => span)
  }
  // Null bytes render as boxes in Feishu and must never reach the API.
  return out.replace(/\x00/g, '')
}

/** Demote headings, collapse blank runs, drop image refs we cannot resolve. */
export function optimizeMarkdownStyle(text: string): string {
  if (text.length < 100 && !RE_SHORT_MD_CHECK.test(text)) return text
  try {
    const codeBlocks: string[] = []
    const mark = '___CB_'
    let out = text.replace(RE_CODE_BLOCK_EXTRACT, (match, prefix: string) => {
      const lead = prefix ?? ''
      const block = match.slice(lead.length)
      codeBlocks.push(block)
      return `${lead}${mark}${codeBlocks.length - 1}___`
    })

    out = out.replace(RE_HEADING_DEMOTE, '##### $1')
    out = out.replace(RE_H1_DEMOTE, '#### $1')

    for (const [index, block] of codeBlocks.entries()) {
      // Function replacement, not a string one: `$&`/`$1` inside a code block
      // would be expanded into the placeholder's own match.
      out = out.replace(`${mark}${index}___`, () => block)
    }
    out = out.replace(RE_MULTI_NEWLINE, '\n\n')
    out = out.replace(RE_IMAGE_REF, (match, _alt: string, target: string) =>
      target.startsWith('img_') ? match : '',
    )
    return out
  } catch {
    return text
  }
}

/** Convert one markdown table into a bullet list. */
function tableToList(table: string): string {
  const lines = table.split('\n').filter((line) => line.trim().startsWith('|'))
  const rows = lines
    .filter((line) => !/^\|[\s:|-]+\|?$/.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean),
    )
    .filter((cells) => cells.length > 0)
  return rows.map((cells) => `• ${cells.join(' · ')}`).join('\n')
}

/**
 * Degrade tables beyond `limit` into plain lists. Hermes ships a 200-line
 * table engine; this is the pragmatic port — find table blocks outside code
 * fences and convert the overflow.
 */
export function downgradeTables(text: string, limit: number = MAX_CARD_TABLES): string {
  if (!text.includes('|')) return text
  try {
    const blocks = text.match(RE_TABLE_BLOCK) ?? []
    if (blocks.length <= limit) return text
    let seen = 0
    return text.replace(RE_TABLE_BLOCK, (match) => {
      seen += 1
      return seen > limit ? tableToList(match) : match
    })
  } catch {
    return text
  }
}

/** The full pipeline, in Hermes' order. */
export function sanitizeAnswer(text: string): string {
  return escapeAsterisks(downgradeTables(optimizeMarkdownStyle(clampUtf8(text))))
}

/**
 * Split an answer into card-sized parts — Hermes' 分段+续卡.
 *
 * A single Feishu card holds roughly 30 KB of JSON, i.e. ~13 KB of markdown
 * (`ANSWER_MAX_BYTES`). Clamping there used to be the end of the story: the rest
 * of a long answer was simply lost. Now the first part streams on the live card
 * and the remainder is posted as follow-up cards.
 *
 * Splits on a paragraph boundary when one is reasonably close to the byte
 * budget, so a code block or a table is not cut mid-way; otherwise on the byte
 * boundary itself. Raw text in, raw parts out — the caller sanitizes each.
 *
 * @param text - raw answer markdown
 * @param maxBytes - per-part budget, same units as `ANSWER_MAX_BYTES`
 * @param maxParts - hard cap (a runaway answer must not post ten cards)
 * @returns one part when it fits, otherwise up to `maxParts`
 */
export function splitAnswer(
  text: string,
  maxBytes: number = ANSWER_MAX_BYTES,
  maxParts = 4,
): string[] {
  if (utf8Length(text) <= maxBytes) return [text]
  const parts: string[] = []
  let rest = text
  while (rest && parts.length < Math.max(1, maxParts - 1) && utf8Length(rest) > maxBytes) {
    let lo = 0
    let hi = rest.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (utf8Length(rest.slice(0, mid)) <= maxBytes) lo = mid
      else hi = mid - 1
    }
    const window = rest.slice(0, lo)
    const para = window.lastIndexOf('\n\n')
    const line = window.lastIndexOf('\n')
    const cut = para >= 0 ? para : line
    // Only honour the boundary when it does not throw away a big chunk of the
    // budget; otherwise a wall of short lines would split far too early.
    const boundary = cut > lo * 0.6 ? cut + (para >= 0 ? 2 : 1) : lo
    parts.push(rest.slice(0, boundary))
    rest = rest.slice(boundary)
  }
  if (rest) parts.push(rest)
  return parts
}
