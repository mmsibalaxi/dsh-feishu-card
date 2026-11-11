/**
 * CardKit v2.0 card construction.
 *
 * Element shapes follow the user's hermes-lark-streaming (cardkit/elements.py):
 * the answer element FIRST so it streams at the top, then the process panel,
 * then the divider and the footer's status line last.
 */
import {
  ANSWER_ELEMENT_ID,
  FOOTER_HR_ID,
  FOOTER_STATUS_ID,
  LOADING_ICON_ID,
  LOADING_ICON_IMG_KEY,
  MODEL_GLYPH,
  PANEL_ELEMENT_ID,
  STOP_BUTTON_ID,
  type FooterInput,
} from './seal.ts'
import { formatElapsed } from './streaming.ts'

export { ANSWER_ELEMENT_ID, FOOTER_STATUS_ID, PANEL_ELEMENT_ID }

export interface BuildCardOptions {
  /** Keep the process panel expanded once the turn completes. */
  panelExpanded?: boolean
  bodyTextSize?: string
  /** print_strategy=delay: how many character blocks Feishu prints per tick. */
  printStep?: number
  /** Feishu-side typewriter interval, ms. */
  printFrequencyMs?: number
  summary?: string
  /** Model shown in the panel's collapsed header. */
  panelModel?: string
  /** Reasoning-round count shown in the panel's collapsed header. */
  panelRounds?: number
  /** Tool count shown in the panel's collapsed header. */
  panelToolCount?: number
  /** Elapsed shown in the panel's collapsed header. */
  panelElapsedMs?: number
  /** Include the animated dots row (false once the turn has sealed). */
  showDots?: boolean
  /** Include the collapsible process panel; false = a card with only the answer. */
  showPanel?: boolean
  /** Callback value for the in-card stop button; absent = no button. */
  stopValue?: Record<string, unknown>
}

/** The streaming answer element — Feishu renders the typewriter effect itself. */
export function answerElement(content: string, textSize = 'normal_v2'): unknown {
  return {
    tag: 'markdown',
    content,
    text_align: 'left',
    text_size: textSize,
    margin: '0px 0px 0px 0px',
    element_id: ANSWER_ELEMENT_ID,
  }
}

/** One tool call as the panel renders it. */
export interface PanelToolStep {
  /** Call id, so parallel calls of the same tool stay separate rows. */
  id?: string
  name: string
  /** Wall-clock duration once the result landed; undefined while running. */
  ms?: number
  /** Short preview of the arguments (a command, a query, a path). */
  preview?: string
  /** False when the tool reported an error — the row then shows 🔴. */
  completed?: boolean
  /** One-line failure reason, rendered under an errored row. */
  error?: string
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
export const MAX_PANEL_STEPS = 24

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
export const MAX_PANEL_PREVIEWS = 5

/**
 * How much reasoning text the panel keeps.
 *
 * Reasoning can be tens of thousands of characters; the card budget is ~30 KB
 * of JSON total. Keeping the tail (the most recent thinking) plus a marker is
 * what hermes does, and it stays useful without blowing the budget.
 */
export const MAX_REASONING_CHARS = 1200

function clipReasoning(text: string): string {
  if (text.length <= MAX_REASONING_CHARS) return text
  return `…${text.slice(-MAX_REASONING_CHARS)}`
}

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
export function panelElements(input: { steps?: PanelToolStep[]; reasoning?: string }): unknown[] {
  const all = (input.steps ?? []).filter((step) => step.name.trim().length > 0)
  const reasoning = input.reasoning?.trim()
  if (all.length === 0 && !reasoning) return [{ tag: 'markdown', content: ' ' }]
  const hidden = Math.max(0, all.length - MAX_PANEL_STEPS)
  const steps = hidden > 0 ? all.slice(-MAX_PANEL_STEPS) : all
  const elements: unknown[] = []
  // Reasoning first: it is the chronological start of the turn, and hermes
  // puts it above the tool steps for the same reason.
  if (reasoning) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `🧠 ${clipReasoning(reasoning)}`,
        text_size: 'notation',
      },
    })
  }
  if (hidden > 0) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `…前面还有 ${hidden} 步（卡片元素上限，只显示最近 ${MAX_PANEL_STEPS} 步）`,
        text_size: 'notation',
      },
    })
  }
  for (const [index, step] of steps.entries()) {
    const title = [
      step.ms === undefined ? '🟡' : step.completed === false ? '🔴' : '🟢',
      ` **${step.name}**`,
      step.ms === undefined ? '' : ` (${formatElapsed(step.ms)})`,
    ].join('')
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: title, text_size: 'notation' },
    })
    // Payload budget: only the newest few steps keep their preview detail.
    const detailed = steps.length - index <= MAX_PANEL_PREVIEWS
    if (step.preview && detailed) {
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: step.preview, text_size: 'notation' },
      })
    }
    if (step.error) {
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `⚠️ ${step.error}`, text_size: 'notation' },
      })
    }
  }
  return elements
}

