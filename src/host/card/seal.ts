/**
 * CardKit v2.0 element/action vocabulary for our cards.
 *
 * Only the subset we actually use is modelled; the contract these mirror lives
 * in references/cardkit-contract.md (ported from the user's hermes plugin).
 */

export const ANSWER_ELEMENT_ID = 'answer_content'
/**
 * The "still working" indicator, deleted on seal.
 *
 * This is a `custom_icon` pointing at a Feishu-hosted animated image, not text
 * dots we cycle ourselves: the client animates it locally, so it stays smooth
 * no matter how often (or rarely) we flush. Polling a `.`/`..`/`...` row every
 * 700ms — the previous implementation — looked like a slideshow and made every
 * tick a card write that could race the answer flush.
 */
export const LOADING_ICON_ID = 'loading_icon'
/** The same animated asset hermes-lark-streaming ships. */
export const LOADING_ICON_IMG_KEY = 'img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg'
/** The in-card stop button row, deleted on seal (a sealed turn cannot stop). */
export const STOP_BUTTON_ID = 'stop_row'
export const FOOTER_HR_ID = 'footer_hr'
export const FOOTER_STATUS_ID = 'footer_status'
export const PANEL_ELEMENT_ID = 'agent_process_panel'

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
export type SealAction =
  | {
      action: 'partial_update_element'
      params: {
        element_id: string
        /** The element's INNER fields only — no tag/element_id wrapper. */
        partial_element: unknown
      }
    }
  | {
      action: 'add_elements'
      params: {
        elements: unknown[]
        /** Omit both for a plain append. */
        type?: 'insert_before'
        target_element_id?: string
      }
    }
  | {
      action: 'delete_elements'
      params: { element_ids: string[] }
    }

/** One atomic batch_update call. The API is atomic: a failing action rolls back its siblings. */
export type SealBatch = SealAction[]

export interface SealPlan {
  batches: SealBatch[]
  /** Card summary handed to close_streaming (max 120 chars). */
  summary: string
}

