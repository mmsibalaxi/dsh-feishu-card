/**
 * Plugin configuration schema.
 *
 * Notes that matter for the desktop plugin manager:
 * - Every panel-editable field is `.volatile()`. The settings service only
 *   projects volatile fields into a form (see dsh-settings README).
 * - `appSecret` is `.role('secret')`: the value never crosses the wire back to
 *   the browser; the card only learns whether one exists. Writes therefore go
 *   through path-addressed `mutate` ops instead of a wholesale `replace`.
 * - Defaults live here, NOT in cordis.patch.yml: the patch only inserts the
 *   plugin row, and panel edits land in the profile patch as an override.
 */
import Schema from '@deepseek-ai/schemastery';
import { type FeishuCardConfig } from '../shared/types.js';
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    appId: Schema<string, string, "volatile">;
    appSecret: Schema<string, string, "volatile">;
    brand: Schema<"feishu" | "lark", "feishu" | "lark", "volatile-defined">;
    dmPolicy: Schema<"open" | "pairing" | "allowlist" | "disabled", "open" | "pairing" | "allowlist" | "disabled", "volatile-defined">;
    allowlist: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
    groupPolicy: Schema<"open" | "allowlist" | "disabled", "open" | "allowlist" | "disabled", "volatile-defined">;
    groupAllowlist: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
    groupSenderAllowlist: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
    requireMentionInGroups: Schema<boolean, boolean, "volatile-defined">;
    respondToMentionAll: Schema<boolean, boolean, "volatile-defined">;
    sessionScope: Schema<"chat" | "thread" | "sender", "chat" | "thread" | "sender", "volatile-defined">;
    replyMode: Schema<"streaming" | "text", "streaming" | "text", "volatile-defined">;
    footerFields: Schema<NoInfer<("model" | "status" | "context" | "elapsed" | "tokens")[]>, NoInfer<("model" | "status" | "context" | "elapsed" | "tokens")[]>, "volatile-defined">;
    flushIntervalMs: Schema<number, number, "volatile-defined">;
    contextWindows: Schema<NoInfer<Schemastery.ObjectS<{}>>, NoInfer<Schemastery.ObjectT<{}>>, "volatile">;
    provider: Schema<string, string, "volatile-defined">;
    model: Schema<string, string, "volatile-defined">;
    allowBots: Schema<"none" | "mentions" | "all", "none" | "mentions" | "all", "volatile-defined">;
    defaultWorkspace: Schema<string, string, "volatile-defined">;
    dedupTtlMs: Schema<number, number, "defined">;
    turnTimeoutMs: Schema<number, number, "volatile-defined">;
    showReasoning: Schema<boolean, boolean, "volatile-defined">;
    panelExpanded: Schema<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    appId: Schema<string, string, "volatile">;
    appSecret: Schema<string, string, "volatile">;
    brand: Schema<"feishu" | "lark", "feishu" | "lark", "volatile-defined">;
    dmPolicy: Schema<"open" | "pairing" | "allowlist" | "disabled", "open" | "pairing" | "allowlist" | "disabled", "volatile-defined">;
    allowlist: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
    groupPolicy: Schema<"open" | "allowlist" | "disabled", "open" | "allowlist" | "disabled", "volatile-defined">;
    groupAllowlist: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
    groupSenderAllowlist: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile">;
    requireMentionInGroups: Schema<boolean, boolean, "volatile-defined">;
    respondToMentionAll: Schema<boolean, boolean, "volatile-defined">;
    sessionScope: Schema<"chat" | "thread" | "sender", "chat" | "thread" | "sender", "volatile-defined">;
    replyMode: Schema<"streaming" | "text", "streaming" | "text", "volatile-defined">;
    footerFields: Schema<NoInfer<("model" | "status" | "context" | "elapsed" | "tokens")[]>, NoInfer<("model" | "status" | "context" | "elapsed" | "tokens")[]>, "volatile-defined">;
    flushIntervalMs: Schema<number, number, "volatile-defined">;
    contextWindows: Schema<NoInfer<Schemastery.ObjectS<{}>>, NoInfer<Schemastery.ObjectT<{}>>, "volatile">;
    provider: Schema<string, string, "volatile-defined">;
    model: Schema<string, string, "volatile-defined">;
    allowBots: Schema<"none" | "mentions" | "all", "none" | "mentions" | "all", "volatile-defined">;
    defaultWorkspace: Schema<string, string, "volatile-defined">;
    dedupTtlMs: Schema<number, number, "defined">;
    turnTimeoutMs: Schema<number, number, "volatile-defined">;
    showReasoning: Schema<boolean, boolean, "volatile-defined">;
    panelExpanded: Schema<boolean, boolean, "volatile-defined">;
}>>, "plain">;
/** The resolved config type the host half reads. */
export type ResolvedConfig = FeishuCardConfig;
/** What the plugin's `ctx.config` actually looks like: volatile fields are references. */
export type RawConfig = Record<keyof FeishuCardConfig, unknown>;
/**
 * Unwrap the Volatile references cordis hands us for `.volatile()` fields.
 *
 * Volatile is a feature, not a nuisance: the settings service updates the
 * reference in place when the panel saves, so reading through this helper on
 * every message makes panel edits take effect without restarting dsh.
 *
 * `raw` is undefined when the profile row carries no `config` block at all
 * (cordis passes `undefined` straight through), so every field falls back to
 * its schema default here.
 */
export declare function readConfig(raw: RawConfig | undefined): ResolvedConfig;
export default Config;
