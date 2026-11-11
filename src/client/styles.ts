/**
 * The settings panel's stylesheet.
 *
 * A plugin may not `require('@deepseek-ai/dsh-client-ui-primitives')` — the
 * Host's own practice note forbids loading a Client package as a module, since
 * it changes without notice and a throwing component blanks the slot entry.
 * So the markup and CSS of the official form controls were copied out of the
 * shipped bundle (`dsh-client-ui-primitives` → `SettingsForm`,
 * `SettingsValueField`, `SettingsSecretField`, `Switch`, `Tag`, and the
 * segmented enum control) and re-prefixed `fc-` here.
 *
 * Two rules keep that honest:
 *  - Only `--dsw-alias-*` / `--dsw-static-*` theme tokens are referenced, so a
 *    renamed token degrades the look but never breaks rendering, and light/dark
 *    both come from the host for free.
 *  - Behavior users rely on is preserved: `role="switch"` with `aria-checked`,
 *    the segmented control's `role="tablist"`/`aria-selected` + arrow keys, the
 *    modal's Escape handling and initial focus, and `aria-invalid` /
 *    `aria-describedby` on the inputs.
 */

export const CSS_TAG_ID = 'dsh-feishu-card/panel.css'

/** The class names, so components never repeat literal strings. */
export const cls = {
  form: 'fc-form',
  section: 'fc-section',
  sectionTitle: 'fc-sectionTitle',
  field: 'fc-field',
  head: 'fc-head',
  labelGroup: 'fc-labelGroup',
  label: 'fc-label',
  badges: 'fc-badges',
  reset: 'fc-reset',
  input: 'fc-input',
  hint: 'fc-hint',
  invalid: 'fc-invalid',
  footer: 'fc-footer',
  save: 'fc-save',
  ghost: 'fc-ghost',
  failed: 'fc-failed',
  tag: 'fc-tag',
  switch: 'fc-switch',
  thumb: 'fc-thumb',
  seg: 'fc-seg',
  segIndicator: 'fc-segIndicator',
  segTab: 'fc-segTab',
  chips: 'fc-chips',
  chip: 'fc-chip',
  chipName: 'fc-chipName',
  chipId: 'fc-chipId',
  chipX: 'fc-chipX',
  suggest: 'fc-suggest',
  suggestLabel: 'fc-suggestLabel',
  suggestNote: 'fc-suggestNote',
  auth: 'fc-auth',
  authRow: 'fc-authRow',
  authPending: 'fc-authPending',
  authCode: 'fc-authCode',
  toggles: 'fc-toggles',
  selectWrap: 'fc-selectWrap',
  selectArrow: 'fc-selectArrow',
} as const

