window.__ModuleLoader__.load({
  id: "dsh-feishu-card",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");

// src/shared/types.ts
var PLUGIN_ID = "feishu-card";
var FOOTER_FIELDS = ["status", "model", "context", "elapsed", "tokens"];
var DEFAULT_FOOTER_FIELDS = ["status", "model", "context", "elapsed"];
var CONFIG_DEFAULTS = {
  brand: "feishu",
  dmPolicy: "allowlist",
  allowlist: [],
  groupPolicy: "allowlist",
  groupAllowlist: [],
  groupSenderAllowlist: [],
  requireMentionInGroups: true,
  respondToMentionAll: false,
  sessionScope: "chat",
  replyMode: "streaming",
  footerFields: DEFAULT_FOOTER_FIELDS,
  // 100ms = the cadence the user's Hermes bridge flushes at. The old 200ms read
  // as "一行一行" because Feishu's own typewriter (15ms/char) then printed a
  // whole burst at once.
  flushIntervalMs: 100,
  model: "",
  provider: "",
  allowBots: "none",
  contextWindows: {},
  defaultWorkspace: "",
  dedupTtlMs: 12 * 60 * 60 * 1e3,
  turnTimeoutMs: 10 * 60 * 1e3,
  showReasoning: false,
  panelExpanded: false
};

// src/client/styles.ts
var CSS_TAG_ID = "dsh-feishu-card/panel.css";
var cls = {
  form: "fc-form",
  section: "fc-section",
  sectionTitle: "fc-sectionTitle",
  field: "fc-field",
  head: "fc-head",
  labelGroup: "fc-labelGroup",
  label: "fc-label",
  badges: "fc-badges",
  reset: "fc-reset",
  input: "fc-input",
  hint: "fc-hint",
  invalid: "fc-invalid",
  footer: "fc-footer",
  save: "fc-save",
  ghost: "fc-ghost",
  failed: "fc-failed",
  tag: "fc-tag",
  switch: "fc-switch",
  thumb: "fc-thumb",
  seg: "fc-seg",
  segIndicator: "fc-segIndicator",
  segTab: "fc-segTab",
  chips: "fc-chips",
  chip: "fc-chip",
  chipName: "fc-chipName",
  chipId: "fc-chipId",
  chipX: "fc-chipX",
  suggest: "fc-suggest",
  suggestLabel: "fc-suggestLabel",
  suggestNote: "fc-suggestNote",
  auth: "fc-auth",
  authRow: "fc-authRow",
  authPending: "fc-authPending",
  authCode: "fc-authCode",
  toggles: "fc-toggles",
  selectWrap: "fc-selectWrap",
  selectArrow: "fc-selectArrow"
};
var PANEL_CSS = `
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
`;
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`)) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-feishu-card";
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = PANEL_CSS;
  document.head.appendChild(tag);
}

// src/client/staging.ts
function draftFrom(value) {
  return {
    appId: value.appId ?? "",
    appSecret: "",
    brand: value.brand ?? "feishu",
    dmPolicy: value.dmPolicy ?? "allowlist",
    groupPolicy: value.groupPolicy ?? "allowlist",
    allowlist: [...value.allowlist ?? []],
    groupAllowlist: [...value.groupAllowlist ?? []],
    groupSenderAllowlist: [...value.groupSenderAllowlist ?? []],
    // `?? true` matches CONFIG_DEFAULTS: showing "否" for a host that did not
    // report the field let one 保存 turn group-mention gating off by accident.
    requireMentionInGroups: value.requireMentionInGroups ?? true,
    respondToMentionAll: value.respondToMentionAll ?? false,
    allowBots: value.allowBots ?? "none",
    sessionScope: value.sessionScope ?? "chat",
    replyMode: value.replyMode ?? "streaming",
    footerFields: [...value.footerFields ?? []],
    flushIntervalMs: value.flushIntervalMs ?? 200,
    turnTimeoutMs: value.turnTimeoutMs ?? 6e5,
    showReasoning: value.showReasoning ?? false,
    panelExpanded: value.panelExpanded ?? false,
    model: value.model ?? "",
    provider: value.provider ?? "",
    defaultWorkspace: value.defaultWorkspace ?? ""
  };
}
function sameList(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
function sameDraft(a, b) {
  return a.appId === b.appId && a.appSecret === b.appSecret && a.brand === b.brand && a.dmPolicy === b.dmPolicy && a.groupPolicy === b.groupPolicy && sameList(a.allowlist, b.allowlist) && sameList(a.groupAllowlist, b.groupAllowlist) && sameList(a.groupSenderAllowlist, b.groupSenderAllowlist) && a.requireMentionInGroups === b.requireMentionInGroups && a.respondToMentionAll === b.respondToMentionAll && a.allowBots === b.allowBots && a.sessionScope === b.sessionScope && a.replyMode === b.replyMode && sameList(a.footerFields, b.footerFields) && a.flushIntervalMs === b.flushIntervalMs && a.turnTimeoutMs === b.turnTimeoutMs && a.showReasoning === b.showReasoning && a.panelExpanded === b.panelExpanded && a.model === b.model && a.provider === b.provider && a.defaultWorkspace === b.defaultWorkspace;
}
function isDirty(draft, saved) {
  return !sameDraft(draft, saved);
}
function saveOps(draft, saved) {
  const ops = [];
  const set = (path, value) => {
    const previous = saved[path];
    if (JSON.stringify(value) !== JSON.stringify(previous)) {
      ops.push({ op: "set", path: [path], value });
    }
  };
  set("appId", draft.appId);
  if (draft.appSecret) ops.push({ op: "set", path: ["appSecret"], value: draft.appSecret });
  set("brand", draft.brand);
  set("dmPolicy", draft.dmPolicy);
  set("groupPolicy", draft.groupPolicy);
  set("allowlist", draft.allowlist);
  set("groupAllowlist", draft.groupAllowlist);
  set("groupSenderAllowlist", draft.groupSenderAllowlist);
  set("requireMentionInGroups", draft.requireMentionInGroups);
  set("respondToMentionAll", draft.respondToMentionAll);
  set("allowBots", draft.allowBots);
  set("sessionScope", draft.sessionScope);
  set("replyMode", draft.replyMode);
  set("footerFields", draft.footerFields);
  set("flushIntervalMs", draft.flushIntervalMs);
  set("turnTimeoutMs", draft.turnTimeoutMs);
  set("showReasoning", draft.showReasoning);
  set("panelExpanded", draft.panelExpanded);
  set("model", draft.model);
  set("provider", draft.provider);
  set("defaultWorkspace", draft.defaultWorkspace);
  return ops;
}
function overriddenFields(snapshot) {
  const user = snapshot.user;
  if (!user) return /* @__PURE__ */ new Set();
  return new Set(Object.keys(user));
}
function resetOp(field) {
  return { op: "unset", path: [field] };
}
function toggleFooterField(fields, field) {
  return fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field];
}
function addId(ids, id) {
  const clean = id.trim();
  if (!clean || ids.includes(clean)) return ids;
  return [...ids, clean];
}
function removeId(ids, id) {
  return ids.filter((item) => item !== id);
}
function shortId(id) {
  return id.length <= 20 ? id : `${id.slice(0, 18)}…${id.slice(-4)}`;
}
function parseIds(text, prefix) {
  if (!text) return [];
  const bare = text.replace(/#[^\n]*/g, " ");
  const marked = bare.replace(/(?<!^)(?:ou_|oc_)/g, (match) => `
${match}`);
  const out = [];
  for (const raw of marked.split(/[\r\n,，;；\s]+/)) {
    let id = raw.trim();
    if (!id) continue;
    if (id.startsWith("@")) {
      const inner = id.slice(1);
      if (!inner.startsWith(prefix)) continue;
      id = inner;
    }
    id = id.replace(/^[(（<]/, "").replace(/[>)）]$/, "").trim();
    if (id) out.push(id);
  }
  return [...new Set(out)];
}
function idFormatOk(id, prefix) {
  return id.startsWith(prefix);
}
function malformedIds(ids, prefix) {
  return ids.filter((id) => !idFormatOk(id, prefix));
}
function secretConfigured(view, entryId) {
  const namespaces = view?.namespaces ?? [];
  const mine = namespaces.find((candidate) => candidate.ns === entryId);
  return (mine?.secrets ?? []).some((secret) => secret.set);
}

// src/client/models-api.ts
var MODELS_PATH = "/api/feishu-card/models";
function parseModels(payload) {
  if (typeof payload !== "object" || payload === null) return { choices: [] };
  const body = payload;
  const choices = [];
  if (Array.isArray(body.choices)) {
    for (const raw of body.choices) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw;
      if (typeof row.provider !== "string" || typeof row.model !== "string" || !row.model) continue;
      choices.push({
        provider: row.provider,
        model: row.model,
        label: typeof row.label === "string" && row.label ? row.label : row.model,
        ...typeof row.contextWindow === "number" ? { contextWindow: row.contextWindow } : {}
      });
    }
  }
  const fallback = typeof body.fallback === "object" && body.fallback !== null ? body.fallback : void 0;
  return {
    choices,
    ...fallback && typeof fallback.provider === "string" && typeof fallback.model === "string" ? { fallback: { provider: fallback.provider, model: fallback.model } } : {},
    ...typeof body.error === "string" && body.error ? { error: body.error } : {}
  };
}

// src/client/recent-api.ts
var RECENT_PATH = "/api/feishu-card/recent";
function parseRecent(payload) {
  if (typeof payload !== "object" || payload === null) return { people: [], chats: [] };
  const body = payload;
  const people = [];
  if (Array.isArray(body.people)) {
    for (const raw of body.people) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw;
      if (typeof row.openId !== "string" || !row.openId) continue;
      if (typeof row.chatId !== "string" || !row.chatId) continue;
      people.push({
        openId: row.openId,
        chatId: row.chatId,
        at: typeof row.at === "number" ? row.at : 0,
        count: typeof row.count === "number" ? row.count : 1
      });
    }
  }
  const chats = [];
  if (Array.isArray(body.chats)) {
    for (const raw of body.chats) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw;
      if (typeof row.chatId !== "string" || !row.chatId) continue;
      chats.push({ chatId: row.chatId, at: typeof row.at === "number" ? row.at : 0 });
    }
  }
  return { people, chats };
}
function agoText(at, now = Date.now()) {
  if (!at) return "未知时间";
  const seconds = Math.max(0, Math.round((now - at) / 1e3));
  if (seconds < 60) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

// src/client/auth-api.ts
var AUTH_PATH = "/api/feishu-card/auth";
var SEARCH_PATH = "/api/feishu-card/search";
var NAMES_PATH = "/api/feishu-card/names";
var CHAT_SEARCH_PATH = "/api/feishu-card/chat-search";
function authUrl(action) {
  return `${AUTH_PATH}?action=${action}`;
}
function searchUrl(query) {
  return `${SEARCH_PATH}?q=${encodeURIComponent(query)}`;
}
function chatSearchUrl(query) {
  return `${CHAT_SEARCH_PATH}?q=${encodeURIComponent(query)}`;
}
function namesUrl(ids) {
  return `${NAMES_PATH}?ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`;
}
function parseNames(payload) {
  if (typeof payload !== "object" || payload === null) return {};
  const out = {};
  for (const key of ["users", "chats", "names"]) {
    const bucket = payload[key];
    if (typeof bucket !== "object" || bucket === null) continue;
    for (const [id, name] of Object.entries(bucket)) {
      if (typeof name === "string" && name) out[id] = name;
    }
  }
  return out;
}
function parseAuth(payload) {
  if (typeof payload !== "object" || payload === null) return { authorized: false };
  const body = payload;
  const pending = typeof body.pending === "object" && body.pending !== null ? body.pending : void 0;
  return {
    authorized: body.authorized === true,
    ...body.needAuth === true ? { needAuth: true } : {},
    ...typeof body.userName === "string" && body.userName ? { userName: body.userName } : {},
    ...pending && typeof pending.userCode === "string" && typeof pending.verificationUri === "string" ? {
      pending: {
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        verificationUriComplete: typeof pending.verificationUriComplete === "string" ? pending.verificationUriComplete : pending.verificationUri,
        expiresAt: typeof pending.expiresAt === "number" ? pending.expiresAt : 0
      }
    } : {},
    ...typeof body.error === "string" && body.error ? { error: body.error } : {}
  };
}
function parseFound(payload) {
  if (typeof payload !== "object" || payload === null) return { people: [] };
  const body = payload;
  const people = [];
  if (Array.isArray(body.people)) {
    for (const raw of body.people) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw;
      if (typeof row.openId !== "string" || !row.openId) continue;
      people.push({
        openId: row.openId,
        name: typeof row.name === "string" && row.name ? row.name : row.openId
      });
    }
  }
  return { people, ...typeof body.error === "string" && body.error ? { error: body.error } : {} };
}
function parseFoundChats(payload) {
  if (typeof payload !== "object" || payload === null) return { chats: [] };
  const body = payload;
  const chats = [];
  if (Array.isArray(body.chats)) {
    for (const raw of body.chats) {
      if (typeof raw !== "object" || raw === null) continue;
      const row = raw;
      if (typeof row.chatId !== "string" || !row.chatId) continue;
      chats.push({
        chatId: row.chatId,
        name: typeof row.name === "string" && row.name ? row.name : "未命名群"
      });
    }
  }
  return { chats, ...typeof body.error === "string" && body.error ? { error: body.error } : {} };
}

// src/client/model-route.ts
function encodeModelRoute(provider, model) {
  return `${provider}\0${model}`;
}
function decodeModelRoute(value) {
  const at = value.indexOf("\0");
  if (at <= 0 || at === value.length - 1) return void 0;
  return { provider: value.slice(0, at), model: value.slice(at + 1) };
}
function modelRouteOf(provider, model) {
  if (!provider || !model) return "";
  return encodeModelRoute(provider, model);
}

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "configForms"];
var describeMirror;
function useSecretConfigured(entryId) {
  const mirror = describeMirror;
  return (0, import_react.useSyncExternalStore)(
    (listener) => mirror.subscribe(listener),
    () => secretConfigured(mirror.getSnapshot().view, entryId)
  );
}
function apply(ctx) {
  describeMirror = ctx.configForms.describe();
  ctx.effect(() => {
    ensureStyles();
    return () => {
    };
  }, "feishu-card: panel styles");
  const ownForm = ctx.configForms.get(PLUGIN_ID);
  ctx.effect(() => {
    const off = ctx.configForms.whileServed(
      [PLUGIN_ID],
      () => ctx.slots.inject(
        "plugins.item",
        () => ctx.slots.register(
          {
            name: "plugins.item",
            id: PLUGIN_ID,
            order: 50,
            label: () => "飞书",
            inject: () => ({ ownForm, useSecretConfigured })
          },
          SettingsCard
        )
      )
    );
    return () => off();
  });
}
function useForm(ownForm) {
  return (0, import_react.useSyncExternalStore)(
    (listener) => ownForm.subscribe(listener),
    () => ownForm.getSnapshot()
  );
}
var FIELD_LABELS = {
  status: "状态",
  model: "模型",
  context: "上下文占比",
  elapsed: "耗时",
  tokens: "Token 用量"
};
var DM_OPTIONS = [
  { value: "allowlist", label: "白名单" },
  { value: "open", label: "任何人" },
  { value: "disabled", label: "关闭私聊" }
];
var GROUP_OPTIONS = [
  { value: "allowlist", label: "白名单" },
  { value: "open", label: "任何群" },
  { value: "disabled", label: "关闭群聊" }
];
var SCOPE_OPTIONS = [
  { value: "chat", label: "每个群" },
  { value: "thread", label: "每个话题" },
  { value: "sender", label: "每个人" }
];
var MODE_OPTIONS = [
  { value: "streaming", label: "流式卡片" },
  { value: "text", label: "纯文本" }
];
var BRAND_OPTIONS = [
  { value: "feishu", label: "飞书" },
  { value: "lark", label: "Lark" }
];
var BOT_OPTIONS = [
  { value: "none", label: "都不响应" },
  { value: "mentions", label: "仅 @ 它时" },
  { value: "all", label: "全部响应" }
];
function Tag({ tone, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.tag, "data-tone": tone, children });
}
function Switch({
  checked,
  label,
  disabled,
  onChange
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      className: cls.switch,
      disabled,
      onClick: () => onChange(!checked),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.thumb })
    }
  );
}
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.field, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: 16 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.label, children: label }),
      hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.hint, children: hint }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Switch, { checked, label, disabled, onChange })
  ] }) });
}
function Segmented({
  label,
  value,
  options,
  disabled,
  onChange
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const onKeyDown = (event) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = options[(index + delta + options.length) % options.length];
    if (next && next.value !== value) onChange(next.value);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: cls.seg,
      role: "tablist",
      "aria-label": label,
      style: {
        "--fc-segment-count": String(options.length),
        "--fc-segment-index": String(index)
      },
      onKeyDown,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", className: cls.segIndicator }),
        options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": option.value === value,
            className: cls.segTab,
            disabled,
            onClick: () => onChange(option.value),
            children: option.label
          },
          option.value
        ))
      ]
    }
  );
}
function Field({
  label,
  htmlFor,
  hint,
  error,
  badges,
  children
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.labelGroup, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: cls.label, htmlFor, children: label }) }),
      badges ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.badges, children: badges }) : null
    ] }),
    children,
    error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.invalid, children: error }) : hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.hint, children: hint }) : null
  ] });
}
function Section({ title, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: cls.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: cls.sectionTitle, children: title }),
    children
  ] });
}
function IdListField({
  label,
  ids,
  prefix,
  placeholder,
  hint,
  disabled,
  badges,
  suggestions,
  searchable,
  searchChats,
  names,
  unknownLabel = "未知",
  note,
  onAuthChange,
  onChange
}) {
  const [text, setText] = (0, import_react.useState)("");
  const bad = malformedIds(ids, prefix);
  const fresh = (suggestions ?? []).filter((row) => !ids.includes(row.id)).slice(0, 8);
  const commit = () => {
    const parsed = parseIds(text, prefix);
    if (parsed.length > 0) onChange(parsed.reduce(addId, ids));
    setText("");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Field, { label, hint, badges, children: [
    searchable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      DirectorySearchBox,
      {
        disabled,
        onPick: (person) => onChange(addId(ids, person.openId)),
        ...onAuthChange ? { onAuthChange } : {}
      }
    ) : null,
    searchChats ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      GroupSearchBox,
      {
        disabled,
        onPick: (chat) => onChange(addId(ids, chat.chatId))
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        className: cls.input,
        value: text,
        "aria-label": `${label}（粘贴 id 后回车）`,
        spellCheck: false,
        autoComplete: "off",
        placeholder,
        disabled,
        onChange: (event) => setText(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          }
        },
        onBlur: commit
      }
    ),
    ids.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.chips, children: ids.map((id) => {
      const name = names?.[id];
      const ok = idFormatOk(id, prefix);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "span",
        {
          className: cls.chip,
          "data-tone": ok ? void 0 : "warning",
          title: id,
          children: [
            name ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.chipName, children: name }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.chipName, "data-tone": "unknown", children: unknownLabel }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: cls.chipX,
                "aria-label": `移除 ${name ?? id}`,
                disabled,
                onClick: () => onChange(removeId(ids, id)),
                children: "✕"
              }
            )
          ]
        },
        id
      );
    }) }) : null,
    bad.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: cls.invalid, children: [
      "⚠ 有 ",
      bad.length,
      " 个不是 ",
      prefix,
      " 开头（",
      bad.map((id) => shortId(id)).join("、"),
      "），保存了也不会生效"
    ] }) : null,
    note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.suggestLabel, children: note }) : null,
    fresh.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.suggest, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.suggestLabel, children: "机器人见过的人，点一下加入：" }),
      fresh.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: cls.chip,
          title: row.id,
          disabled,
          onClick: () => onChange(addId(ids, row.id)),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.chipName, children: names?.[row.id] ?? unknownLabel }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.suggestNote, children: row.note })
          ]
        },
        row.id
      ))
    ] }) : null
  ] });
}
function DirectorySearchBox({
  disabled,
  onPick,
  onAuthChange
}) {
  const [auth, setAuth] = (0, import_react.useState)({ authorized: false });
  const [query, setQuery] = (0, import_react.useState)("");
  const [found, setFound] = (0, import_react.useState)([]);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [note, setNote] = (0, import_react.useState)(void 0);
  const refresh = () => {
    fetch(authUrl("state")).then((response) => response.json()).then((payload) => {
      const parsed = parseAuth(payload);
      setAuth(parsed);
      onAuthChange?.(parsed);
    }).catch(() => void 0);
  };
  (0, import_react.useEffect)(() => {
    refresh();
  }, []);
  (0, import_react.useEffect)(() => {
    if (!auth.pending) return;
    const timer = setInterval(() => {
      fetch(authUrl("poll")).then((response) => response.json()).then((payload) => {
        const parsed = parseAuth(payload);
        setAuth(parsed);
        onAuthChange?.(parsed);
      }).catch(() => void 0);
    }, 4e3);
    return () => clearInterval(timer);
  }, [auth.pending?.userCode]);
  const begin = async () => {
    setBusy(true);
    setNote(void 0);
    try {
      const response = await fetch(authUrl("begin"));
      setAuth(parseAuth(await response.json()));
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    await fetch(authUrl("forget"));
    setAuth({ authorized: false });
    setFound([]);
  };
  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setNote(void 0);
    try {
      const response = await fetch(searchUrl(query));
      const payload = await response.json();
      const parsed = parseFound(payload);
      setFound(parsed.people);
      if (parsed.error) {
        setNote(parsed.error);
        refresh();
      } else if (parsed.people.length === 0) setNote("没搜到人。换个关键词试试，或者直接粘贴 open_id。");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.auth, children: [
    auth.pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.authPending, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        "在飞书里确认授权：",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { className: cls.authCode, children: auth.pending.userCode })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "a",
        {
          className: "fc-link",
          href: auth.pending.verificationUriComplete,
          target: "_blank",
          rel: "noopener noreferrer",
          children: "打开授权页 →"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.suggestLabel, children: "等待确认…（这个码 10 分钟内有效）" })
    ] }) : auth.needAuth ? (
      // The token is dead and cannot be refreshed. Saying so beats a search box
      // that answers every query with a token error (2026-11-10).
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.authRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: cls.suggestLabel, children: [
          "授权已过期",
          auth.userName ? `（${auth.userName}）` : "",
          "，需要重新授权一次； 已缓存的人名不受影响。"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: cls.ghost, disabled: disabled || busy, onClick: () => void begin(), children: busy ? "准备中…" : "重新授权" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: cls.reset, disabled, onClick: () => void forget(), children: "断开" })
      ] })
    ) : auth.authorized ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.authRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: cls.input,
          value: query,
          placeholder: "输入姓名搜索通讯录，回车",
          "aria-label": "按姓名搜索通讯录",
          spellCheck: false,
          disabled: disabled || busy,
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: cls.ghost,
          disabled: disabled || busy || !query.trim(),
          onClick: () => void search(),
          children: busy ? "搜索中…" : "搜索"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: cls.reset, disabled, onClick: () => void forget(), children: auth.userName ? `已授权为 ${auth.userName} · 断开` : "断开授权" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.authRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: cls.suggestLabel, children: [
        "机器人看不到通讯录（应用可见范围只有个别人），但可以用",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "你自己的身份" }),
        "搜人。"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: cls.ghost, disabled: disabled || busy, onClick: () => void begin(), children: busy ? "准备中…" : "用我的身份搜索通讯录" })
    ] }),
    found.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.suggest, children: found.map((person) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: cls.chip,
        title: person.openId,
        disabled,
        onClick: () => onPick(person),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.chipName, children: person.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.suggestNote, children: "点一下加入" })
        ]
      },
      person.openId
    )) }) : null,
    note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.invalid, children: note }) : null,
    auth.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.invalid, children: auth.error }) : null
  ] });
}
function GroupSearchBox({
  disabled,
  onPick
}) {
  const [query, setQuery] = (0, import_react.useState)("");
  const [found, setFound] = (0, import_react.useState)([]);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [note, setNote] = (0, import_react.useState)(void 0);
  const runSearch = async (text) => {
    setBusy(true);
    setNote(void 0);
    try {
      const response = await fetch(chatSearchUrl(text));
      const parsed = parseFoundChats(await response.json());
      setFound(parsed.chats);
      if (parsed.error) setNote(parsed.error);
      else if (parsed.chats.length === 0 && text.trim()) {
        setNote("没搜到群。机器人只能搜到「自己在的群」，先把它拉进群再试。");
      }
    } catch (error) {
      setNote(`搜索失败：${String(error).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  };
  (0, import_react.useEffect)(() => {
    void runSearch("");
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.auth, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.authRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: cls.input,
          value: query,
          placeholder: "输入群名称搜索，回车",
          "aria-label": "按名称搜索群",
          spellCheck: false,
          disabled: disabled || busy,
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch(query);
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: cls.ghost,
          disabled: disabled || busy || !query.trim(),
          onClick: () => void runSearch(query),
          children: busy ? "搜索中…" : "搜索"
        }
      )
    ] }),
    found.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.suggest, children: found.map((chat) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: cls.chip,
        title: chat.chatId,
        disabled,
        onClick: () => onPick(chat),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.chipName, children: chat.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cls.suggestNote, children: "点一下加入" })
        ]
      },
      chat.chatId
    )) }) : null,
    note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.invalid, children: note }) : null
  ] });
}
function SettingsCard({ ownForm, form: hostForm, useSecretConfigured: useSecretConfigured2, view }) {
  const snapshot = useForm(ownForm);
  const value = snapshot.value;
  if (view === "summary") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-sm opacity-70", children: "飞书机器人接入：白名单、流式卡片、底部状态行" });
  }
  if (snapshot.status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "p-4 text-sm opacity-60", children: "加载中…" });
  if (snapshot.status === "unavailable" || !value) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "p-4 text-sm opacity-60", children: [
      "插件未启用或宿主未暴露配置（entry id：",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: PLUGIN_ID }),
      "）。"
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    SettingsPage,
    {
      snapshot,
      value,
      hostForm,
      ownForm,
      secretSet: useSecretConfigured2 ? useSecretConfigured2(PLUGIN_ID) : false
    }
  );
}
function SettingsPage({
  snapshot,
  value,
  hostForm,
  ownForm,
  secretSet
}) {
  const saved = (0, import_react.useMemo)(() => draftFrom(value), [value]);
  const [edits, setEdits] = (0, import_react.useState)({});
  const draft = { ...saved, ...edits };
  const dirty = isDirty(draft, saved);
  const overridden = overriddenFields(snapshot);
  const writable = snapshot.writable !== false;
  const disabled = !writable;
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const [savedNote, setSavedNote] = (0, import_react.useState)(void 0);
  const [catalog, setCatalog] = (0, import_react.useState)({ choices: [] });
  (0, import_react.useEffect)(() => {
    let alive = true;
    fetch(MODELS_PATH).then((response) => response.json()).then((payload) => {
      if (alive) setCatalog(parseModels(payload));
    }).catch(() => void 0);
    return () => {
      alive = false;
    };
  }, []);
  const [recentSeen, setRecentSeen] = (0, import_react.useState)({ people: [], chats: [] });
  (0, import_react.useEffect)(() => {
    let alive = true;
    const load = () => {
      fetch(RECENT_PATH).then((response) => response.json()).then((payload) => {
        if (alive) setRecentSeen(parseRecent(payload));
      }).catch(() => void 0);
    };
    load();
    const timer = setInterval(load, 15e3);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const [names, setNames] = (0, import_react.useState)({});
  const [namesReady, setNamesReady] = (0, import_react.useState)(false);
  const [namesEpoch, setNamesEpoch] = (0, import_react.useState)(0);
  const nameIds = [
    ...draft.allowlist,
    ...draft.groupSenderAllowlist,
    ...draft.groupAllowlist,
    ...recentSeen.people.map((row) => row.openId),
    ...recentSeen.chats.map((row) => row.chatId)
  ].filter((id, index, all) => Boolean(id) && all.indexOf(id) === index).slice(0, 60).join(",");
  const [namesError, setNamesError] = (0, import_react.useState)(void 0);
  (0, import_react.useEffect)(() => {
    if (!nameIds) {
      setNames({});
      setNamesReady(true);
      return;
    }
    let alive = true;
    setNamesReady(false);
    fetch(namesUrl(nameIds.split(","))).then((response) => response.json()).then((payload) => {
      if (!alive) return;
      setNames(parseNames(payload));
      setNamesError(
        typeof payload.error === "string" ? payload.error ?? void 0 : void 0
      );
      setNamesReady(true);
    }).catch(() => {
      if (alive) setNamesReady(true);
    });
    return () => {
      alive = false;
    };
  }, [nameIds, namesEpoch]);
  const unresolved = (ids) => {
    if (!namesReady) return void 0;
    const missing = ids.filter((id) => id && !names[id]).length;
    if (missing === 0) return void 0;
    if (namesError) return namesError;
    return `有 ${missing} 个名字解析不出来（可能不在应用可见范围内），鼠标悬停可以看到对应 id。`;
  };
  const mutate = async (ops) => {
    const target = hostForm ?? ownForm;
    return target.mutate(ops, snapshot.revision);
  };
  const set = (key, next) => {
    setSavedNote(void 0);
    setEdits((previous) => ({ ...previous, [key]: next }));
  };
  const save = async () => {
    if (!dirty || saving) return;
    const ops = saveOps(draft, saved);
    setSaving(true);
    setFailed(false);
    const ok = ops.length === 0 ? true : await mutate(ops);
    setSaving(false);
    if (ok) {
      setEdits({});
      setSavedNote("已保存");
    } else {
      setFailed(true);
    }
  };
  const discard = () => {
    setEdits({});
    setFailed(false);
    setSavedNote(void 0);
  };
  const resetField = async (field) => {
    setSavedNote(void 0);
    const ok = await mutate([resetOp(field)]);
    if (ok) {
      setEdits((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    } else {
      setFailed(true);
    }
  };
  const showAllowlist = draft.dmPolicy === "allowlist";
  const showGroups = draft.groupPolicy === "allowlist";
  const modelRoute = modelRouteOf(draft.provider, draft.model);
  const choices = catalog.choices;
  const fallbackLabel = catalog.fallback ? `${catalog.fallback.provider}/${catalog.fallback.model}` : void 0;
  const modelHint = choices.length > 0 ? `留空跟随默认模型${fallbackLabel ? `（${fallbackLabel}）` : ""}` : catalog.error ?? "没有可选的模型，请手动填写模型 id";
  const modelError = choices.length > 0 ? void 0 : catalog.error;
  const badge = (field) => overridden.has(field) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tone: "neutral", children: "已覆盖" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: cls.reset,
        disabled,
        onClick: () => void resetField(field),
        children: "恢复默认"
      }
    )
  ] }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.form, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { title: "连接", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "App ID", htmlFor: "feishu-app-id", badges: badge("appId"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          id: "feishu-app-id",
          className: cls.input,
          value: draft.appId,
          placeholder: "cli_ 开头",
          autoComplete: "off",
          spellCheck: false,
          disabled,
          onChange: (event) => set("appId", event.target.value)
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          label: "App Secret",
          htmlFor: "feishu-app-secret",
          hint: "留空表示不修改已保存的密钥",
          badges: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            secretSet ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tone: "success", children: "已保存密钥" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tone: "quiet", children: "未配置" }),
            badge("appSecret")
          ] }),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "feishu-app-secret",
              className: cls.input,
              type: "password",
              autoComplete: "new-password",
              value: draft.appSecret,
              placeholder: secretSet ? "已保存" : "粘贴 App Secret",
              disabled,
              onChange: (event) => set("appSecret", event.target.value)
            }
          )
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "版本", badges: badge("brand"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Segmented,
        {
          label: "版本",
          value: draft.brand,
          options: BRAND_OPTIONS,
          disabled,
          onChange: (next) => set("brand", next)
        }
      ) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { title: "访问控制", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "私聊策略", badges: badge("dmPolicy"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Segmented,
        {
          label: "私聊策略",
          value: draft.dmPolicy,
          options: DM_OPTIONS,
          disabled,
          onChange: (next) => set("dmPolicy", next)
        }
      ) }),
      showAllowlist ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        IdListField,
        {
          label: "允许的人",
          ids: draft.allowlist,
          prefix: "ou_",
          placeholder: "粘贴 open_id，回车加入；逗号、空格、连着写都能认",
          hint: "open_id 按应用隔离，同一个人在不同应用下不一样。不会取可以让 agent 代劳，它能按姓名从飞书查到。",
          disabled,
          badges: badge("allowlist"),
          searchable: true,
          names,
          unknownLabel: "未知用户",
          note: unresolved(draft.allowlist),
          onAuthChange: (state) => {
            if (state.authorized) setNamesEpoch((value2) => value2 + 1);
          },
          suggestions: recentSeen.people.map((row) => ({
            id: row.openId,
            note: `${agoText(row.at)}${row.count > 1 ? ` · ${row.count} 条` : ""}`
          })),
          onChange: (next) => set("allowlist", next)
        }
      ) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "群聊策略", badges: badge("groupPolicy"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Segmented,
        {
          label: "群聊策略",
          value: draft.groupPolicy,
          options: GROUP_OPTIONS,
          disabled,
          onChange: (next) => set("groupPolicy", next)
        }
      ) }),
      showGroups ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          IdListField,
          {
            label: "允许的群",
            ids: draft.groupAllowlist,
            prefix: "oc_",
            placeholder: "粘贴 chat_id，回车加入；逗号、空格、连着写都能认",
            hint: "chat_id 是 oc_ 开头的一串字符。可以让 agent 从群消息报文里取（message.chat_id）。",
            disabled,
            badges: badge("groupAllowlist"),
            names,
            unknownLabel: "未知群",
            note: unresolved(draft.groupAllowlist),
            searchChats: true,
            suggestions: recentSeen.chats.map((row) => ({ id: row.chatId, note: agoText(row.at) })),
            onChange: (next) => set("groupAllowlist", next)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          IdListField,
          {
            label: "群里只响应这些人（可选）",
            ids: draft.groupSenderAllowlist,
            prefix: "ou_",
            placeholder: "不填就是群里所有人都可以",
            hint: "填了就只有名单内的人能跟机器人说话。ou_ 开头的 open_id。",
            disabled,
            badges: badge("groupSenderAllowlist"),
            names,
            unknownLabel: "未知用户",
            suggestions: recentSeen.people.map((row) => ({
              id: row.openId,
              note: agoText(row.at)
            })),
            onChange: (next) => set("groupSenderAllowlist", next)
          }
        )
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: "群里需要 @机器人 才响应",
          checked: draft.requireMentionInGroups,
          disabled,
          onChange: (next) => set("requireMentionInGroups", next)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: "@所有人 也算提及",
          hint: "关闭时，@所有人 不会触发机器人（推荐关闭）",
          checked: draft.respondToMentionAll,
          disabled,
          onChange: (next) => set("respondToMentionAll", next)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          label: "别人/其它机器人的消息",
          hint: "默认忽略，避免两个机器人互相触发死循环",
          badges: badge("allowBots"),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Segmented,
            {
              label: "机器人消息策略",
              value: draft.allowBots,
              options: BOT_OPTIONS,
              disabled,
              onChange: (next) => set("allowBots", next)
            }
          )
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { title: "会话与回复", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "会话粒度", hint: "哪几条消息算同一个上下文", badges: badge("sessionScope"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Segmented,
        {
          label: "会话粒度",
          value: draft.sessionScope,
          options: SCOPE_OPTIONS,
          disabled,
          onChange: (next) => set("sessionScope", next)
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "回复模式", badges: badge("replyMode"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Segmented,
        {
          label: "回复模式",
          value: draft.replyMode,
          options: MODE_OPTIONS,
          disabled,
          onChange: (next) => set("replyMode", next)
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          label: "默认工作目录",
          htmlFor: "feishu-workspace",
          hint: "留空则会话不属于任何工作区，Harness 里点不开它的历史",
          badges: badge("defaultWorkspace"),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "feishu-workspace",
              className: cls.input,
              value: draft.defaultWorkspace,
              placeholder: "例如 D:\\workspace",
              autoComplete: "off",
              spellCheck: false,
              disabled,
              onChange: (event) => set("defaultWorkspace", event.target.value)
            }
          )
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          label: "模型",
          htmlFor: "feishu-model",
          hint: modelHint,
          badges: badge("model"),
          children: choices.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "fc-selectWrap", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "select",
              {
                id: "feishu-model",
                className: cls.input,
                value: modelRoute,
                disabled,
                onChange: (event) => {
                  const route = decodeModelRoute(event.target.value);
                  if (!route) {
                    set("provider", "");
                    set("model", "");
                    return;
                  }
                  set("provider", route.provider);
                  set("model", route.model);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: "", children: [
                    "跟随默认模型",
                    fallbackLabel ? `（${fallbackLabel}）` : ""
                  ] }),
                  choices.map((choice) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                    "option",
                    {
                      value: `${choice.provider}\0${choice.model}`,
                      children: [
                        choice.provider,
                        "/",
                        choice.model,
                        choice.label && choice.label !== choice.model ? ` · ${choice.label}` : ""
                      ]
                    },
                    `${choice.provider}\0${choice.model}`
                  ))
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", className: "fc-selectArrow", children: "▾" })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: "feishu-model",
                className: cls.input,
                value: draft.model,
                placeholder: "例如 auto/step-5-preview",
                autoComplete: "off",
                spellCheck: false,
                disabled,
                onChange: (event) => set("model", event.target.value)
              }
            ),
            modelError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.invalid, children: modelError }) : null
          ] })
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { title: "过程面板", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: "显示模型的思考过程",
          hint: "打开后卡片里会出现「🧠 …」，长回合能看到它在想什么；会多刷几次卡片",
          checked: draft.showReasoning,
          disabled,
          onChange: (next) => set("showReasoning", next)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ToggleRow,
        {
          label: "回合结束后保持面板展开",
          hint: "关闭时答案占满整张卡片（hermes 默认行为）",
          checked: draft.panelExpanded,
          disabled,
          onChange: (next) => set("panelExpanded", next)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          label: "单回合超时（毫秒）",
          htmlFor: "feishu-timeout",
          hint: "超过就取消这一轮并封卡，避免它一直跑；默认 600000（10 分钟）",
          badges: badge("turnTimeoutMs"),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "feishu-timeout",
              className: cls.input,
              type: "number",
              min: 3e4,
              step: 3e4,
              value: String(draft.turnTimeoutMs),
              disabled,
              onChange: (event) => set("turnTimeoutMs", Number(event.target.value) || 0)
            }
          )
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { title: "底部状态行", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: "显示哪些内容", badges: badge("footerFields"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: cls.toggles, children: FOOTER_FIELDS.map((field) => {
        const on = draft.footerFields.includes(field);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            "aria-pressed": on,
            disabled,
            onClick: () => set("footerFields", toggleFooterField(draft.footerFields, field)),
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tag, { tone: on ? "info" : "quiet", children: [
              on ? "✓ " : "",
              FIELD_LABELS[field]
            ] })
          },
          field
        );
      }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          label: "刷新间隔（毫秒）",
          htmlFor: "feishu-flush",
          hint: "流式卡片更新的最小间隔，太小容易撞飞书的频率限制",
          badges: badge("flushIntervalMs"),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "feishu-flush",
              className: cls.input,
              type: "number",
              min: 200,
              step: 100,
              value: String(draft.flushIntervalMs),
              disabled,
              onChange: (event) => set("flushIntervalMs", Number(event.target.value) || 0)
            }
          )
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: cls.footer, children: [
      failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.failed, role: "status", children: "没有保存成功，请再点一次「保存」。" }) : null,
      !failed && savedNote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { tone: "success", children: savedNote }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
      dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: cls.ghost, onClick: discard, disabled: saving, children: "放弃更改" }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: cls.save,
          onClick: () => void save(),
          disabled: !dirty || saving || disabled,
          children: saving ? "保存中…" : "保存"
        }
      )
    ] }),
    !writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: cls.hint, role: "status", style: { paddingTop: 12 }, children: "当前 profile 不接受表单写入（只读），请编辑 profile patch。" }) : null
  ] });
}
    return module.exports;
  },
})
//# sourceMappingURL=index.js.map
