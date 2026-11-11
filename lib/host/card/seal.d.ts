/**
 * CardKit v2.0 element/action vocabulary for our cards.
 *
 * Only the subset we actually use is modelled; the contract these mirror lives
 * in references/cardkit-contract.md (ported from the user's hermes plugin).
 */
export declare const ANSWER_ELEMENT_ID = "answer_content";
/**
 * The "still working" indicator, deleted on seal.
 *
 * This is a `custom_icon` pointing at a Feishu-hosted animated image, not text
 * dots we cycle ourselves: the client animates it locally, so it stays smooth
 * no matter how often (or rarely) we flush. Polling a `.`/`..`/`...` row every
 * 700ms — the previous implementation — looked like a slideshow and made every
 * tick a card write that could race the answer flush.
 */
export declare const LOADING_ICON_ID = "loading_icon";
/** The same animated asset hermes-lark-streaming ships. */
export declare const LOADING_ICON_IMG_KEY = "img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg";
/** The in-card stop button row, deleted on seal (a sealed turn cannot stop). */
export declare const STOP_BUTTON_ID = "stop_row";
export declare const FOOTER_HR_ID = "footer_hr";
export declare const FOOTER_STATUS_ID = "footer_status";
export declare const PANEL_ELEMENT_ID = "agent_process_panel";
/**
 * CardKit v2.0 element/action vocabulary for our cards.
 *
 * Only the subset we actually use is modelled; the contract these mirror lives
 * in references/cardkit-contract.md (ported from the user's hermes plugin).
 *
 * The wire shape is `{action, params}` — NOT a flat `{kind, element_id, content}`.
 * Getting this wrong is silent: `card.batchUpdate` answers `code=0` because the
 * `actions` blob is only ever parsed as JSON, so a wrongly-shaped action is
 * accepted and then does nothing at all. That is exactly how the card once sat
 * on its initial "正在加载上下文…" state forever while every call "succeeded".
 */
export type SealAction = {
    action: 'partial_update_element';
    params: {
        element_id: string;
        /** The element's INNER fields only — no tag/element_id wrapper. */
        partial_element: unknown;
    };
} | {
    action: 'add_elements';
    params: {
        elements: unknown[];
        /** Omit both for a plain append. */
        type?: 'insert_before';
        target_element_id?: string;
    };
} | {
    action: 'delete_elements';
    params: {
        element_ids: string[];
    };
};
/** One atomic batch_update call. The API is atomic: a failing action rolls back its siblings. */
export type SealBatch = SealAction[];
export interface SealPlan {
    batches: SealBatch[];
    /** Card summary handed to close_streaming (max 120 chars). */
    summary: string;
}
export interface FooterInput {
    status: string;
    elapsed?: string;
    model?: string;
    context?: string;
    tokens?: string;
}
/**
 * Glyph in front of the model name.
 *
 * A text glyph, not a `standard_icon`: Feishu's icon tokens are a fixed official
 * set with nothing model-ish in it, and hermes documents that an unrecognised
 * token renders blank.
 *
 * It is an EMOJI (`💠`) rather than the old `✦` on purpose (user feedback
 * 2026-11-09): the panel header is a `plain_text` element, which has no way to
 * colour part of a string, so a monochrome `✦` stayed dark next to the coloured
 * 🫧/✨/🎶 stats. An emoji is coloured in BOTH places — footer markdown and
 * panel header — with no `<font>` tag.
 */
export declare const MODEL_GLYPH = "\uD83D\uDCA0";
/** Build the footer's single markdown element (notation size). */
export declare function buildFooterElement(footer: FooterInput): unknown;
/**
 * Colour a negative status (user feedback 2026-11-10: 已停止 should be red).
 *
 * The footer is a `markdown` element, and Feishu's lark_md honours
 * `<font color='…'>` — the same trick hermes uses for its status pill. 已完成
 * stays the default colour: it is not a warning.
 */
export declare function colorStatus(status: string): string;
/**
 * The footer's INNER fields, for `partial_update_element`.
 *
 * The element id and tag are properties of the element itself, so patching an
 * existing one only carries what lives inside it.
 */
export declare function footerPartial(footer: FooterInput): unknown;
/**
 * Card summary for a sealed turn: the answer itself, flattened.
 *
 * Feishu renders `config.summary` in the chat list, in notifications and on the
 * collapsed message row — it is the only thing a user sees before opening the
 * card. Sealing with the *status* ("已完成") therefore made every conversation
 * preview useless (user feedback 2026-11-09: 消息栏只有“已完成”，看不到回了什么).
 * The answer's first line says what the reply is about, so that is what goes in.
 *
 * @param answer - final answer text, markdown and all
 * @param fallback - status word used when the answer carries no prose
 * @returns at most 60 characters of single-line plain text
 */
export declare function summaryFromAnswer(answer: string, fallback: string): string;
/**
 * Build the seal plan.
 *
 * Order is load-bearing (hermes production lessons, see
 * references/cardkit-contract.md §4):
 *   1. panel → final state
 *   2. footer added with insert_before(loading_icon) — skipped when the card
 *      already carries a live footer
 *   3. each loading-icon delete in its OWN batch (a grouped delete whose
 *      sibling id is already gone takes the whole batch down)
 */
export declare function buildSealPlan(input: {
    panelContent: unknown;
    footer: FooterInput;
    summary: string;
    removeElementIds?: string[];
    /** True when the initial card already contains the footer elements. */
    footerPresent?: boolean;
}): SealPlan;
/** Feishu error codes we branch on. */
export declare const CARDKIT_STREAMING_CLOSED = 300309;
export declare const CARDKIT_DUPLICATE_ID = 300301;
export declare const CARDKIT_DELETE_MISSING = 300314;
export declare const CARDKIT_INSERT_TARGET_GONE = 300315;
export declare class CardApiError extends Error {
    readonly code: number;
    constructor(code: number, message: string);
}
/**
 * The Feishu error code of a failed call, whatever shape the transport threw.
 *
 * The real transport (`card/transport.ts`) attaches `code` to a plain `Error`
 * instead of constructing a CardApiError, and it is the only layer that sees
 * Feishu's own response. Reading the property as well as the class is what
 * keeps the tolerance contract below alive in production: an
 * `instanceof`-only check silently degrades every branch to "unknown error"
 * (it did — the seal then threw on codes that mean "already done").
 */
export declare function cardErrorCode(error: unknown): number;
/** The slice of the Feishu SDK our executor needs — fakeable in tests. */
export interface CardApi {
    batchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void>;
    /** close_streaming / summary update via card settings. */
    settings(cardId: string, settings: unknown, sequence: number): Promise<void>;
}
export interface SealReport {
    batchesRun: number;
    footerAdded: boolean;
    streamingClosed: boolean;
    /** Codes we treated as satisfied, for logging. */
    satisfied: number[];
}
/**
 * Run the seal plan against the API, applying the error-code contract:
 *   - 300309 / 300313 (streaming already closed) → stop trying to stream,
 *     everything after must still run (hermes lost footers here)
 *   - 300301 (duplicate element id) → "already there", satisfied
 *   - 300314 (delete of a missing element) → satisfied
 *   - 300315 (insert_before target gone) → retry the add as an append
 *   - 10002 (add without type) → retry with an explicit append type
 */
export declare function runSealPlan(api: CardApi, cardId: string, plan: SealPlan, startSequence: number, log?: (message: string) => void): Promise<SealReport>;
