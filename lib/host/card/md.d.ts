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
export declare const ANSWER_MAX_BYTES = 13000;
/** Tables per card before overflow degrades to lists (streaming: lenient). */
export declare const MAX_CARD_TABLES = 20;
/** Marker appended when an answer needs more than one card. */
export declare const MORE_FOLLOWS_SUFFIX = "\n\n\u2026\uFF08\u5185\u5BB9\u8FC7\u957F\uFF0C\u5DF2\u7EED\u5230\u4E0B\u4E00\u5F20\u5361\u7247\uFF09\u2026";
/**
 * Clamp by UTF-8 bytes, keeping a visible marker. Binary-searches the largest
 * character prefix that fits the budget minus the marker.
 */
export declare function clampUtf8(text: string, maxBytes?: number): string;
/** Escape asterisks Feishu would pair up by mistake, sparing real code/bold. */
export declare function escapeAsterisks(text: string): string;
/** Demote headings, collapse blank runs, drop image refs we cannot resolve. */
export declare function optimizeMarkdownStyle(text: string): string;
/**
 * Degrade tables beyond `limit` into plain lists. Hermes ships a 200-line
 * table engine; this is the pragmatic port — find table blocks outside code
 * fences and convert the overflow.
 */
export declare function downgradeTables(text: string, limit?: number): string;
/** The full pipeline, in Hermes' order. */
export declare function sanitizeAnswer(text: string): string;
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
export declare function splitAnswer(text: string, maxBytes?: number, maxParts?: number): string[];