/**
 * The panel's collapsed header: pure stats, no status words.
 *
 * Mirrors hermes' `build_panel_header` — `⚕model · 🫧rounds · ✨tools · 🎶elapsed`
 * — so the row reads as a summary rather than a second status line competing
 * with the footer.
 */
export function panelHeader(input: {
  model?: string
  rounds?: number
  toolCount: number
  elapsedMs: number
}): unknown {
  const parts: string[] = []
  if (input.model) parts.push(`${MODEL_GLYPH} ${input.model}`)
  parts.push(`🫧 ${input.rounds ?? 0}`)
  parts.push(`✨ ${input.toolCount}`)
  parts.push(`🎶 ${formatElapsed(input.elapsedMs)}`)
  return {
    title: {
      tag: 'plain_text',
      content: parts.join(' · '),
      text_color: 'grey',
      text_size: 'notation',
    },
    vertical_align: 'center',
    icon: {
      tag: 'standard_icon',
      token: 'down-small-ccm_outlined',
      size: '16px 16px',
      color: 'grey',
    },
    icon_position: 'right',
    icon_expanded_angle: -180,
  }
}

/**
 * The "still working" row — hermes' animated icon, not hand-cycled dots.
 *
 * A `markdown` element whose `icon` is a `custom_icon`: Feishu plays the
 * animation itself (a bouncing-dots GIF), so the motion is frame-perfect and
 * costs us zero API calls. Our old implementation ticked `.` → `..` → `...`
 * every 700ms, which both looked like a slideshow and added a card write every
 * tick that could collide with the answer flush (300317).
 */
export function loadingIndicator(): unknown {
  return {
    tag: 'markdown',
    content: ' ',
    icon: {
      tag: 'custom_icon',
      img_key: LOADING_ICON_IMG_KEY,
      size: '16px 16px',
    },
    element_id: LOADING_ICON_ID,
  }
}

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
export function stopButtonRow(value: Record<string, unknown>): unknown {
  return {
    tag: 'column_set',
    element_id: STOP_BUTTON_ID,
    flex_mode: 'none',
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [{ tag: 'markdown', content: ' ' }],
      },
      {
        tag: 'column',
        width: 'auto',
        elements: [
          {
            tag: 'button',
            element_id: 'stop_button',
            text: {
              tag: 'plain_text',
              content: '◯ 停止',
              i18n_content: { zh_cn: '◯ 停止', en_us: '◯ Stop' },
            },
            type: 'danger',
            size: 'small',
            behaviors: [{ type: 'callback', value }],
          },
        ],
      },
    ],
  }
}

/** The panel skeleton; children are replaced during the turn. */
export function panelPlaceholder(
  input: { model?: string; rounds?: number; toolCount?: number; elapsedMs?: number } = {},
): unknown {
  return {
    tag: 'collapsible_panel',
    expanded: false,
    header: panelHeader({
      model: input.model,
      rounds: input.rounds ?? 0,
      toolCount: input.toolCount ?? 0,
      elapsedMs: input.elapsedMs ?? 0,
    }),
    border: { color: 'grey', corner_radius: '5px' },
    vertical_spacing: '4px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: ' ' }],
    element_id: PANEL_ELEMENT_ID,
  }
}

