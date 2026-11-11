/**
 * Secret masking for outbound Feishu cards — a pure, dependency-free last line
 * of defence before model/tool text reaches a whole group.
 *
 * Why this exists: tool output (env dumps, `git remote -v`, config files, curl
 * commands) routinely carries credentials, and a card posted to a group is
 * archived and searchable. The caller decides WHEN to run this (e.g. only for
 * group chats); this module knows nothing about chats, I/O or configuration.
 *
 * Placeholder format: `⟨已打码·<label>⟩`. Only four well-known FAMILY prefixes
 * are kept — `sk-`, `gh[pousr]_`, `AKIA`, `cli_` — because they tell the reader
 * WHAT leaked without exposing any of the remaining entropy. Longer prefixes
 * (`github_pat_`, `xoxb-`, `AIza`) are masked whole: a uniform 3–4 character
 * allowlist is easier to audit for accidental leaks than a per-vendor list.
 * The same reasoning makes the e-mail rule keep the domain (that is routing
 * information the reader needs) while masking the entire local part.
 *
 * Correctness notes:
 * - every pattern is global and applied with a FUNCTION replacement, so `$&`
 *   or `$1` inside matched text can never be expanded into the output;
 * - the placeholder contains no ASCII key material, so a second pass cannot
 *   nest placeholders (the rules simply do not match their own output);
 * - a non-string value is blanked defensively instead of coerced: this sits on
 *   the card-send path, where throwing would lose the whole reply.
 */
/** A rule that masks one class of secret. */
export interface RedactRule {
    /** Stable id used in trace lines and tests. */
    readonly id: string;
    /** Human label shown in the panel's "what was masked" hint (Chinese). */
    readonly label: string;
    /** Global regex; every match is replaced by mask(). */
    readonly pattern: RegExp;
}
/** Result of one pass. */
export interface Redacted {
    /** Text with every hit replaced. Unchanged text is returned as-is by identity check. */
    readonly text: string;
    /** Rule ids that fired, deduplicated, in rule order. */
    readonly hits: readonly string[];
}
/** The public rule table, in evaluation order. Extra renderer fields stay private. */
export declare const REDACT_RULES: readonly RedactRule[];
/**
 * Mask secrets in `text`.
 *
 * @param text raw model/tool text
 * @param options.enabled `false` returns the input untouched (zero-cost)
 * @returns masked text plus the ids of the rules that fired, in rule order
 */
export declare function redact(text: string, options?: {
    enabled?: boolean;
}): Redacted;