export interface FooterInput {
  status: string
  elapsed?: string
  model?: string
  context?: string
  tokens?: string
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
export const MODEL_GLYPH = '💠'

/**
 * Separator between footer groups.
 *
 * A full-width space, not `·`: ASCII whitespace is collapsed by the markdown
 * renderer, so plain spaces would vanish and the groups would run together.
 */
const GAP = '　'

/** Build the footer's single markdown element (notation size). */
export function buildFooterElement(footer: FooterInput): unknown {
  return { tag: 'markdown', element_id: FOOTER_STATUS_ID, ...(footerPartial(footer) as object) }
}

/** Footer statuses that mean "this did not go well", rendered in red. */
const NEGATIVE_STATUSES = new Set(['已停止', '出错'])

/**
 * Colour a negative status (user feedback 2026-11-10: 已停止 should be red).
 *
 * The footer is a `markdown` element, and Feishu's lark_md honours
 * `<font color='…'>` — the same trick hermes uses for its status pill. 已完成
 * stays the default colour: it is not a warning.
 */
export function colorStatus(status: string): string {
  return NEGATIVE_STATUSES.has(status) ? `<font color='red'>${status}</font>` : status
}

/**
 * The footer's INNER fields, for `partial_update_element`.
 *
 * The element id and tag are properties of the element itself, so patching an
 * existing one only carries what lives inside it.
 */
export function footerPartial(footer: FooterInput): unknown {
  // Even weight throughout: bolding the status made it shout over the metrics
  // on a line that is already quiet at notation size.
  const parts: string[] = []
  if (footer.status) parts.push(colorStatus(footer.status))
  if (footer.model) parts.push(`${MODEL_GLYPH} ${footer.model}`)
  if (footer.context) parts.push(footer.context)
  if (footer.elapsed) parts.push(footer.elapsed)
  if (footer.tokens) parts.push(footer.tokens)
  const content = parts.join(GAP)
  return {
    content,
    // Feishu picks the locale variant; we ship the same text for both so an
    // English client never sees an empty footer.
    i18n_content: { zh_cn: content, en_us: content },
    text_size: 'notation',
  }
}

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
export function summaryFromAnswer(answer: string, fallback: string): string {
  const flat = answer
    // Fences first: a code block's first line is usually `bash`, which previews
    // worse than the sentence that introduced it.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[*_`~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return fallback
  return flat.slice(0, 60)
}

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
export function buildSealPlan(input: {
  /** Inner panel fields; `undefined` when the card has no panel at all. */
  panelContent?: unknown
  footer: FooterInput
  summary: string
  removeElementIds?: string[]
  /** True when the initial card already contains the footer elements. */
  footerPresent?: boolean
}): SealPlan {
  const batches: SealBatch[] = []
  const panelAction = input.panelContent === undefined
    ? []
    : [
        {
          action: 'partial_update_element' as const,
          params: { element_id: PANEL_ELEMENT_ID, partial_element: input.panelContent },
        },
      ]

  if (input.footerPresent) {
    // The footer ships with the card, so sealing only refreshes its content —
    // together with the panel, in one atomic batch.
    batches.push([
      ...panelAction,
      {
        action: 'partial_update_element',
        params: { element_id: FOOTER_STATUS_ID, partial_element: footerPartial(input.footer) },
      },
    ])
  } else {
    if (panelAction.length > 0) batches.push(panelAction)
    batches.push([
      {
        action: 'add_elements',
        params: {
          type: 'insert_before',
          // Our cards always ship the footer, so this branch is only for a
          // footer-less card; the dots row is the anchor in that case.
          target_element_id: LOADING_ICON_ID,
          elements: [
            { tag: 'hr', element_id: FOOTER_HR_ID },
            buildFooterElement(input.footer),
          ],
        },
      },
    ])
  }

  for (const id of input.removeElementIds ?? []) {
    batches.push([{ action: 'delete_elements', params: { element_ids: [id] } }])
  }

  return { batches, summary: input.summary.slice(0, 120) }
}

/** Feishu error codes we branch on. */
export const CARDKIT_STREAMING_CLOSED = 300309
export const CARDKIT_DUPLICATE_ID = 300301
export const CARDKIT_DELETE_MISSING = 300314
export const CARDKIT_INSERT_TARGET_GONE = 300315

export class CardApiError extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
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
export function cardErrorCode(error: unknown): number {
  if (error instanceof CardApiError) return error.code
  const direct = (error as { code?: unknown })?.code
  if (typeof direct === 'number') return direct
  const nested = (error as { response?: { code?: unknown } })?.response?.code
  return typeof nested === 'number' ? nested : Number.NaN
}

/** The slice of the Feishu SDK our executor needs — fakeable in tests. */
export interface CardApi {
  batchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void>
  /** close_streaming / summary update via card settings. */
  settings(cardId: string, settings: unknown, sequence: number): Promise<void>
}

export interface SealReport {
  batchesRun: number
  footerAdded: boolean
  streamingClosed: boolean
  /** Codes we treated as satisfied, for logging. */
  satisfied: number[]
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
export async function runSealPlan(
  api: CardApi,
  cardId: string,
  plan: SealPlan,
  startSequence: number,
  log?: (message: string) => void,
): Promise<SealReport> {
  const report: SealReport = {
    batchesRun: 0,
    footerAdded: false,
    streamingClosed: false,
    satisfied: [],
  }
  let sequence = startSequence

  const run = async (actions: unknown[]) => {
    sequence += 1
    report.batchesRun += 1
    await api.batchUpdate(cardId, actions, sequence)
  }

  for (const batch of plan.batches) {
    const isFooterAdd = batch.some((action) => action.action === 'add_elements')
    try {
      await run(batch)
      if (isFooterAdd) report.footerAdded = true
    } catch (error) {
      const code = cardErrorCode(error)
      if (code === CARDKIT_STREAMING_CLOSED || code === 300313) {
        report.streamingClosed = true
        report.satisfied.push(code)
        log?.(`seal: streaming already closed (${code}); continuing with structural work`)
        continue
      }
      if (code === CARDKIT_DUPLICATE_ID || code === CARDKIT_DELETE_MISSING) {
        report.satisfied.push(code)
        if (isFooterAdd) report.footerAdded = true
        log?.(`seal: code ${code} treated as satisfied`)
        continue
      }
      if (isFooterAdd && (code === CARDKIT_INSERT_TARGET_GONE || code === 10002)) {
        // 300315 proves nothing about the footer: the target is gone, the add
        // never landed. Fall through to a plain append retry.
        log?.(`seal: insert_before failed (${code}); retrying as append`)
        try {
          const appended = batch.map((action) =>
            action.action === 'add_elements'
              ? { action: 'add_elements', params: { elements: action.params.elements } }
              : action,
          )
          await run(appended)
          report.footerAdded = true
        } catch (appendError) {
          const appendCode = cardErrorCode(appendError)
          if (appendCode === CARDKIT_DUPLICATE_ID) {
            report.footerAdded = true
            report.satisfied.push(appendCode)
            continue
          }
          throw appendError
        }
        continue
      }
      throw error
    }
  }

  if (!report.streamingClosed) {
    sequence += 1
    await api.settings(cardId, {
      config: {
        streaming_mode: false,
        summary: {
          content: plan.summary,
          i18n_content: { zh_cn: plan.summary, en_us: plan.summary },
        },
      },
    }, sequence)
    report.streamingClosed = true
  }

  return report
}
