/**
 * CardKit v2.0 card construction.
 *
 * Element shapes follow the user's hermes-lark-streaming (cardkit/elements.py):
 * the answer element FIRST so it streams at the top, then the process panel,
 * then the divider and the footer's status line last.
 */
import { ANSWER_ELEMENT_ID, FOOTER_STATUS_ID, PANEL_ELEMENT_ID, type FooterInput } from './seal.ts';
export { ANSWER_ELEMENT_ID, FOOTER_STATUS_ID, PANEL_ELEMENT_ID };
export interface BuildCardOptions {
    /** Keep the process panel expanded once the turn completes. */
    panelExpanded?: boolean;
    bodyTextSize?: string;
    /** print_strategy=delay: how many character blocks Feishu prints per tick. */
    printStep?: number;
    /** Feishu-side typewriter interval, ms. */
    printFrequencyMs?: number;
    summary?: string;
    /** Model shown in the panel's collapsed header. */
    panelModel?: string;
    /** Reasoning-round count shown in the panel's collapsed header. */
    panelRounds?: number;
    /** Tool count shown in the panel's collapsed header. */
    panelToolCount?: number;
    /** Elapsed shown in the panel's collapsed header. */
    panelElapsedMs?: number;
    /** Include the animated dots row (false once the turn has sealed). */
    showDots?: boolean;
    /** Callback value for the in-card stop button; absent = no button. */
    stopValue?: Record<string, unknown>;
}
/** The streaming answer element — Feishu renders the typewriter effect itself. */
export declare function answerElement(content: string, textSize?: string): unknown;
/** One tool call as the panel renders it. */
export interface PanelToolStep {
    /** Call id, so parallel calls of the same tool stay separate rows. */
    id?: string;
    name: string;
    /** Wall-clock duration once the result landed; undefined while running. */
    ms?: number;
    /** Short preview of the arguments (a command, a query, a path). */
    preview?: string;
    /** False when the tool reported an error — the row then shows 🔴. */
    completed?: boolean;
    /** One-line failure reason, rendered under an errored row. */
    error?: string;
}
/**
 * How many tool rows the panel may render.
 *
 * Feishu caps a card at ~200 elements, and each step costs two (title + detail).
 * A long agentic turn (30 tool calls) would otherwise push the card over the
 * limit and make EVERY later update fail — the whole card freezes. Keeping the
 * newest steps and folding the rest into one summary row stays well inside the
 * budget while still showing what the agent is doing now.
 */
export declare const MAX_PANEL_STEPS = 24;
/**
 * How many of the newest steps keep their argument preview.
 *
 * The preview is the biggest per-step payload (a command, a path, a URL), and
 * the panel is re-sent WHOLE on every panel flush. Measured live (2026-11-10):
 * 72% of all card writes carried no new answer text, and a 66-tool turn's panel
 * is large enough that each of those writes costs a visible round trip. Keeping
 * previews only on the freshest rows cuts the payload without hiding what the
 * agent is doing right now.
 */
export declare const MAX_PANEL_PREVIEWS = 5;
/**
 * How much reasoning text the panel keeps.
 *
 * Reasoning can be tens of thousands of characters; the card budget is ~30 KB
 * of JSON total. Keeping the tail (the most recent thinking) plus a marker is
 * what hermes does, and it stays useful without blowing the budget.
 */
export declare const MAX_REASONING_CHARS = 1200;
/**
 * Inner content of the unified process panel: two rows per tool call.
 *
 * Mirrors hermes' `_build_tool_step_elements` — a title div (status dot, name,
 * duration) and, when there is something to show, a detail div underneath.
 * Reasoning is deliberately NOT rendered (hermes gates it behind
 * `show_reasoning`); the answer is what matters.
 *
 * NOTE: the detail MUST be its own div. Nesting it under an invented key on the
 * title div makes Feishu reject the whole batch with
 * `300313 type of element is not supported tag: lark_md, path: … -> extra`.
 */
export declare function panelElements(input: {
    steps?: PanelToolStep[];
    reasoning?: string;
}): unknown[];
/**
 * The panel's collapsed header: pure stats, no status words.
 *
 * Mirrors hermes' `build_panel_header` — `⚕model · 🫧rounds · ✨tools · 🎶elapsed`
 * — so the row reads as a summary rather than a second status line competing
 * with the footer.
 */
export declare function panelHeader(input: {
    model?: string;
    rounds?: number;
    toolCount: number;
    elapsedMs: number;
}): unknown;
/**
 * The "still working" row — hermes' animated icon, not hand-cycled dots.
 *
 * A `markdown` element whose `icon` is a `custom_icon`: Feishu plays the
 * animation itself (a bouncing-dots GIF), so the motion is frame-perfect and
 * costs us zero API calls. Our old implementation ticked `.` → `..` → `...`
 * every 700ms, which both looked like a slideshow and added a card write every
 * tick that could collide with the answer flush (300317).
 */
export declare function loadingIndicator(): unknown;
/**
 * The in-card stop button.
 *
 * A stop affordance on the card itself is the one hermes interaction this
 * plugin was missing entirely: `/stop` requires knowing the command and typing
 * it into the chat, while the card is exactly where the user is already
 * looking. The button is removed on seal, so it can never be clicked after the
 * turn is over.
 *
 * Shape, from user feedback 2026-11-09 (they circled both spots on a
 * screenshot):
 *   - bottom-RIGHT, not left — a weighted spacer column does the pushing; a
 *     `horizontal_align` key is not part of the `column_set` schema we can
 *     rely on (an unknown key is rejected for the whole batch).
 *   - a hollow circle in RED, not the blue ⏹ square: `type: 'danger'` is what
 *     colours the glyph, so the icon is a plain text `◯`.
 */
export declare function stopButtonRow(value: Record<string, unknown>): unknown;
/** The panel skeleton; children are replaced during the turn. */
export declare function panelPlaceholder(input?: {
    model?: string;
    rounds?: number;
    toolCount?: number;
    elapsedMs?: number;
}): unknown;
/**
 * The initial card body: answer (streaming) → panel → dots → stop button.
 *
 * No footer here on purpose (user feedback 2026-11-09): the status line is a
 * *result*, not a progress bar, and printing 思考中 under every running card
 * made the card look busier than the answer. The footer is added by the seal
 * plan — see `buildSealPlan({ footerPresent: false })` — so the divider and the
 * status line appear exactly when the turn ends.
 */
export declare function buildStreamingCard(options?: BuildCardOptions & {
    footer?: unknown;
}): unknown;
/**
 * Replacement for the panel element during a turn.
 *
 * `partial_update_element` takes the element's INNER fields, so a collapsible
 * panel is patched with `{header, elements, border}` — the same three hermes
 * sends. `tag` must NOT appear: Feishu forbids changing an element's tag.
 */
export declare function panelUpdate(input: {
    steps?: PanelToolStep[];
    model?: string;
    rounds?: number;
    elapsedMs?: number;
    /** Tail of the reasoning stream; only passed when the panel shows it. */
    reasoning?: string;
    /** Force the panel open (used on seal when `panelExpanded` is on). */
    expanded?: boolean;
}): unknown;
/** Re-exported so callers do not need two imports for footer work. */
export type { FooterInput };
/**
 * A static card that carries one continuation chunk of a long answer.
 *
 * Deliberately NOT a streaming card: it is posted once, complete, right after
 * the live card seals. Hermes splits its segments across cards the same way; the
 * alternative — clamping at 13 KB — silently threw the end of a long answer away.
 */
export declare function continuationCard(content: string, summary: string): unknown;