/**
 * The initial card body: answer (streaming) → panel → dots → stop button.
 *
 * No footer here on purpose (user feedback 2026-11-09): the status line is a
 * *result*, not a progress bar, and printing 思考中 under every running card
 * made the card look busier than the answer. The footer is added by the seal
 * plan — see `buildSealPlan({ footerPresent: false })` — so the divider and the
 * status line appear exactly when the turn ends.
 */
export function buildStreamingCard(options: BuildCardOptions & { footer?: unknown } = {}): unknown {
  const elements: unknown[] = [answerElement('', options.bodyTextSize)]
  // The process panel is optional (user feedback 2026-11-11: 支持关闭工具栏显示):
  // some people want a card whose only visible state is the answer itself, plus
  // the "still working" row and the stop button.
  if (options.showPanel !== false) {
    elements.push(
      panelPlaceholder({
        model: options.panelModel,
        rounds: options.panelRounds ?? 0,
        toolCount: options.panelToolCount ?? 0,
        elapsedMs: options.panelElapsedMs ?? 0,
      }),
    )
  }
  // The animated "still working" icon: cycled by Feishu, deleted on seal.
  if (options.showDots !== false) elements.push(loadingIndicator())
  // The stop affordance sits right under the dots, at the card's right edge,
  // and disappears with them.
  if (options.stopValue) elements.push(stopButtonRow(options.stopValue))
  // A caller that still ships a footer (tests, a future always-on footer) keeps
  // the old layout: divider + footer under the button row.
  if (options.footer) {
    elements.push({ tag: 'hr', element_id: FOOTER_HR_ID }, options.footer)
  }
  const summary = options.summary ?? '处理中…'
  return {
    schema: '2.0',
    config: {
      streaming_mode: true,
      streaming_config: {
        // hermes' numbers exactly: one character every 15ms, printed as fast as
        // the client allows. The old 4-chars-per-70ms with `delay` is what made
        // answers appear as a block of lines every flush instead of typing.
        print_frequency_ms: { default: options.printFrequencyMs ?? 15 },
        print_step: { default: options.printStep ?? 1 },
        print_strategy: 'fast',
      },
      // Feishu resolves text by locale; declare both so i18n_content is honoured.
      locales: ['zh_cn', 'en_us'],
      summary: {
        content: summary,
        i18n_content: { zh_cn: summary, en_us: summary },
      },
    },
    body: { elements },
  }
}

/**
 * Replacement for the panel element during a turn.
 *
 * `partial_update_element` takes the element's INNER fields, so a collapsible
 * panel is patched with `{header, elements, border}` — the same three hermes
 * sends. `tag` must NOT appear: Feishu forbids changing an element's tag.
 */
export function panelUpdate(input: {
  steps?: PanelToolStep[]
  model?: string
  rounds?: number
  elapsedMs?: number
  /** Tail of the reasoning stream; only passed when the panel shows it. */
  reasoning?: string
  /** Force the panel open (used on seal when `panelExpanded` is on). */
  expanded?: boolean
}): unknown {
  return {
    header: panelHeader({
      model: input.model,
      rounds: input.rounds ?? 0,
      toolCount: (input.steps ?? []).length,
      elapsedMs: input.elapsedMs ?? 0,
    }),
    elements: panelElements({ steps: input.steps, reasoning: input.reasoning }),
    border: { color: 'grey', corner_radius: '5px' },
    ...(input.expanded === undefined ? {} : { expanded: input.expanded }),
  }
}

/** Re-exported so callers do not need two imports for footer work. */
export type { FooterInput }

/**
 * A static card that carries one continuation chunk of a long answer.
 *
 * Deliberately NOT a streaming card: it is posted once, complete, right after
 * the live card seals. Hermes splits its segments across cards the same way; the
 * alternative — clamping at 13 KB — silently threw the end of a long answer away.
 */
export function continuationCard(content: string, summary: string): unknown {
  const clipped = summary.slice(0, 120)
  return {
    schema: '2.0',
    config: {
      locales: ['zh_cn', 'en_us'],
      summary: { content: clipped, i18n_content: { zh_cn: clipped, en_us: clipped } },
    },
    body: { elements: [answerElement(content)] },
  }
}
