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
export declare const CSS_TAG_ID = "dsh-feishu-card/panel.css";
/** The class names, so components never repeat literal strings. */
export declare const cls: {
    readonly form: "fc-form";
    readonly section: "fc-section";
    readonly sectionTitle: "fc-sectionTitle";
    readonly field: "fc-field";
    readonly head: "fc-head";
    readonly labelGroup: "fc-labelGroup";
    readonly label: "fc-label";
    readonly badges: "fc-badges";
    readonly reset: "fc-reset";
    readonly input: "fc-input";
    readonly hint: "fc-hint";
    readonly invalid: "fc-invalid";
    readonly footer: "fc-footer";
    readonly save: "fc-save";
    readonly ghost: "fc-ghost";
    readonly failed: "fc-failed";
    readonly tag: "fc-tag";
    readonly switch: "fc-switch";
    readonly thumb: "fc-thumb";
    readonly seg: "fc-seg";
    readonly segIndicator: "fc-segIndicator";
    readonly segTab: "fc-segTab";
    readonly chips: "fc-chips";
    readonly chip: "fc-chip";
    readonly chipName: "fc-chipName";
    readonly chipId: "fc-chipId";
    readonly chipX: "fc-chipX";
    readonly suggest: "fc-suggest";
    readonly suggestLabel: "fc-suggestLabel";
    readonly suggestNote: "fc-suggestNote";
    readonly auth: "fc-auth";
    readonly authRow: "fc-authRow";
    readonly authPending: "fc-authPending";
    readonly authCode: "fc-authCode";
    readonly toggles: "fc-toggles";
    readonly selectWrap: "fc-selectWrap";
    readonly selectArrow: "fc-selectArrow";
};
export declare const PANEL_CSS: string;
/** Inject the stylesheet once per document (the official plugins' pattern). */
export declare function ensureStyles(): void;
