/**
 * Staged-form logic for the settings panel.
 *
 * The host's own form model (`SettingsFormModel` in
 * `@deepseek-ai/dsh-client-ui-primitives`) stages every edit in the browser and
 * writes once, on 保存: `dirty` = "a staged edit exists", `overridden` = "the
 * user layer owns this field", a refused write keeps the draft and shows
 * `failed`. This module is that contract, reduced to the fields our panel
 * shows, and kept free of React so it can be unit-tested.
 *
 * Two host facts shape it:
 *  - `appSecret` is `.role('secret')`: it never comes back, so an empty box
 *    means "keep the stored secret" and must produce no op.
 *  - Every field is `.volatile()`, so a `set` op lands in the profile patch and
 *    the host re-reads it live — no restart.
 */
import type { BotPolicy, Brand, DmPolicy, FeishuCardConfig, FooterField, GroupPolicy, ReplyMode, SessionScope } from '../shared/types.js';
/** One secret position as the settings view reports it. */
export interface SecretPosition {
    path: string[];
    set: boolean;
}
/** The subset of the config the panel edits, as the browser holds it. */
export interface Draft {
    appId: string;
    /** Only ever what was typed; never a value read back from the host. */
    appSecret: string;
    brand: Brand;
    dmPolicy: DmPolicy;
    groupPolicy: GroupPolicy;
    allowlist: string[];
    groupAllowlist: string[];
    groupSenderAllowlist: string[];
    requireMentionInGroups: boolean;
    respondToMentionAll: boolean;
    allowBots: BotPolicy;
    sessionScope: SessionScope;
    replyMode: ReplyMode;
    footerFields: FooterField[];
    flushIntervalMs: number;
    turnTimeoutMs: number;
    showReasoning: boolean;
    panelExpanded: boolean;
    model: string;
    provider: string;
    defaultWorkspace: string;
}
/** Mirror of the wire op shape; see ConfigForm.mutate in dsh-client-ui-settings. */
export type PathOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
/** What a form snapshot carries beyond the value itself. */
export interface Snapshot {
    value?: FeishuCardConfig;
    base?: Record<string, unknown>;
    user?: Record<string, unknown>;
}
export declare function draftFrom(value: FeishuCardConfig): Draft;
/** Field-by-field equality; `appSecret` is compared as "was something typed". */
export declare function sameDraft(a: Draft, b: Draft): boolean;
/** Whether the 保存 button should be enabled. */
export declare function isDirty(draft: Draft, saved: Draft): boolean;
/**
 * The ops one 保存 writes: only fields that actually changed, so an unrelated
 * field's stored value is never rewritten (and a revision conflict stays
 * unlikely). An empty secret box is deliberately not an op.
 */
export declare function saveOps(draft: Draft, saved: Draft): PathOp[];
/**
 * Which fields the user layer owns — the host's own definition of "overridden",
 * and therefore of when the 恢复默认 button appears. A value that merely equals
 * the default is NOT overridden; only a stored override is.
 */
export declare function overriddenFields(snapshot: Snapshot): Set<string>;
/** The op that hands one field back to the deployment default. */
export declare function resetOp(field: keyof Draft): PathOp;
/** Toggle one footer field, keeping the array's order stable. */
export declare function toggleFooterField(fields: FooterField[], field: FooterField): FooterField[];
/** Add an id to an allowlist, ignoring blanks and duplicates. */
export declare function addId(ids: string[], id: string): string[];
/** Remove one id from an allowlist. */
export declare function removeId(ids: string[], id: string): string[];
/** `ou_0000000000…0000` — enough to recognise an id in a chip without wrapping. */
export declare function shortId(id: string): string;
/** Render an id list back into the paste box. */
export declare function formatIds(ids: readonly string[]): string;
/**
 * Parse whatever a human pasted into ids.
 *
 * Deliberately greedy, because this is a paste target and every habit exists:
 * newlines, half/full-width commas, semicolon, tabs, `#` comments, and two ids
 * written **with no separator at all** (`ou_abc123ou_def456`) all resolve to
 * the same list. The last one works by marking every occurrence of the prefix
 * that is not at the start, so the normal split can do the rest.
 *
 * A leading `@` is read as a mention decoration: `@张三 (ou_abc123)` yields
 * the id only, while `@ou_abc123` (an id that merely carries the sign) is kept.
 *
 * @param text - raw paste-box content
 * @param prefix - the id prefix this list expects (`ou_` or `oc_`)
 */
export declare function parseIds(text: string | undefined, prefix: string): string[];
/** Whether an id looks like the kind this list holds. */
export declare function idFormatOk(id: string, prefix: string): boolean;
/** The entries that do not match the expected prefix, for the warning line. */
export declare function malformedIds(ids: readonly string[], prefix: string): string[];
/**
 * Whether a `role('secret')` field currently holds a value.
 *
 * This CANNOT be read from the form snapshot: `ConfigFormController.derive()`
 * projects only `revision`/`base`/`user`/`writable`/`value` onto its store, so
 * the host's `secrets` positions never reach it (verified in the shipped
 * bundle — the App Secret badge read `undefined` and always said 未配置).
 * The shared describe mirror carries the descriptors verbatim, so that is where
 * this reads from.
 *
 * @param view - the mirror snapshot's `view`, or undefined while loading
 * @param entryId - our settings namespace
 */
export declare function secretConfigured(view: {
    namespaces?: readonly {
        ns?: string;
        secrets?: readonly SecretPosition[];
    }[];
} | undefined, entryId: string): boolean;