export const PANEL_CSS = `
.${cls.form}{display:flex;flex-direction:column}
.${cls.section}{display:flex;flex-direction:column}
.${cls.sectionTitle}{margin:0;padding:20px 0 2px;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.${cls.section}:first-child .${cls.sectionTitle}{padding-top:4px}
.${cls.field}{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.${cls.field}+.${cls.field}{border-top:.5px solid var(--dsw-alias-border-l2)}
.${cls.head}{display:flex;align-items:center;gap:8px}
.${cls.labelGroup}{display:flex;align-items:center;gap:4px;flex:1;min-width:0}
.${cls.label}{flex:0 1 auto;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.${cls.badges}{display:inline-flex;align-items:center;gap:8px;flex:none}
.${cls.reset}{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.${cls.reset}:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.${cls.reset}:disabled{cursor:default;opacity:.5}
.${cls.input}{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.${cls.input}:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.${cls.input}:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.${cls.input}[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
textarea.${cls.input}{height:auto;min-height:68px;padding:8px 12px;resize:vertical}
.${cls.hint}{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.${cls.invalid}{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.${cls.footer}{display:flex;align-items:center;gap:8px;padding-top:20px}
.${cls.save}{appearance:none;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.${cls.save}:disabled{opacity:.4;cursor:default}
.${cls.save}:hover:not(:disabled){opacity:.88}
.${cls.save}:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:1px}
.${cls.ghost}{appearance:none;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary)}
.${cls.ghost}:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.${cls.ghost}:disabled{opacity:.4;cursor:default}
.${cls.failed}{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.${cls.tag}{display:inline-flex;align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
.${cls.tag}[data-tone=neutral]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.${cls.tag}[data-tone=quiet]{color:var(--dsw-alias-label-tertiary)}
.${cls.tag}[data-tone=info]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);color:var(--dsw-alias-state-business-primary)}
.${cls.tag}[data-tone=success]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.${cls.tag}[data-tone=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);color:var(--dsw-alias-state-warn-primary)}
.${cls.chips}{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.${cls.chip}{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 4px 3px 10px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-bg-module-platform);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.${cls.chip}[data-tone=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);color:var(--dsw-alias-state-warn-primary)}
.${cls.chipId}{font-family:var(--dsh-font-family-code-default, monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.${cls.chipName}{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${cls.chipName}[data-tone=unknown]{color:var(--dsw-alias-label-tertiary);font-style:italic}
.${cls.chipX}{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.${cls.chipX}:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.${cls.chipX}:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:1px}
.${cls.suggest}{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.${cls.suggestLabel}{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.${cls.suggest} .${cls.chip}{cursor:pointer;border:1px dashed var(--dsw-alias-border-l4);background:transparent}
.${cls.suggest} .${cls.chip}:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.${cls.suggest} .${cls.chip}:disabled{cursor:default;opacity:.5}
.${cls.suggestNote}{color:var(--dsw-alias-label-tertiary);font-size:11px}
.${cls.auth}{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}
.${cls.authRow}{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.${cls.authRow}>input{flex:1 1 220px;min-width:0}
.${cls.authPending}{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.${cls.authCode}{font-family:var(--dsh-font-family-code-default, monospace);font-size:15px;letter-spacing:.08em}
.${cls.toggles}{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.${cls.switch}{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
.${cls.switch}[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.${cls.switch}:disabled{cursor:default;opacity:.5}
.${cls.switch}:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
.${cls.switch}[aria-checked=false] .${cls.thumb}{background:var(--dsw-alias-switch-thumb)}
.${cls.switch}[aria-checked=true] .${cls.thumb}{transform:translate(16px)}
.${cls.thumb}{display:block;width:16px;height:16px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-switch-thumb);transition:transform .16s ease}
.${cls.seg}{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:4px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);max-width:100%}
.${cls.segIndicator}{position:absolute;top:4px;left:4px;width:calc((100% - 8px - 2px * (var(--fc-segment-count) - 1)) / var(--fc-segment-count));height:calc(100% - 8px);border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);transform:translate(calc(var(--fc-segment-index) * (100% + 2px)));transition:transform .16s ease;pointer-events:none}
.${cls.segTab}{box-sizing:border-box;position:relative;z-index:1;height:28px;padding:0 14px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer;transition:color .12s ease}
.${cls.segTab}:hover:not(:disabled),.${cls.segTab}[aria-selected=true]{color:var(--dsw-alias-label-primary)}
.${cls.segTab}:disabled{cursor:default;opacity:.4}
.${cls.segTab}:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-2px}
.fc-toggles{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fc-toggles>button{appearance:none;border:0;background:none;padding:0;font:inherit;cursor:pointer}
.fc-toggles>button:disabled{cursor:default;opacity:.5}
.fc-toggles>button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:999px}
.fc-selectWrap{position:relative;display:flex;align-items:center}
.fc-selectWrap>select{appearance:none;padding-right:32px;cursor:pointer}
.fc-selectArrow{position:absolute;right:12px;pointer-events:none;color:var(--dsw-alias-label-tertiary);font-size:11px}
/*
 * Motion is decorative here (the segmented thumb and the switch), so it is
 * dropped wholesale when the OS asks for reduced motion.
 */
@media (prefers-reduced-motion: reduce){.${cls.segIndicator},.${cls.thumb}{transition:none}}
`

/** Inject the stylesheet once per document (the official plugins' pattern). */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-feishu-card'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = PANEL_CSS
  document.head.appendChild(tag)
}
