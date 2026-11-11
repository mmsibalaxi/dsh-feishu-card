// src/host/index.ts
import { homedir as homedir3 } from "node:os";
import path7 from "node:path";

// src/host/config.ts
import Schema from "@deepseek-ai/schemastery";
import { isVolatile } from "@deepseek-ai/cosmokit";

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

// src/host/config.ts
var brand = Schema.union([
  Schema.const("feishu"),
  Schema.const("lark")
]).default(CONFIG_DEFAULTS.brand);
var dmPolicy = Schema.union([
  Schema.const("open"),
  Schema.const("pairing"),
  Schema.const("allowlist"),
  Schema.const("disabled")
]).default(CONFIG_DEFAULTS.dmPolicy);
var groupPolicy = Schema.union([
  Schema.const("open"),
  Schema.const("allowlist"),
  Schema.const("disabled")
]).default(CONFIG_DEFAULTS.groupPolicy);
var sessionScope = Schema.union([
  Schema.const("chat"),
  Schema.const("thread"),
  Schema.const("sender")
]).default(CONFIG_DEFAULTS.sessionScope);
var replyMode = Schema.union([
  Schema.const("streaming"),
  Schema.const("text")
]).default(CONFIG_DEFAULTS.replyMode);
var Config = Schema.object({
  appId: Schema.string().description("飞书应用 App ID（cli_ 开头）。留空则插件不启动桥接，只注册工具").volatile(),
  appSecret: Schema.string().role("secret").description("飞书应用 App Secret。只写不回显；留空表示不修改已保存的密钥").volatile(),
  brand: brand.volatile(),
  dmPolicy: dmPolicy.volatile(),
  allowlist: Schema.array(Schema.string()).description("私聊 open_id 白名单（一行一个）。dmPolicy=allowlist 时只放行名单内的人").volatile(),
  groupPolicy: groupPolicy.volatile(),
  groupAllowlist: Schema.array(Schema.string()).description("群 chat_id 白名单（oc_ 开头，一行一个）。groupPolicy=allowlist 时只在这些群响应").volatile(),
  groupSenderAllowlist: Schema.array(Schema.string()).description("可选：群内只响应这些人（open_id）。留空 = 白名单群里所有人都可以").volatile(),
  requireMentionInGroups: Schema.boolean().default(CONFIG_DEFAULTS.requireMentionInGroups).description("群里需要 @机器人 才响应").volatile(),
  respondToMentionAll: Schema.boolean().default(CONFIG_DEFAULTS.respondToMentionAll).description("@所有人 是否算作提及").volatile(),
  sessionScope: sessionScope.volatile(),
  replyMode: replyMode.volatile(),
  footerFields: Schema.array(Schema.union(FOOTER_FIELDS.map((f) => Schema.const(f)))).default([...CONFIG_DEFAULTS.footerFields]).description("底部状态行字段，顺序即展示顺序").volatile(),
  flushIntervalMs: Schema.number().default(CONFIG_DEFAULTS.flushIntervalMs).description("流式卡片刷新节流（毫秒）").volatile(),
  contextWindows: Schema.object({}).description("模型 id → 上下文窗口 token 数，用于底部「已用/窗口 (占比)」").volatile(),
  provider: Schema.string().default(CONFIG_DEFAULTS.provider).description("模型所属的 provider 路由，和「模型」一起填。留空跟随默认模型").volatile(),
  model: Schema.string().default(CONFIG_DEFAULTS.model).description("桥接创建的 agent 使用的模型 id。留空跟随默认模型").volatile(),
  allowBots: Schema.union([Schema.const("none"), Schema.const("mentions"), Schema.const("all")]).default(CONFIG_DEFAULTS.allowBots).description("是否让机器人/应用发送的消息驱动 agent。none=一律忽略（推荐）").volatile(),
  defaultWorkspace: Schema.string().default(CONFIG_DEFAULTS.defaultWorkspace).description("新会话的默认工作目录（绝对路径）。留空则不属于任何工作区，Harness 里点不开它的历史").volatile(),
  dedupTtlMs: Schema.number().default(CONFIG_DEFAULTS.dedupTtlMs).description("消息去重窗口（毫秒）"),
  turnTimeoutMs: Schema.number().default(CONFIG_DEFAULTS.turnTimeoutMs).description("单个回合最长等待（毫秒），超时会取消 agent 并封卡").volatile(),
  showReasoning: Schema.boolean().default(CONFIG_DEFAULTS.showReasoning).description("在卡片的思考面板里显示模型的推理过程").volatile(),
  panelExpanded: Schema.boolean().default(CONFIG_DEFAULTS.panelExpanded).description("回合结束后保持思考面板展开").volatile()
});
function readConfig(raw) {
  const source = raw ?? {};
  const plain = (value, fallback) => {
    const resolved = isVolatile(value) ? value.get() : value;
    return resolved ?? fallback;
  };
  return {
    appId: plain(source.appId, ""),
    appSecret: plain(source.appSecret, ""),
    brand: plain(source.brand, CONFIG_DEFAULTS.brand),
    dmPolicy: plain(source.dmPolicy, CONFIG_DEFAULTS.dmPolicy),
    allowlist: [...plain(source.allowlist, [])],
    groupPolicy: plain(source.groupPolicy, CONFIG_DEFAULTS.groupPolicy),
    groupAllowlist: [...plain(source.groupAllowlist, [])],
    groupSenderAllowlist: [...plain(source.groupSenderAllowlist, [])],
    requireMentionInGroups: plain(
      source.requireMentionInGroups,
      CONFIG_DEFAULTS.requireMentionInGroups
    ),
    respondToMentionAll: plain(source.respondToMentionAll, CONFIG_DEFAULTS.respondToMentionAll),
    sessionScope: plain(source.sessionScope, CONFIG_DEFAULTS.sessionScope),
    replyMode: plain(source.replyMode, CONFIG_DEFAULTS.replyMode),
    footerFields: [...plain(source.footerFields, CONFIG_DEFAULTS.footerFields)],
    flushIntervalMs: plain(source.flushIntervalMs, CONFIG_DEFAULTS.flushIntervalMs),
    model: plain(source.model, CONFIG_DEFAULTS.model),
    provider: plain(source.provider, CONFIG_DEFAULTS.provider),
    allowBots: plain(source.allowBots, CONFIG_DEFAULTS.allowBots),
    contextWindows: { ...plain(source.contextWindows, {}) },
    defaultWorkspace: plain(source.defaultWorkspace, CONFIG_DEFAULTS.defaultWorkspace),
    dedupTtlMs: plain(source.dedupTtlMs, CONFIG_DEFAULTS.dedupTtlMs),
    turnTimeoutMs: plain(source.turnTimeoutMs, CONFIG_DEFAULTS.turnTimeoutMs),
    showReasoning: plain(source.showReasoning, CONFIG_DEFAULTS.showReasoning),
    panelExpanded: plain(source.panelExpanded, CONFIG_DEFAULTS.panelExpanded)
  };
}
var config_default = Config;

// src/host/access.ts
var has = (list, id) => list.some((entry) => entry.trim() === id);
function checkMention(request, config) {
  if (request.chatType !== "group") return null;
  if (!config.requireMentionInGroups) return null;
  if (request.mentioned) return null;
  if (request.mentionAllOnly && config.respondToMentionAll) return null;
  return "mention-required";
}
function checkChat(request, config) {
  if (request.chatType === "group") {
    if (config.groupPolicy === "disabled") return "group-disabled";
    if (config.groupPolicy === "allowlist" && !has(config.groupAllowlist, request.chatId)) {
      return "group-not-allowed";
    }
    return null;
  }
  if (config.dmPolicy === "disabled") return "dm-disabled";
  if (config.dmPolicy === "allowlist" && !has(config.allowlist, request.senderOpenId)) {
    return "dm-not-allowed";
  }
  if (config.dmPolicy === "pairing") return "dm-not-allowed";
  return null;
}
function checkSender(request, config) {
  if (request.chatType === "group") {
    const groupList = config.groupSenderAllowlist ?? [];
    if (groupList.length === 0) return null;
    return has(groupList, request.senderOpenId) ? null : "sender-not-allowed";
  }
  return null;
}
function checkBot(request, config) {
  if (!request.fromBot) return null;
  const mode = config.allowBots ?? "none";
  if (mode === "all") return null;
  if (mode === "mentions" && request.mentioned) return null;
  return "bot-sender";
}
function decideAccess(request, config) {
  const reason = checkMention(request, config) ?? checkBot(request, config) ?? checkChat(request, config) ?? checkSender(request, config);
  return reason ? { allowed: false, reason } : { allowed: true };
}
function describeDeny(reason) {
  switch (reason) {
    case "mention-required":
      return "群里需要 @机器人 才响应";
    case "group-disabled":
      return "群聊已被禁用（groupPolicy=disabled）";
    case "group-not-allowed":
      return "该群不在群白名单内";
    case "dm-disabled":
      return "私聊已被禁用（dmPolicy=disabled）";
    case "dm-not-allowed":
      return "该用户不在私聊白名单内";
    case "sender-not-allowed":
      return "该用户不在 open_id 白名单内";
    case "bot-sender":
      return "机器人/应用发送的消息（allowBots=none）";
  }
}

// src/host/runtime.ts
import { homedir as homedir2 } from "node:os";
import path4 from "node:path";
import "@larksuiteoapi/node-sdk";

// src/host/bridge.ts
import { randomUUID } from "node:crypto";
import "@deepseek-ai/dsh-agent";

// src/host/channel.ts
var MAX_QUOTE_CHARS = 2e3;
function channelPrompt(facts) {
  const kind = facts.chatType === "group" ? "群聊" : "单聊";
  const lines = [
    "# 飞书渠道",
    "你正在飞书（Lark）里和用户对话，不是一个终端会话。用户在飞书客户端读你的回复。",
    `- 会话类型：${kind}`,
    `- 会话 ID（chat_id）：${facts.chatId}`
  ];
  if (facts.botName || facts.botOpenId) {
    const name = facts.botName ? facts.botName : "本机器人";
    lines.push(`- 机器人自身：${name}${facts.botOpenId ? `（open_id ${facts.botOpenId}）` : ""}`);
  }
  if (facts.chatType === "group") {
    lines.push("- 群里只有明确 @ 到你的消息才会转给你；@ 别人不会触发你。");
  }
  lines.push(
    "- 每条消息前会有一行 `[发送人 …]`；如果用户 @ 了别人，还会有 `[同时提到 …]`。",
    "- 用户引用某条消息时，正文前会有 `> 引用 …：「原文」`，那是被引用的旧内容，不是这一轮的问题。",
    "- 回复直接给结论，不要复述这些标记。"
  );
  return lines.join("\n");
}
function personLabel(name, openId) {
  const person = name?.trim();
  const id = openId?.trim();
  if (person && id) return `${person} (${id})`;
  if (person) return person;
  if (id) return id;
  return "未知";
}
function flattenQuote(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_QUOTE_CHARS) return flat;
  return `${flat.slice(0, MAX_QUOTE_CHARS)}…（引用过长，已截断）`;
}
function composeTurnText(text, envelope) {
  const header = [];
  const name = envelope.senderName?.trim();
  if (name || envelope.chatType === "group") {
    header.push(
      `[发送人 ${personLabel(envelope.senderName, envelope.senderOpenId)}]`
    );
  }
  const others = (envelope.others ?? []).filter((mention) => mention.name || mention.openId).map((mention) => personLabel(mention.name, mention.openId));
  if (others.length > 0) header.push(`[同时提到 ${others.join("、")}]`);
  if (envelope.quote) {
    const who = personLabel(envelope.quote.senderName, envelope.quote.senderOpenId);
    const quoted = flattenQuote(envelope.quote.text);
    if (quoted) header.push(`> 引用 ${who}：「${quoted}」`);
  }
  if (header.length === 0) return text;
  return `${header.join("\n")}

${text}`;
}

// src/host/card/seal.ts
var ANSWER_ELEMENT_ID = "answer_content";
var LOADING_ICON_ID = "loading_icon";
var LOADING_ICON_IMG_KEY = "img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg";
var STOP_BUTTON_ID = "stop_row";
var FOOTER_HR_ID = "footer_hr";
var FOOTER_STATUS_ID = "footer_status";
var PANEL_ELEMENT_ID = "agent_process_panel";
var MODEL_GLYPH = "💠";
var GAP = "　";
function buildFooterElement(footer) {
  return { tag: "markdown", element_id: FOOTER_STATUS_ID, ...footerPartial(footer) };
}
var NEGATIVE_STATUSES = /* @__PURE__ */ new Set(["已停止", "出错"]);
function colorStatus(status) {
  return NEGATIVE_STATUSES.has(status) ? `<font color='red'>${status}</font>` : status;
}
function footerPartial(footer) {
  const parts = [];
  if (footer.status) parts.push(colorStatus(footer.status));
  if (footer.model) parts.push(`${MODEL_GLYPH} ${footer.model}`);
  if (footer.context) parts.push(footer.context);
  if (footer.elapsed) parts.push(footer.elapsed);
  if (footer.tokens) parts.push(footer.tokens);
  const content = parts.join(GAP);
  return {
    content,
    // Feishu picks the locale variant; we ship the same text for both so an
    // English client never sees an empty footer.
    i18n_content: { zh_cn: content, en_us: content },
    text_size: "notation"
  };
}
function summaryFromAnswer(answer, fallback) {
  const flat = answer.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/[*_`~>|]/g, "").replace(/\s+/g, " ").trim();
  if (!flat) return fallback;
  return flat.slice(0, 60);
}
function buildSealPlan(input) {
  const batches = [];
  if (input.footerPresent) {
    batches.push([
      {
        action: "partial_update_element",
        params: { element_id: PANEL_ELEMENT_ID, partial_element: input.panelContent }
      },
      {
        action: "partial_update_element",
        params: { element_id: FOOTER_STATUS_ID, partial_element: footerPartial(input.footer) }
      }
    ]);
  } else {
    batches.push([
      {
        action: "partial_update_element",
        params: { element_id: PANEL_ELEMENT_ID, partial_element: input.panelContent }
      }
    ]);
    batches.push([
      {
        action: "add_elements",
        params: {
          type: "insert_before",
          // Our cards always ship the footer, so this branch is only for a
          // footer-less card; the dots row is the anchor in that case.
          target_element_id: LOADING_ICON_ID,
          elements: [
            { tag: "hr", element_id: FOOTER_HR_ID },
            buildFooterElement(input.footer)
          ]
        }
      }
    ]);
  }
  for (const id of input.removeElementIds ?? []) {
    batches.push([{ action: "delete_elements", params: { element_ids: [id] } }]);
  }
  return { batches, summary: input.summary.slice(0, 120) };
}
var CARDKIT_STREAMING_CLOSED = 300309;
var CARDKIT_DUPLICATE_ID = 300301;
var CARDKIT_DELETE_MISSING = 300314;
var CARDKIT_INSERT_TARGET_GONE = 300315;
var CardApiError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function cardErrorCode(error) {
  if (error instanceof CardApiError) return error.code;
  const direct = error?.code;
  if (typeof direct === "number") return direct;
  const nested = error?.response?.code;
  return typeof nested === "number" ? nested : Number.NaN;
}
async function runSealPlan(api, cardId, plan, startSequence, log) {
  const report = {
    batchesRun: 0,
    footerAdded: false,
    streamingClosed: false,
    satisfied: []
  };
  let sequence = startSequence;
  const run = async (actions) => {
    sequence += 1;
    report.batchesRun += 1;
    await api.batchUpdate(cardId, actions, sequence);
  };
  for (const batch of plan.batches) {
    const isFooterAdd = batch.some((action) => action.action === "add_elements");
    try {
      await run(batch);
      if (isFooterAdd) report.footerAdded = true;
    } catch (error) {
      const code = cardErrorCode(error);
      if (code === CARDKIT_STREAMING_CLOSED || code === 300313) {
        report.streamingClosed = true;
        report.satisfied.push(code);
        log?.(`seal: streaming already closed (${code}); continuing with structural work`);
        continue;
      }
      if (code === CARDKIT_DUPLICATE_ID || code === CARDKIT_DELETE_MISSING) {
        report.satisfied.push(code);
        if (isFooterAdd) report.footerAdded = true;
        log?.(`seal: code ${code} treated as satisfied`);
        continue;
      }
      if (isFooterAdd && (code === CARDKIT_INSERT_TARGET_GONE || code === 10002)) {
        log?.(`seal: insert_before failed (${code}); retrying as append`);
        try {
          const appended = batch.map(
            (action) => action.action === "add_elements" ? { action: "add_elements", params: { elements: action.params.elements } } : action
          );
          await run(appended);
          report.footerAdded = true;
        } catch (appendError) {
          const appendCode = cardErrorCode(appendError);
          if (appendCode === CARDKIT_DUPLICATE_ID) {
            report.footerAdded = true;
            report.satisfied.push(appendCode);
            continue;
          }
          throw appendError;
        }
        continue;
      }
      throw error;
    }
  }
  if (!report.streamingClosed) {
    sequence += 1;
    await api.settings(cardId, {
      config: {
        streaming_mode: false,
        summary: {
          content: plan.summary,
          i18n_content: { zh_cn: plan.summary, en_us: plan.summary }
        }
      }
    }, sequence);
    report.streamingClosed = true;
  }
  return report;
}

// src/host/card/builder.ts
function answerElement(content, textSize = "normal_v2") {
  return {
    tag: "markdown",
    content,
    text_align: "left",
    text_size: textSize,
    margin: "0px 0px 0px 0px",
    element_id: ANSWER_ELEMENT_ID
  };
}
var MAX_PANEL_STEPS = 24;
var MAX_PANEL_PREVIEWS = 5;
var MAX_REASONING_CHARS = 1200;
function clipReasoning(text) {
  if (text.length <= MAX_REASONING_CHARS) return text;
  return `…${text.slice(-MAX_REASONING_CHARS)}`;
}
function panelElements(input) {
  const all = (input.steps ?? []).filter((step) => step.name.trim().length > 0);
  const reasoning = input.reasoning?.trim();
  if (all.length === 0 && !reasoning) return [{ tag: "markdown", content: " " }];
  const hidden = Math.max(0, all.length - MAX_PANEL_STEPS);
  const steps = hidden > 0 ? all.slice(-MAX_PANEL_STEPS) : all;
  const elements = [];
  if (reasoning) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `🧠 ${clipReasoning(reasoning)}`,
        text_size: "notation"
      }
    });
  }
  if (hidden > 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `…前面还有 ${hidden} 步（卡片元素上限，只显示最近 ${MAX_PANEL_STEPS} 步）`,
        text_size: "notation"
      }
    });
  }
  for (const [index, step] of steps.entries()) {
    const title = [
      step.ms === void 0 ? "🟡" : step.completed === false ? "🔴" : "🟢",
      ` **${step.name}**`,
      step.ms === void 0 ? "" : ` (${formatElapsed(step.ms)})`
    ].join("");
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: title, text_size: "notation" }
    });
    const detailed = steps.length - index <= MAX_PANEL_PREVIEWS;
    if (step.preview && detailed) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: step.preview, text_size: "notation" }
      });
    }
    if (step.error) {
      elements.push({
        tag: "div",
        text: { tag: "lark_md", content: `⚠️ ${step.error}`, text_size: "notation" }
      });
    }
  }
  return elements;
}
function panelHeader(input) {
  const parts = [];
  if (input.model) parts.push(`${MODEL_GLYPH} ${input.model}`);
  parts.push(`🫧 ${input.rounds ?? 0}`);
  parts.push(`✨ ${input.toolCount}`);
  parts.push(`🎶 ${formatElapsed(input.elapsedMs)}`);
  return {
    title: {
      tag: "plain_text",
      content: parts.join(" · "),
      text_color: "grey",
      text_size: "notation"
    },
    vertical_align: "center",
    icon: {
      tag: "standard_icon",
      token: "down-small-ccm_outlined",
      size: "16px 16px",
      color: "grey"
    },
    icon_position: "right",
    icon_expanded_angle: -180
  };
}
function loadingIndicator() {
  return {
    tag: "markdown",
    content: " ",
    icon: {
      tag: "custom_icon",
      img_key: LOADING_ICON_IMG_KEY,
      size: "16px 16px"
    },
    element_id: LOADING_ICON_ID
  };
}
function stopButtonRow(value) {
  return {
    tag: "column_set",
    element_id: STOP_BUTTON_ID,
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        elements: [{ tag: "markdown", content: " " }]
      },
      {
        tag: "column",
        width: "auto",
        elements: [
          {
            tag: "button",
            element_id: "stop_button",
            text: {
              tag: "plain_text",
              content: "◯ 停止",
              i18n_content: { zh_cn: "◯ 停止", en_us: "◯ Stop" }
            },
            type: "danger",
            size: "small",
            behaviors: [{ type: "callback", value }]
          }
        ]
      }
    ]
  };
}
function panelPlaceholder(input = {}) {
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: panelHeader({
      model: input.model,
      rounds: input.rounds ?? 0,
      toolCount: input.toolCount ?? 0,
      elapsedMs: input.elapsedMs ?? 0
    }),
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: "4px",
    padding: "8px 8px 8px 8px",
    elements: [{ tag: "markdown", content: " " }],
    element_id: PANEL_ELEMENT_ID
  };
}
function buildStreamingCard(options = {}) {
  const elements = [answerElement("", options.bodyTextSize)];
  elements.push(
    panelPlaceholder({
      model: options.panelModel,
      rounds: options.panelRounds ?? 0,
      toolCount: options.panelToolCount ?? 0,
      elapsedMs: options.panelElapsedMs ?? 0
    })
  );
  if (options.showDots !== false) elements.push(loadingIndicator());
  if (options.stopValue) elements.push(stopButtonRow(options.stopValue));
  if (options.footer) {
    elements.push({ tag: "hr", element_id: FOOTER_HR_ID }, options.footer);
  }
  const summary = options.summary ?? "处理中…";
  return {
    schema: "2.0",
    config: {
      streaming_mode: true,
      streaming_config: {
        // hermes' numbers exactly: one character every 15ms, printed as fast as
        // the client allows. The old 4-chars-per-70ms with `delay` is what made
        // answers appear as a block of lines every flush instead of typing.
        print_frequency_ms: { default: options.printFrequencyMs ?? 15 },
        print_step: { default: options.printStep ?? 1 },
        print_strategy: "fast"
      },
      // Feishu resolves text by locale; declare both so i18n_content is honoured.
      locales: ["zh_cn", "en_us"],
      summary: {
        content: summary,
        i18n_content: { zh_cn: summary, en_us: summary }
      }
    },
    body: { elements }
  };
}
function panelUpdate(input) {
  return {
    header: panelHeader({
      model: input.model,
      rounds: input.rounds ?? 0,
      toolCount: (input.steps ?? []).length,
      elapsedMs: input.elapsedMs ?? 0
    }),
    elements: panelElements({ steps: input.steps, reasoning: input.reasoning }),
    border: { color: "grey", corner_radius: "5px" },
    ...input.expanded === void 0 ? {} : { expanded: input.expanded }
  };
}
function continuationCard(content, summary) {
  const clipped = summary.slice(0, 120);
  return {
    schema: "2.0",
    config: {
      locales: ["zh_cn", "en_us"],
      summary: { content: clipped, i18n_content: { zh_cn: clipped, en_us: clipped } }
    },
    body: { elements: [answerElement(content)] }
  };
}

// src/host/card/md.ts
var ANSWER_MAX_BYTES = 13e3;
var MAX_CARD_TABLES = 20;
var TRUNCATION_SUFFIX = "\n\n…（内容过长已截断，防卡片溢出）…";
var MORE_FOLLOWS_SUFFIX = "\n\n…（内容过长，已续到下一张卡片）…";
var RE_FENCED_CODE = /```[\s\S]*?```/g;
var RE_INLINE_CODE = /`[^`]+`/g;
var RE_BOLD = /\*{2,3}(?!\s)((?:(?!\*{2,3}).)+?)(?<!\s)\*{2,3}/g;
var RE_VALID_ITALIC = /(?<![a-zA-Z0-9_])\*(?!\s)((?:(?!\*).)+?)(?<!\s)\*/g;
var RE_UNPAIRED_ASTERISK = /(?<!\\)\*(?=[^\s*])/g;
var RE_IMAGE_REF = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
var RE_CODE_BLOCK_EXTRACT = /(^|\n)(`{3,})([^\n]*)\n[\s\S]*?\n\2(?=\n|$)/g;
var RE_HEADING_DEMOTE = /^#{2,6} (.+)$/gm;
var RE_H1_DEMOTE = /^# (.+)$/gm;
var RE_MULTI_NEWLINE = /\n{3,}/g;
var RE_SHORT_MD_CHECK = /^#{1,6} |\n#{1,6} |```|!\[|\n{3,}/;
var RE_TABLE_BLOCK = /^\|.+\|\n\|[-:| ]+\|[\s\S]*?(?=\n\n|\n(?!\|)|$)/gm;
var utf8Length = (text) => Buffer.byteLength(text, "utf8");
function clampUtf8(text, maxBytes = ANSWER_MAX_BYTES) {
  if (utf8Length(text) <= maxBytes) return text;
  const budget = maxBytes - utf8Length(TRUNCATION_SUFFIX);
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (utf8Length(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + TRUNCATION_SUFFIX;
}
function escapeAsterisks(text) {
  if (text.includes("\0")) text = text.replace(/\x00/g, "");
  if (!text.includes("*")) return text;
  const protectedSpans = [];
  const save = (match) => {
    protectedSpans.push(match);
    return `\0P${protectedSpans.length - 1}P\0`;
  };
  let out = text;
  out = out.replace(RE_FENCED_CODE, save);
  out = out.replace(RE_INLINE_CODE, save);
  out = out.replace(RE_BOLD, save);
  out = out.replace(RE_VALID_ITALIC, save);
  out = out.replace(RE_UNPAIRED_ASTERISK, "\\*");
  for (let i = protectedSpans.length - 1; i >= 0; i--) {
    const span = protectedSpans[i];
    out = out.replace(`\0P${i}P\0`, () => span);
  }
  return out.replace(/\x00/g, "");
}
function optimizeMarkdownStyle(text) {
  if (text.length < 100 && !RE_SHORT_MD_CHECK.test(text)) return text;
  try {
    const codeBlocks = [];
    const mark = "___CB_";
    let out = text.replace(RE_CODE_BLOCK_EXTRACT, (match, prefix) => {
      const lead = prefix ?? "";
      const block = match.slice(lead.length);
      codeBlocks.push(block);
      return `${lead}${mark}${codeBlocks.length - 1}___`;
    });
    out = out.replace(RE_HEADING_DEMOTE, "##### $1");
    out = out.replace(RE_H1_DEMOTE, "#### $1");
    for (const [index, block] of codeBlocks.entries()) {
      out = out.replace(`${mark}${index}___`, () => block);
    }
    out = out.replace(RE_MULTI_NEWLINE, "\n\n");
    out = out.replace(
      RE_IMAGE_REF,
      (match, _alt, target) => target.startsWith("img_") ? match : ""
    );
    return out;
  } catch {
    return text;
  }
}
function tableToList(table) {
  const lines = table.split("\n").filter((line) => line.trim().startsWith("|"));
  const rows = lines.filter((line) => !/^\|[\s:|-]+\|?$/.test(line.trim())).map(
    (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean)
  ).filter((cells) => cells.length > 0);
  return rows.map((cells) => `• ${cells.join(" · ")}`).join("\n");
}
function downgradeTables(text, limit = MAX_CARD_TABLES) {
  if (!text.includes("|")) return text;
  try {
    const blocks = text.match(RE_TABLE_BLOCK) ?? [];
    if (blocks.length <= limit) return text;
    let seen = 0;
    return text.replace(RE_TABLE_BLOCK, (match) => {
      seen += 1;
      return seen > limit ? tableToList(match) : match;
    });
  } catch {
    return text;
  }
}
function sanitizeAnswer(text) {
  return escapeAsterisks(downgradeTables(optimizeMarkdownStyle(clampUtf8(text))));
}
function splitAnswer(text, maxBytes = ANSWER_MAX_BYTES, maxParts = 4) {
  if (utf8Length(text) <= maxBytes) return [text];
  const parts = [];
  let rest = text;
  while (rest && parts.length < Math.max(1, maxParts - 1) && utf8Length(rest) > maxBytes) {
    let lo = 0;
    let hi = rest.length;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (utf8Length(rest.slice(0, mid)) <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    const window = rest.slice(0, lo);
    const para = window.lastIndexOf("\n\n");
    const line = window.lastIndexOf("\n");
    const cut = para >= 0 ? para : line;
    const boundary = cut > lo * 0.6 ? cut + (para >= 0 ? 2 : 1) : lo;
    parts.push(rest.slice(0, boundary));
    rest = rest.slice(boundary);
  }
  if (rest) parts.push(rest);
  return parts;
}

// src/host/trace.ts
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
var home = process.env.DSH_HOME || path.join(homedir(), ".dsh");
var file = path.join(home, "feishu-card", "trace.log");
var underTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
var enabled = !underTest || process.env.FEISHU_CARD_TRACE === "1";
var counter = 0;
function trace(event, data = {}) {
  if (!enabled) return;
  counter += 1;
  const line = JSON.stringify({ t: (/* @__PURE__ */ new Date()).toISOString(), n: counter, event, ...data });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}
`);
  } catch {
  }
  if (process.env.FEISHU_CARD_DEBUG) console.log(`[feishu-card] ${line}`);
}

// src/host/card/streaming.ts
var StreamingCard = class _StreamingCard {
  constructor(options) {
    this.options = options;
    this.startedAt = (options.now ?? Date.now)();
  }
  cardId;
  sequence = 0;
  /**
   * The answer, one entry per model step.
   *
   * A turn can make several requests (reasoning → tool call → answer). Each one
   * streams its own text and then settles with its own `assistant/message`, so
   * keeping ONE buffer meant every step REPLACED the previous step's words — the
   * card visibly rewrote itself (Hermes appends segments instead).
   */
  segments = [""];
  reasoning = "";
  /** Tool calls in flight/done, with their durations. */
  steps = [];
  /** What changed since the last write. Answer and panel flush on different clocks. */
  answerDirty = false;
  panelDirty = false;
  timer;
  /**
   * Content is frozen: the turn is over, so nothing new may be pushed.
   *
   * Separate from {@link sealed} on purpose. `sealed` means THE SEAL PLAN
   * LANDED. Conflating them is what left finished cards showing their "still
   * working" dots and a live 停止 button: the plan threw, `sealed` was already
   * true, and no retry was possible (live report 2026-11-10).
   */
  closed = false;
  /** The seal plan was applied; the card can never change again. */
  sealed = false;
  /** In-flight seal, shared by every concurrent caller. */
  sealing;
  /** Status requested before the card existed; applied by start(). */
  pendingSeal;
  /** Serialized card writes — see write(). */
  writes = Promise.resolve();
  /** True once a batchUpdate carrying answer text was accepted by Feishu. */
  answerWritten = false;
  /**
   * True once ANY batchUpdate was accepted.
   *
   * Distinguishes "the transport works, this seal hit a hiccup" (worth a late
   * retry) from "this card never accepted anything" (a misconfiguration no
   * retry will fix).
   */
  wroteOk = false;
  startedAt;
  /**
   * Longest a tool-panel-only change may wait.
   *
   * Every write is a round trip and they are serialized, so a panel refresh that
   * rides the answer's clock competes with the text. Measured live (2026-11-10):
   * 72% of all card writes carried no new answer text, median gap between writes
   * 913ms, and the text advanced ~58 characters at a time. Two seconds keeps a
   * long tool-heavy turn from paying a full round trip per tool row.
   */
  static PANEL_REFRESH_MS = 2e3;
  /** Joined answer text across every step of this turn. */
  get answer() {
    return this.segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0).join("\n\n");
  }
  /** Replace all answer text with one block (image rewriting at seal time). */
  setAnswerText(text) {
    this.segments = [text];
  }
  /**
   * The answer split into card-sized parts.
   *
   * Part 0 streams on the live card; the rest is posted after the seal as
   * continuation cards. Splitting is deterministic, so part 0 only ever grows
   * while the live card is being written.
   */
  answerParts() {
    return splitAnswer(this.answer);
  }
  /** What the live card's answer element holds right now. */
  answerForCard() {
    const parts = this.answerParts();
    const head = sanitizeAnswer(parts[0] ?? "");
    return parts.length > 1 ? `${head}${MORE_FOLLOWS_SUFFIX}` : head;
  }
  /**
   * Post the remainder of a long answer as static cards.
   *
   * Not awaited: these are separate messages, not part of the seal, and a turn
   * must not wait on N more card creations. Each failure is logged and skipped —
   * a missing tail is better than a stuck turn.
   */
  async sendContinuations(parts) {
    for (const [index, part] of parts.entries()) {
      const content = sanitizeAnswer(part);
      if (!content.trim()) continue;
      try {
        await this.options.transport.createCard(
          this.options.chatId,
          continuationCard(content, summaryFromAnswer(content, "续"))
        );
        trace("card-continuation", {
          cardId: this.cardId,
          part: index + 1,
          length: content.length
        });
      } catch (error) {
        this.options.log?.(
          `continuation card ${index + 1} failed: ${String(error).slice(0, 160)}`
        );
      }
    }
  }
  get dirty() {
    return this.answerDirty || this.panelDirty;
  }
  /** Milliseconds since the card was created. */
  elapsedMs() {
    return (this.options.now ?? Date.now)() - this.startedAt;
  }
  /** Create the card. Safe to call once; later calls are no-ops. */
  async start() {
    if (this.cardId) return;
    this.cardId = await this.options.transport.createCard(
      this.options.chatId,
      buildStreamingCard({
        panelExpanded: this.options.panelExpanded,
        panelModel: this.options.panelModel?.(),
        panelRounds: this.options.panelRounds?.(),
        panelToolCount: this.steps.length,
        panelElapsedMs: this.elapsedMs(),
        stopValue: this.options.sessionKey ? {
          feishuCardStop: "stop",
          sessionKey: this.options.sessionKey,
          ...this.options.stopOwnerOpenId ? { ownerOpenId: this.options.stopOwnerOpenId } : {}
        } : void 0
        // No footer while the turn runs: the status line is a result, so the
        // seal plan adds it together with the divider (footerPresent: false).
      }),
      this.options.replyToMessageId
    );
    this.options.log?.(`streaming card created ${this.cardId}`);
    this.options.onCardId?.(this.cardId);
    trace("card-create", { chatId: this.options.chatId, cardId: this.cardId });
    if (this.dirty) await this.flushQueued();
    const pending = this.pendingSeal;
    this.pendingSeal = void 0;
    if (pending !== void 0) await this.seal({ status: pending });
  }
  /**
   * Reasoning deltas.
   *
   * Collected always (the count is a real signal, and a later flush may want the
   * tail), rendered only when `showReasoning` is on — hermes gates it the same
   * way, because a wall of scratchpad text buries the answer.
   */
  pushReasoning(delta) {
    if (this.closed || !delta) return;
    this.reasoning += delta;
    if (this.options.showReasoning) this.markPanelDirty();
  }
  pushAnswer(delta) {
    if (this.closed || !delta) return;
    this.appendToSegment(delta);
    this.markAnswerDirty();
  }
  /** Append to the step that is streaming right now. */
  appendToSegment(delta) {
    const last = this.segments.length - 1;
    this.segments[last] = (this.segments[last] ?? "") + delta;
  }
  /**
   * Start a new answer segment for the next model step.
   *
   * Called on `step/start`. Without it a multi-step turn's steps would concatenate
   * into one run-on paragraph; with it each step's text keeps its own paragraph
   * and, critically, its own authority (see {@link setAnswer}).
   */
  newSegment() {
    if (this.closed) return;
    const last = this.segments[this.segments.length - 1] ?? "";
    if (last.trim().length === 0) return;
    this.segments.push("");
  }
  /**
   * Replace the CURRENT segment with the authoritative text of the step that
   * just settled.
   *
   * The live stream is a sequence of attempts (one per LLM request); the durable
   * `assistant/message` carries the authoritative text of the step that settled.
   * Only that segment is replaced — replacing the whole answer (the old
   * behaviour) made earlier steps' words disappear, which is what "文字回退" looked
   * like in the card.
   */
  setAnswer(text) {
    if (this.closed || !text) return;
    const last = this.segments.length - 1;
    this.segments[last] = text;
    this.markAnswerDirty();
  }
  pushTool(line) {
    if (this.closed || !line) return;
    this.steps.push({ name: line });
    this.markPanelDirty();
  }
  /**
   * Record a tool call starting. `at` is the event's own timestamp so the
   * duration measures the call, not our scheduling latency.
   *
   * Steps are indexed by call id, not by name: two `grep` calls can run at the
   * same time, and matching on the name merged them into one row, left the
   * second one spinning forever and computed 0ms for both.
   */
  toolStart(id, name, at, preview) {
    if (this.closed || !name) return;
    const existing = this.stepIndex.get(id);
    if (existing !== void 0) {
      const step = this.steps[existing];
      if (step) step.preview = preview ?? step.preview;
      return;
    }
    this.steps.push({ id, name, ms: void 0, preview });
    this.stepIndex.set(id, this.steps.length - 1);
    this.toolStartedAt.set(id, at);
    this.markPanelDirty();
  }
  /** Close a tool call with its wall-clock duration (and its failure, if any). */
  toolEnd(id, at, ok = true, error) {
    const startedAt = this.toolStartedAt.get(id);
    this.toolStartedAt.delete(id);
    const index = this.stepIndex.get(id);
    const step = index === void 0 ? void 0 : this.steps[index];
    const close = (target) => {
      target.ms = Math.max(0, at - (startedAt ?? at));
      target.completed = ok;
      if (!ok && error) target.error = error;
      this.markPanelDirty();
    };
    if (!step || step.ms !== void 0) {
      const fallback = [...this.steps].reverse().find((candidate) => candidate.ms === void 0);
      if (!fallback) return;
      close(fallback);
      return;
    }
    close(step);
  }
  toolStartedAt = /* @__PURE__ */ new Map();
  /** call id → index in `steps` (indices are stable: the array only grows). */
  stepIndex = /* @__PURE__ */ new Map();
  get text() {
    return this.answer;
  }
  /**
   * Whether this turn's answer actually reached Feishu as a card.
   *
   * "Reached" means a batchUpdate carrying the answer was accepted by Feishu —
   * not merely that a card id exists and text was buffered. The old definition
   * claimed delivery for a card whose every write failed (the message-id
   * fallback, or a missing CardKit scope), which suppressed the plain-text
   * fallback and left the user with a stuck card and no answer.
   */
  get delivered() {
    return Boolean(this.cardId) && this.answer.trim().length > 0 && this.answerWritten;
  }
  get id() {
    return this.cardId;
  }
  /**
   * Record that there is unsent content.
   *
   * Deliberately independent of `cardId`: deltas that arrive before the card
   * exists must survive until `start()` flushes them, otherwise the first
   * (often only) burst of text is dropped and the user gets an empty card.
   */
  markAnswerDirty() {
    this.answerDirty = true;
    this.scheduleFlush();
  }
  markPanelDirty() {
    this.panelDirty = true;
    this.scheduleFlush();
  }
  /**
   * Serialize every write to this card.
   *
   * `batchUpdate` rejects when two writes race (Feishu answers 300317
   * "sequence number compare failed"), and the timer's flush is fire-and-forget
   * — an unhandled rejection there takes the whole host process down. So all
   * writes (flush, seal) go through one chain, and nothing
   * escapes uncaught.
   */
  write(task) {
    const next = this.writes.then(task, task);
    this.writes = next.catch(() => void 0);
    return next;
  }
  /**
   * Throttled write of the dirty elements.
   *
   * The delay depends on WHAT changed: text gets the short clock (100ms by
   * default, the cadence the user's Hermes bridge uses), the process panel gets
   * a long one. Every flush is a round trip on one serialized chain, so letting
   * a tool row ride the text clock is what made the typewriter arrive in bursts.
   */
  scheduleFlush() {
    if (this.closed) return;
    if (!this.cardId) return;
    if (this.timer) return;
    const delay = this.answerDirty ? this.options.flushIntervalMs : Math.max(this.options.flushIntervalMs, _StreamingCard.PANEL_REFRESH_MS);
    this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.write(() => this.flush()).catch(() => void 0);
    }, delay);
    this.timer.unref?.();
  }
  /**
   * Write whatever changed.
   *
   * Only the elements that actually changed are sent: a flush that carries no
   * text used to re-send the whole panel anyway, which is how half of all live
   * writes advanced nothing.
   */
  async flush() {
    if (!this.cardId || !this.dirty || this.closed) return;
    const answerDirty = this.answerDirty;
    const panelDirty = this.panelDirty;
    this.answerDirty = false;
    this.panelDirty = false;
    const actions = [];
    if (answerDirty) {
      actions.push({
        action: "partial_update_element",
        params: {
          element_id: "answer_content",
          // INNER fields only — a full element object here is accepted by the
          // API and then silently ignored.
          partial_element: { content: this.answerForCard() }
        }
      });
    }
    if (panelDirty) {
      actions.push({
        action: "partial_update_element",
        params: {
          element_id: "agent_process_panel",
          // Tool steps with their durations — reasoning only when opted in.
          partial_element: panelUpdate({
            steps: this.steps,
            model: this.options.panelModel?.(),
            rounds: this.options.panelRounds?.(),
            elapsedMs: this.elapsedMs(),
            reasoning: this.options.showReasoning ? this.reasoning : void 0,
            expanded: this.options.panelExpandedWhileRunning
          })
        }
      });
    }
    if (actions.length === 0) return;
    this.sequence += 1;
    try {
      await this.options.transport.batchUpdate(this.cardId, actions, this.sequence);
      this.wroteOk = true;
      if (answerDirty && this.answer.trim()) this.answerWritten = true;
      trace("card-flush", {
        cardId: this.cardId,
        sequence: this.sequence,
        answerLength: answerDirty ? this.answer.length : 0,
        reasoningLength: this.reasoning.length,
        tools: this.steps.length,
        actions: actions.length
      });
    } catch (error) {
      if (answerDirty) this.answerDirty = true;
      if (panelDirty) this.panelDirty = true;
      trace("card-flush-failed", { cardId: this.cardId, sequence: this.sequence, error: String(error) });
      throw error;
    }
  }
  /** flush(), serialized onto the card's write chain. */
  flushQueued() {
    return this.write(() => this.flush());
  }
  /** Finish the turn: flush, refresh the footer, close streaming. */
  async seal(input) {
    if (!this.cardId) {
      if (!this.sealed) this.pendingSeal = input.status;
      return void 0;
    }
    if (this.sealed) return void 0;
    if (this.sealing) return this.sealing;
    this.sealing = this.runSeal(input).finally(() => {
      this.sealing = void 0;
    });
    return this.sealing;
  }
  /**
   * Apply the seal plan, retrying the two transient failure classes.
   *
   * A seal is the ONE write that must land: until it does, a finished answer
   * keeps its "still working" dots and a live 停止 button, and nothing can push
   * a fix because the turn is over. `runSealPlan` already tolerates the
   * "already satisfied" codes; this adds
   *   - serialization on the write chain (a flush may still be in flight, and a
   *     concurrent batchUpdate answers 300317 "sequence number compare failed"),
   *   - up to two retries with fresh sequence numbers, for a network blip.
   */
  async sealWithRetry(cardId, plan) {
    const delays = this.options.sealRetryDelaysMs ?? (this.wroteOk ? [0, 800, 2500, 1e4] : [0, 800, 2500]);
    let lastError;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await sleep(delay);
      if (this.sealed) break;
      try {
        return await this.write(
          () => runSealPlan(this.asApi(), cardId, plan, this.sequence, this.options.log)
        );
      } catch (error) {
        lastError = error;
        this.options.log?.(
          `seal attempt ${attempt + 1}/${delays.length} failed: ${String(error).slice(0, 160)}`
        );
        trace("card-seal-retry", { cardId, attempt: attempt + 1, error: String(error) });
        this.sequence += plan.batches.length + 2;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  /** The actual seal body, shared by every concurrent caller. */
  async runSeal(input) {
    const cardId = this.cardId;
    if (!cardId) return void 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = void 0;
    if (this.options.resolveImages && this.answer.includes("![")) {
      try {
        const resolved = await this.options.resolveImages(this.answer);
        if (resolved !== this.answer) {
          this.setAnswerText(resolved);
          this.answerDirty = true;
        }
      } catch (error) {
        this.options.log?.(`image resolve failed: ${error}`);
      }
    }
    if (this.dirty) {
      try {
        await this.flushQueued();
      } catch (error) {
        this.options.log?.(`final flush failed (${String(error).slice(0, 120)}); retrying once`);
        await sleep(300).catch(() => void 0);
        try {
          await this.flushQueued();
        } catch (retryError) {
          this.options.log?.(
            `final flush failed again (${String(retryError).slice(0, 120)}); sealing anyway`
          );
        }
      }
    }
    this.closed = true;
    const source = this.options.footerSource?.() ?? { status: "" };
    const elapsed = input.elapsed ?? source.elapsed ?? formatElapsed((this.options.now ?? Date.now)() - this.startedAt);
    const footer = this.buildFooter({ ...source, status: input.status, elapsed });
    const plan = buildSealPlan({
      panelContent: panelUpdate({
        steps: this.steps,
        model: this.options.panelModel?.(),
        rounds: this.options.panelRounds?.(),
        elapsedMs: this.elapsedMs(),
        reasoning: this.options.showReasoning ? this.reasoning : void 0,
        // The sealed card keeps the panel open only when the user asked for it;
        // otherwise the answer gets the whole card, as hermes does.
        expanded: this.options.panelExpanded
      }),
      footer,
      // The chat-list / notification preview carries the answer, not the status
      // word — a conversation list full of 已完成 says nothing about the reply.
      summary: summaryFromAnswer(this.answer, footer.status),
      // The loading icon is only a "still working" hint: it goes away on seal,
      // and so does the stop button — a sealed turn has nothing left to stop.
      removeElementIds: this.options.sessionKey ? [LOADING_ICON_ID, STOP_BUTTON_ID] : [LOADING_ICON_ID],
      // Nothing below the process panel exists yet: the footer (and its divider)
      // is created HERE, which is why the plan inserts it instead of patching.
      footerPresent: false
    });
    const report = await this.sealWithRetry(cardId, plan);
    this.sealed = true;
    const parts = this.answerParts();
    if (parts.length > 1) void this.sendContinuations(parts.slice(1));
    this.options.log?.(
      `sealed card ${cardId}: footer=${report.footerAdded} closed=${report.streamingClosed}`
    );
    trace("card-seal", {
      cardId,
      status: input.status,
      batches: report.batchesRun,
      closed: report.streamingClosed,
      satisfied: report.satisfied,
      answerLength: this.answer.length,
      reasoningLength: this.reasoning.length
    });
    return { ...report, footerAdded: true };
  }
  /** Interrupted turn: seal with the stopped status, keep whatever streamed. */
  async abort() {
    return this.seal({ status: "已停止" });
  }
  /**
   * The card's message was recalled or deleted — stop writing to it.
   *
   * Feishu keeps accepting updates for a recalled card and renders nothing, so
   * every later flush is a wasted API call (and can burn the rate limit during
   * a long turn). hermes calls this the message-protection guard; without it a
   * user who recalls a runaway answer keeps paying for it invisibly.
   */
  markUnavailable(reason = "recalled") {
    if (this.sealed) return;
    this.closed = true;
    this.sealed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = void 0;
    trace("card-unavailable", { cardId: this.cardId, reason });
  }
  buildFooter(input) {
    const picked = { status: input.status };
    const target = picked;
    for (const field of this.options.footerFields) {
      if (field === "status") continue;
      const value = input[field];
      if (value) target[field] = value;
    }
    return picked;
  }
  asApi() {
    return {
      batchUpdate: (cardId, actions, sequence) => this.options.transport.batchUpdate(cardId, actions, sequence),
      settings: (cardId, settings, sequence) => this.options.transport.settings(cardId, settings, sequence)
    };
  }
};
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
function formatElapsed(ms) {
  if (ms < 1e3) return `${ms}ms`;
  const seconds = ms / 1e3;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

// src/host/bridge.ts
var TURN_TIMEOUT_MS = 10 * 60 * 1e3;
var NO_OUTPUT = "（本轮无输出）";
var asSessionId = (id) => id;
var asMessageId = (id) => id;
function pinSelection(agent, selection, log) {
  const model = agent.model;
  if (model === void 0) return;
  try {
    model.select(selection);
  } catch (error) {
    log?.warn(`feishu-card: could not pin ${selection.provider}/${selection.model}: ${String(error)}`);
  }
}
function installPromptModelVariables(agentCtx, selection) {
  return agentCtx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const selected = selection.current;
    const assembled = await next();
    const channel = selection.channel;
    const sections = channel ? [
      ...assembled.sections,
      { name: "feishu:channel", text: channelPrompt(channel), interpolate: false }
    ] : assembled.sections;
    if (selected === void 0) return { ...assembled, sections };
    return {
      ...assembled,
      sections,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model
      }
    };
  });
}
function recordUsage(target, sample) {
  if (!sample || typeof sample !== "object") return;
  const value = sample;
  const num = (key) => typeof value[key] === "number" ? value[key] : void 0;
  const inputTokens = num("inputTokens");
  const outputTokens = num("outputTokens");
  const cacheReadTokens = num("cacheReadTokens");
  const cacheWriteTokens = num("cacheWriteTokens");
  if (inputTokens !== void 0) target.inputTokens = inputTokens;
  if (outputTokens !== void 0) target.outputTokens = outputTokens;
  if (cacheReadTokens !== void 0) target.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== void 0) target.cacheWriteTokens = cacheWriteTokens;
}
function toolPreview(raw) {
  if (typeof raw !== "string" || !raw.trim()) return void 0;
  let text = raw;
  try {
    const parsed = JSON.parse(raw);
    text = parsed.command ?? parsed.query ?? parsed.path ?? parsed.url ?? raw;
  } catch {
  }
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return void 0;
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}
function assistantText(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
var FeishuBridge = class {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options;
  }
  live = /* @__PURE__ */ new Map();
  queues = /* @__PURE__ */ new Map();
  /** Session keys with a turn in flight (for /stop). */
  running = /* @__PURE__ */ new Set();
  /**
   * Sessions whose persisted mapping is being dropped. `reset()` removes the
   * store entry asynchronously, so without this a message arriving in between
   * would resume the session we just abandoned.
   */
  poisoned = /* @__PURE__ */ new Set();
  /**
   * Per-conversation model overrides set by `/model`.
   *
   * They live here, not in the plugin config, because `/model` is a
   * conversation-level command: writing the host's global default would retune
   * every other chat (and the GUI) as a side effect. An override is dropped when
   * the agent for that conversation is rebuilt, so the next turn gets it.
   */
  modelOverrides = /* @__PURE__ */ new Map();
  /** Sessions whose live agent uses a stale model and must be rebuilt. */
  staleModel = /* @__PURE__ */ new Set();
  /** Sessions a user asked to stop; the footer must say 已停止, not 已完成. */
  interrupted = /* @__PURE__ */ new Set();
  /**
   * Who opened each running turn.
   *
   * The card's stop button and `/stop` are restricted to this person: in a group,
   * cancelling somebody else's answer is a surprise, not a feature. Keyed by
   * session (not stored per agent) because ownership lasts exactly one turn.
   */
  turnOwners = /* @__PURE__ */ new Map();
  /** Per-session turn settlers, so a stop can end the turn immediately. */
  settlers = /* @__PURE__ */ new Map();
  /** Serialize turns per conversation so a chat never runs two agents at once. */
  enqueue(key, task) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      key,
      next.catch(() => void 0)
    );
    return next;
  }
  async handleMessage(request) {
    return this.enqueue(request.sessionKey, async () => {
      const live = await this.ensureAgent(request.sessionKey, request.chatId, request);
      this.running.add(request.sessionKey);
      if (request.senderOpenId) this.turnOwners.set(request.sessionKey, request.senderOpenId);
      try {
        return await this.runTurn(live.handle.agent, request);
      } finally {
        this.running.delete(request.sessionKey);
        this.turnOwners.delete(request.sessionKey);
        if (this.staleModel.delete(request.sessionKey)) await this.dropLive(request.sessionKey);
      }
    });
  }
  /**
   * Who opened the turn running in this conversation right now.
   *
   * `undefined` when nothing is running — the caller then has nothing to
   * protect, and `/stop` may say "there is no task" instead of "not yours".
   */
  turnOwner(sessionKey) {
    return this.turnOwners.get(sessionKey);
  }
  /**
   * Effective model selection for one conversation: `/model` override first,
   * then the panel's explicit route, then the host default.
   */
  modelSelection(sessionKey) {
    const override = sessionKey ? this.modelOverrides.get(sessionKey) : void 0;
    if (override) return override;
    const config = this.options.model?.();
    if (config?.provider && config.model) return { provider: config.provider, model: config.model };
    const service = this.ctx.get("agentDefaultModel");
    return service?.currentSelection();
  }
  /**
   * Apply `/model <provider/model>` to one conversation.
   *
   * The live agent's model is fixed when it is created, so an idle session is
   * rebuilt immediately (its session log stays resumable) and a busy one is
   * flagged for rebuild the moment the turn settles.
   */
  async setModel(sessionKey, selection) {
    this.modelOverrides.set(sessionKey, selection);
    if (this.running.has(sessionKey)) {
      this.staleModel.add(sessionKey);
      return;
    }
    await this.dropLive(sessionKey);
  }
  /** Current `/model` override, for /status and /model without arguments. */
  modelOverride(sessionKey) {
    return this.modelOverrides.get(sessionKey);
  }
  /** Forget a conversation's live agent (the next message rebuilds it). */
  async dropLive(sessionKey) {
    const live = this.live.get(sessionKey);
    if (!live) return;
    this.live.delete(sessionKey);
    await live.handle.dispose().catch((error) => {
      this.ctx.logger.debug(`feishu-card: dropLive dispose failed for ${sessionKey}: ${error}`);
    });
  }
  /** What /status reports for one conversation. */
  describe(sessionKey) {
    const live = this.live.get(sessionKey);
    return {
      sessionId: live?.handle.agent.id,
      model: live?.handle.agent.options?.model,
      running: this.running.has(sessionKey)
    };
  }
  /** Forget the persisted session so the next message starts a fresh one. */
  async reset(sessionKey) {
    const had = this.live.has(sessionKey) || this.options.store.get(sessionKey) !== void 0;
    this.poisoned.add(sessionKey);
    await this.stop(sessionKey, { settleTurn: false });
    await this.options.store.remove(sessionKey);
    return had;
  }
  /** Resume the persisted session, or create a fresh one. */
  async ensureAgent(sessionKey, chatId, channel) {
    const existing = this.live.get(sessionKey);
    if (existing) return existing;
    await this.options.store.load();
    const record = this.poisoned.has(sessionKey) ? void 0 : this.options.store.get(sessionKey);
    const workspace = this.options.defaultWorkspace();
    const meta = { cwd: workspace || void 0 };
    const selection = this.modelSelection(sessionKey);
    const agentOptions = selection ? {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: selection.reasoningEffort }
    } : void 0;
    const selectionRef = {
      current: selection,
      ...channel?.chatType === void 0 ? {} : {
        channel: {
          chatId,
          chatType: channel.chatType,
          ...channel.botName === void 0 ? {} : { botName: channel.botName },
          ...channel.botOpenId === void 0 ? {} : { botOpenId: channel.botOpenId }
        }
      }
    };
    const setup = async (agentCtx) => {
      trace("agent-setup", { sessionKey, hasSelection: Boolean(selection) });
      if (selection || selectionRef.channel) installPromptModelVariables(agentCtx, selectionRef);
      const presets = agentCtx.get("agentPresets");
      trace("agent-setup-presets", { sessionKey, hasPresets: Boolean(presets) });
      if (presets) {
        await presets.mount(agentCtx).catch((error) => {
          this.ctx.logger.warn(`feishu-card: agent preset mount failed for ${sessionKey}: ${error}`);
          trace("agent-setup-presets-failed", { sessionKey, error: String(error) });
        });
      }
      this.options.ask?.registerTool?.(agentCtx);
      trace("agent-setup-done", { sessionKey });
    };
    let handle;
    if (record) {
      try {
        handle = await this.ctx.agents.resume({
          resumeSessionId: asSessionId(record.sessionId),
          agentOptions,
          setup
        });
        this.ctx.logger.info(`feishu-card: resumed session ${record.sessionId} for ${sessionKey}`);
      } catch (error) {
        this.ctx.logger.warn(`feishu-card: resume failed (${error}), creating a new session`);
        handle = await this.createAgent(meta, agentOptions, setup);
      }
    } else {
      handle = await this.createAgent(meta, agentOptions, setup);
    }
    if (selection) pinSelection(handle.agent, selection, this.ctx.logger);
    const live = { handle, sessionKey };
    this.live.set(sessionKey, live);
    this.poisoned.delete(sessionKey);
    this.options.ask?.bind(handle.agent.id, chatId);
    if (workspace) {
      await this.options.attachWorkspace?.(handle.agent.id, workspace).catch((error) => {
        this.ctx.logger.debug(`feishu-card: workspace attach skipped: ${error}`);
      });
    }
    await this.options.store.put(sessionKey, {
      sessionId: handle.agent.id,
      workspace,
      updatedAt: Date.now()
    });
    trace("agent-ready", {
      sessionKey,
      sessionId: handle.agent.id,
      provider: handle.agent.options?.provider ?? null,
      model: handle.agent.options?.model ?? null,
      workspace: workspace || null,
      resumed: Boolean(record)
    });
    return live;
  }
  async createAgent(meta, agentOptions, setup) {
    return this.ctx.agents.create({
      sessionId: asSessionId(randomUUID()),
      meta,
      agentOptions,
      setup
    });
  }
  /** Submit one user message and resolve with the assistant's final text. */
  runTurn(agent, request) {
    const message = {
      id: asMessageId(randomUUID()),
      role: "user",
      content: [{ type: "text", text: request.text }],
      source: { kind: "user" }
    };
    const model = agent.options?.model;
    const state = {
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      rounds: 0,
      sessionKey: request.sessionKey,
      ...request.senderOpenId ? { ownerOpenId: request.senderOpenId } : {}
    };
    const card = this.options.createCard?.(
      request.chatId,
      agent,
      state,
      request.replyToMessageId
    );
    return new Promise((resolve, reject) => {
      let buffer = "";
      let settled = false;
      const toolNames = /* @__PURE__ */ new Map();
      const finish = (result) => {
        if (settled) return;
        settled = true;
        dispose();
        clearTimeout(timer);
        resolve(result);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        dispose();
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const onFrame = ({ agent: source, frame }) => {
        trace("frame", {
          sessionKey: request.sessionKey,
          expected: agent.id,
          got: source?.id ?? null,
          frameType: frame.type,
          chunkType: frame.type === "chunk" ? frame.chunk.type : null
        });
        if (source.id !== agent.id) return;
        if (frame.type !== "chunk") return;
        const chunk = frame.chunk;
        switch (chunk.type) {
          case "text-delta":
            buffer += chunk.text;
            card?.pushAnswer(chunk.text);
            break;
          case "reasoning-delta":
            card?.pushReasoning(chunk.text);
            break;
          case "usage":
            recordUsage(state.usage, chunk.usage);
            break;
          case "tool-call-delta": {
            const known = toolNames.get(String(chunk.id));
            if (!known && chunk.name) {
              toolNames.set(String(chunk.id), chunk.name);
              card?.pushTool(`🔧 ${chunk.name}`);
            }
            break;
          }
          default:
            break;
        }
      };
      const onSessionEvent = (subject, event) => {
        if (subject !== agent.session) return;
        trace("session-event", { sessionKey: request.sessionKey, type: event.type });
        const at = typeof event.time === "number" ? event.time : Date.now();
        const data = event.data;
        if (event.type === "assistant/message") {
          const text = assistantText(data?.message);
          if (text) {
            buffer = text;
            card?.setAnswer(text);
          }
          return;
        }
        if (event.type === "tool/call" && data?.name) {
          card?.toolStart(String(data.callId ?? ""), data.name, at, toolPreview(data.arguments));
          return;
        }
        if (event.type === "tool/result") {
          const isError = Boolean(data?.message?.isError);
          const reason2 = data?.error?.reason ?? data?.error?.name;
          card?.toolEnd(String(data?.callId ?? ""), at, !isError, isError ? reason2 ?? "工具执行失败" : void 0);
          return;
        }
        if (event.type === "step/start") {
          state.rounds += 1;
          card?.newSegment();
          return;
        }
        if (event.type !== "turn/end") return;
        const reason = data?.reason;
        if (reason?.kind === "error") {
          void sealCard("出错").then(
            () => fail(new Error(reason.error?.message ?? "agent error"))
          );
          return;
        }
        if (reason?.kind === "aborted") {
          void sealCard("已停止").then(() => finish(turnResult(false, "stopped")));
          return;
        }
        if (reason?.kind === "blocked") {
          trace("turn-blocked", { sessionKey: request.sessionKey, sessionId: agent.id });
          void this.reset(request.sessionKey);
          void sealCard("已拦截").then(
            () => finish({
              ...turnResult(false, "blocked"),
              text: "这个会话已被 Harness 归档（或宿主拦截了本次请求），已自动开新会话，请再发一次。"
            })
          );
          return;
        }
        void sealCard("已完成").then(() => finish(turnResult(false)));
      };
      const onStatus = ({ agent: source, status }) => {
        trace("status", { sessionKey: request.sessionKey, expected: agent.id, got: source?.id ?? null, status });
        if (source.id !== agent.id || status !== "idle") return;
        const stopped = this.interrupted.delete(request.sessionKey);
        void sealCard(stopped ? "已停止" : "已完成").then(
          () => finish(turnResult(false, stopped ? "stopped" : "completed"))
        );
      };
      const onError = ({ agent: source, error }) => {
        trace("agent-error", { sessionKey: request.sessionKey, error: String(error) });
        if (source.id !== agent.id) return;
        void sealCard("出错").then(
          () => fail(error instanceof Error ? error : new Error("agent error"))
        );
      };
      const disposeStream = this.ctx.on("agent/assistant-stream", onFrame);
      const disposeStatus = this.ctx.on("agent/status", onStatus);
      const disposeError = this.ctx.on("agent/error", onError);
      const disposeSession = this.ctx.on("session/event", onSessionEvent);
      const dispose = () => {
        disposeStream();
        disposeStatus();
        disposeError();
        disposeSession();
        this.settlers.delete(request.sessionKey);
      };
      this.settlers.set(request.sessionKey, (status) => {
        void sealCard(status).then(
          () => finish(turnResult(false, status === "已停止" ? "stopped" : "completed"))
        );
      });
      const timer = setTimeout(() => {
        try {
          agent.cancel({ kind: "hook", reason: "feishu-card: turn timeout" });
        } catch (error) {
          trace("timeout-cancel-failed", { sessionKey: request.sessionKey, error: String(error) });
        }
        void card?.abort();
        finish(turnResult(true, "timed-out"));
      }, this.options.turnTimeoutMs ?? TURN_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();
      const turnResult = (timedOut, reason = "completed") => ({
        text: timedOut && !buffer.trim() ? `（超过 ${Math.round((this.options.turnTimeoutMs ?? TURN_TIMEOUT_MS) / 6e4)} 分钟未响应，已停止等待。可再发一条继续）` : buffer.trim() || NO_OUTPUT,
        model,
        timedOut,
        carded: Boolean(card?.delivered),
        cardCreated: Boolean(card?.id),
        reason
      });
      const sealCard = async (status) => {
        if (!card) {
          trace("seal-skipped", { sessionKey: request.sessionKey, reason: "no card" });
          return;
        }
        try {
          await card.seal({ status });
          trace("sealed", {
            sessionKey: request.sessionKey,
            status,
            cardId: card.id ?? null,
            answerLength: card.text.length
          });
        } catch (error) {
          this.ctx.logger.warn(`feishu-card: seal failed (${error}); falling back to text`);
          trace("seal-failed", { sessionKey: request.sessionKey, error: String(error) });
        }
      };
      void (async () => {
        try {
          if (card) await card.start();
          trace("card-started", { sessionKey: request.sessionKey, cardId: card?.id ?? null });
        } catch (error) {
          this.ctx.logger.warn(`feishu-card: card start failed (${error}); falling back to text`);
          trace("card-start-failed", { sessionKey: request.sessionKey, error: String(error) });
        }
        try {
          agent.followup(message);
        } catch (error) {
          fail(error);
        }
      })();
    });
  }
  /**
   * Cancel and drop one conversation's agent (its session stays resumable).
   *
   * @param options.settleTurn - end the in-flight turn right away with 已停止.
   *   `false` when the caller is itself deciding how the turn ended.
   */
  async stop(sessionKey, options = {}) {
    const live = this.live.get(sessionKey);
    const wasRunning = this.running.has(sessionKey);
    const settle = this.settlers.get(sessionKey);
    if (wasRunning) this.interrupted.add(sessionKey);
    this.running.delete(sessionKey);
    if (live) {
      try {
        live.handle.agent.cancel({ kind: "user" });
      } catch (error) {
        this.ctx.logger.debug(`feishu-card: cancel failed for ${sessionKey}: ${error}`);
      }
      this.live.delete(sessionKey);
    }
    if (options.settleTurn !== false) settle?.("已停止");
    if (live) {
      await live.handle.dispose().catch((error) => {
        this.ctx.logger.warn(`feishu-card: dispose failed for ${sessionKey}: ${error}`);
      });
    }
    return wasRunning || Boolean(live);
  }
  async dispose() {
    for (const key of [...this.live.keys()]) await this.stop(key);
  }
};

// src/host/gateway.ts
import * as Lark from "@larksuiteoapi/node-sdk";

// src/host/messages.ts
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
var MENTION_ALL_KEYS = /* @__PURE__ */ new Set(["_all", "all"]);
function stripMentions(text, mentions = []) {
  let out = text;
  for (const mention of mentions) {
    if (!mention.key) continue;
    out = out.split(`@${mention.key}`).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}
function isAllMention(mention) {
  return MENTION_ALL_KEYS.has(mention.key) || mention.name === "所有人" || mention.name === "all";
}
function extractPostText(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "";
  }
  const body = parsed;
  const source = Array.isArray(body?.content) ? body : typeof body?.zh_cn === "object" && body.zh_cn ? body.zh_cn : body;
  const lines = [];
  if (typeof source?.title === "string" && source.title) lines.push(source.title);
  if (Array.isArray(source?.content)) {
    for (const paragraph of source.content) {
      if (!Array.isArray(paragraph)) continue;
      const text = paragraph.map((node) => {
        if (!node || typeof node !== "object") return "";
        const item = node;
        if (item.tag === "text" || item.tag === "code_block" || item.tag === "md") return item.text ?? "";
        if (item.tag === "a") return item.href ? `${item.text ?? ""}(${item.href})` : item.text ?? "";
        if (item.tag === "at") return `@${item.user_name ?? ""}`;
        if (item.tag === "img") return "[图片]";
        return "";
      }).join("");
      if (text.trim()) lines.push(text);
    }
  }
  return lines.join("\n").trim();
}
function normalizeInbound(raw, botOpenId) {
  const mentions = raw.mentions ?? [];
  const all = mentions.filter(isAllMention);
  const real = mentions.filter((m) => !isAllMention(m));
  const selfMentioned = botOpenId ? real.some((m) => m.openId === botOpenId) : false;
  const mentioned = botOpenId ? selfMentioned : real.length > 0;
  const mentionAllOnly = !mentioned && all.length > 0;
  return {
    messageId: raw.messageId,
    eventId: raw.eventId,
    chatId: raw.chatId,
    chatType: raw.chatType,
    senderOpenId: raw.senderOpenId,
    // Feishu never echoes our own outbound back as inbound, but another app's
    // message arrives with sender_type 'app'/'bot' — treat both as bot traffic.
    fromBot: raw.senderType === "bot" || raw.senderType === "app",
    text: stripMentions(raw.text, mentions),
    mentioned,
    mentionAllOnly,
    // Who ELSE was @-ed. The agent used to see nothing here: every placeholder
    // was stripped, so "问一下 @李四" reached the model as "问一下".
    othersMentioned: real.filter((mention) => mention.openId !== botOpenId),
    threadId: raw.threadId,
    parentId: raw.parentId,
    rootId: raw.rootId,
    sessionKey: raw.chatId
  };
}
function sessionKeyFor(message, scope) {
  switch (scope) {
    case "thread":
      return message.threadId ? `${message.chatId}#${message.threadId}` : message.chatId;
    case "sender":
      return `${message.chatId}#${message.senderOpenId}`;
    case "chat":
      return message.chatId;
  }
}
var Dedup = class {
  constructor(ttlMs, now = Date.now, file2) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.file = file2;
  }
  seen = /* @__PURE__ */ new Map();
  dirty = false;
  loading;
  writing = Promise.resolve();
  /** Bumped per write, so tmp names never collide. */
  tmpSeq = 0;
  flushTimer;
  /** Read the persisted window. Safe to call repeatedly; the first call wins. */
  load() {
    if (!this.file) return Promise.resolve();
    this.loading ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.file, "utf8"));
        const now = this.now();
        for (const [id, at] of Object.entries(parsed.ids ?? {})) {
          if (typeof at === "number" && now - at <= this.ttlMs) this.seen.set(id, at);
        }
      } catch {
      }
    })();
    return this.loading;
  }
  /** @returns true when the id is new (and records it), false on a replay. */
  check(id) {
    const now = this.now();
    const at = this.seen.get(id);
    if (at !== void 0 && now - at <= this.ttlMs) return false;
    this.seen.set(id, now);
    this.dirty = true;
    this.sweep(now);
    this.schedulePersist();
    return true;
  }
  sweep(now) {
    if (this.seen.size < 1024) return;
    for (const [id, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(id);
    }
  }
  /**
   * Persist on the next tick rather than per message: a burst of events must
   * not turn into a burst of file writes.
   */
  schedulePersist() {
    if (!this.file || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = void 0;
      void this.writeNow();
    }, 250);
    this.flushTimer.unref?.();
  }
  async writeNow() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const payload = JSON.stringify({ version: 1, ids: Object.fromEntries(this.seen) });
    const file2 = this.file;
    const tmp = `${file2}.${process.pid}.${this.tmpSeq += 1}.tmp`;
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(file2), { recursive: true });
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, file2);
    }).catch(async () => {
      await unlink(tmp).catch(() => void 0);
    });
    await this.writing;
  }
  /** Wait for any pending write (tests, shutdown). */
  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = void 0;
    }
    await this.writeNow();
    await this.writing;
  }
  get size() {
    return this.seen.size;
  }
};

// src/host/gateway.ts
var SUPPORTED_TYPES = /* @__PURE__ */ new Set(["text"]);
var RESOURCE_TYPES = /* @__PURE__ */ new Set(["image", "file", "audio", "media"]);
function parseResourceContent(type, content) {
  try {
    const parsed = JSON.parse(content);
    const fileKey = parsed.image_key ?? parsed.file_key;
    return { fileKey: fileKey || void 0, fileName: parsed.file_name || void 0 };
  } catch {
    return {};
  }
}
function toRawMessage(data) {
  const message = data.message;
  const openId = data.sender?.sender_id?.open_id;
  if (!message.message_id || !message.chat_id || !openId) return void 0;
  let text = "";
  try {
    const parsed = JSON.parse(message.content ?? "{}");
    text = parsed.text ?? "";
  } catch {
    return void 0;
  }
  return {
    messageId: message.message_id,
    // Feishu's canonical dedup key is the top-level event_id; message_id is
    // the fallback for payloads that omit it.
    eventId: data.event_id ?? message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type === "group" ? "group" : "p2p",
    senderOpenId: openId,
    // 'user' | 'bot' | 'app' — the access gate drops app traffic by default.
    senderType: data.sender?.sender_type,
    text,
    mentions: (message.mentions ?? []).map((mention) => ({
      key: mention.key,
      openId: mention.id?.open_id,
      name: mention.name
    })),
    threadId: message.thread_id ?? void 0,
    // The quoted message. `parent_id` is the immediate one; `root_id` is the
    // topic root, which equals the parent outside a topic thread.
    parentId: message.parent_id ?? void 0,
    rootId: message.root_id ?? void 0
  };
}
var FeishuGateway = class {
  constructor(options) {
    this.options = options;
  }
  ws;
  get domain() {
    return this.options.brand === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
  }
  async start() {
    const { appId, appSecret, logger } = this.options;
    logger?.info(`feishu-card: connecting to ${this.options.brand} over WebSocket`);
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": (data) => {
        void this.handleEvent(data).catch((error) => {
          logger?.warn(`feishu-card: inbound handler failed: ${error}`);
        });
        return void 0;
      },
      // Card 2.0 `behaviors: callback` buttons land here. A returned value is
      // the callback response, so the asker can toast and refresh its card.
      "card.action.trigger": async (data) => {
        if (!this.options.onCardAction) return void 0;
        try {
          return await this.options.onCardAction(data);
        } catch (error) {
          logger?.warn(`feishu-card: card action handler failed: ${error}`);
          return void 0;
        }
      },
      // Message protection: a recalled message cannot be updated any more, so
      // the card that carried it must stop writing (every later call would be
      // accepted by Feishu and render nothing).
      "im.message.recalled_v1": (data) => {
        if (!data?.message_id) return void 0;
        this.options.onMessageRecalled?.({ messageId: data.message_id, chatId: data.chat_id });
        return void 0;
      }
    });
    this.ws = new Lark.WSClient({ appId, appSecret, domain: this.domain });
    await this.ws.start({ eventDispatcher: dispatcher });
    logger?.info("feishu-card: WebSocket connected");
  }
  async handleEvent(data) {
    const message = data.message;
    const openId = data.sender?.sender_id?.open_id;
    if (!message.message_id || !message.chat_id || !openId) {
      this.options.logger?.debug("feishu-card: ignoring event without message/sender ids");
      return;
    }
    const chatType = message.chat_type === "group" ? "group" : "p2p";
    const type = message.message_type ?? "unknown";
    if (type === "post") {
      const text = extractPostText(message.content ?? "");
      if (!text) {
        this.options.onUnsupported?.({ chatId: message.chat_id, chatType, type, senderOpenId: openId });
        return;
      }
      await this.options.onMessage(
        toRawMessage({
          event_id: data.event_id,
          sender: data.sender,
          message: { ...message, message_type: "text", content: JSON.stringify({ text }) }
        }) ?? {
          messageId: message.message_id,
          eventId: data.event_id ?? message.message_id,
          chatId: message.chat_id,
          chatType,
          senderOpenId: openId,
          senderType: data.sender?.sender_type,
          text,
          mentions: []
        }
      );
      return;
    }
    if (RESOURCE_TYPES.has(type)) {
      const { fileKey, fileName } = parseResourceContent(type, message.content ?? "");
      if (!fileKey) {
        this.options.onUnsupported?.({ chatId: message.chat_id, chatType, type, senderOpenId: openId });
        return;
      }
      this.options.onAttachment?.({
        eventId: data.event_id ?? message.message_id,
        messageId: message.message_id,
        chatId: message.chat_id,
        chatType,
        senderOpenId: openId,
        senderType: data.sender?.sender_type,
        type,
        fileKey,
        fileName,
        mentions: (message.mentions ?? []).map((mention) => ({
          key: mention.key,
          openId: mention.id?.open_id,
          name: mention.name
        }))
      });
      return;
    }
    if (!SUPPORTED_TYPES.has(type)) {
      this.options.onUnsupported?.({
        chatId: message.chat_id,
        chatType,
        type,
        senderOpenId: openId,
        mentioned: (message.mentions?.length ?? 0) > 0
      });
      return;
    }
    const raw = toRawMessage({
      event_id: data.event_id,
      sender: data.sender,
      message: {
        ...message,
        message_type: message.message_type ?? "unknown"
      }
    });
    if (!raw) {
      this.options.logger?.debug(`feishu-card: ignoring event for ${message.message_id}`);
      return;
    }
    await this.options.onMessage(raw);
  }
  async stop() {
    const ws = this.ws;
    this.ws = void 0;
    if (!ws) return;
    try {
      const closable = ws;
      closable.close?.();
    } catch (error) {
      this.options.logger?.warn(`feishu-card: gateway stop failed: ${error}`);
    }
  }
};

// src/host/sender.ts
import * as Lark2 from "@larksuiteoapi/node-sdk";
var FeishuSender = class {
  constructor(options) {
    this.options = options;
    this.client = new Lark2.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === "lark" ? Lark2.Domain.Lark : Lark2.Domain.Feishu
    });
  }
  client;
  /**
   * Send a plain text message into a chat. Long text is chunked by Feishu's limit.
   *
   * With `replyToMessageId` the message is posted as a reply, so Feishu renders
   * the "回复 XXX" quote header — which is how the user can tell which message
   * an answer belongs to.
   */
  async sendText(chatId, text, replyToMessageId) {
    const content = text.trim() || "（无内容）";
    const chunks = chunkText(content, 3e3);
    for (const chunk of chunks) {
      const payload = {
        msg_type: "text",
        content: JSON.stringify({ text: chunk })
      };
      try {
        if (replyToMessageId) {
          await this.client.im.v1.message.reply({
            path: { message_id: replyToMessageId },
            data: payload
          });
        } else {
          await this.client.im.v1.message.create({
            params: { receive_id_type: "chat_id" },
            data: { receive_id: chatId, ...payload }
          });
        }
      } catch (error) {
        this.options.logger?.warn(`feishu-card: send failed for ${chatId}: ${error}`);
        throw error;
      }
    }
  }
};
function chunkText(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = "";
  for (const source of text.split("\n")) {
    let line = source;
    while (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    if ((current + "\n" + line).length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}
${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// src/host/reaction.ts
import * as Lark3 from "@larksuiteoapi/node-sdk";
var ACK_EMOJI = "OnIt";
var DONE_EMOJI = "DONE";
var FeishuReactor = class {
  constructor(options) {
    this.options = options;
    const client = options.create && options.remove ? void 0 : new Lark3.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === "lark" ? Lark3.Domain.Lark : Lark3.Domain.Feishu
    });
    this.create = options.create ?? ((messageId, emojiType) => client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } }
    }));
    this.remove = options.remove ?? ((messageId, reactionId) => client.im.v1.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId }
    }));
  }
  /** Bounded memory of messages we reacted to (redelivery and settle both hit it). */
  placed = /* @__PURE__ */ new Map();
  create;
  remove;
  remember(messageId, placed) {
    this.placed.set(messageId, placed);
    if (this.placed.size > 500) {
      const oldest = this.placed.keys().next();
      if (!oldest.done) this.placed.delete(oldest.value);
    }
  }
  /** Add one reaction, returning the id Feishu assigned (when it reports one). */
  async add(messageId, emojiType) {
    const response = await this.create(messageId, emojiType);
    return response?.data?.reaction_id;
  }
  /**
   * React to one inbound message. Safe to call twice with the same id.
   *
   * @param messageId - the message the bot is answering
   * @param emojiType - Feishu emoji key; defaults to "on it"
   * @returns whether the reaction was accepted
   */
  async ack(messageId, emojiType = ACK_EMOJI) {
    if (!messageId) return false;
    if (this.placed.has(messageId)) return false;
    try {
      const reactionId = await this.add(messageId, emojiType);
      this.remember(messageId, { emoji: emojiType, ...reactionId ? { reactionId } : {} });
      return true;
    } catch (error) {
      this.options.logger?.warn(`feishu-card: reaction ${emojiType} on ${messageId} failed: ${error}`);
      return false;
    }
  }
  /**
   * Turn the receipt into its final state (✅ by default) once the answer is out.
   *
   * Adds the new emoji BEFORE removing the old one, so the message never sits
   * with no reaction for a moment. A message we never acked still gets the final
   * emoji — the create may simply have failed earlier.
   *
   * @param messageId - the message that was answered
   * @param emojiType - final Feishu emoji key
   * @returns whether the final reaction is in place
   */
  async settle(messageId, emojiType = DONE_EMOJI) {
    if (!messageId) return false;
    const previous = this.placed.get(messageId);
    if (previous?.emoji === emojiType) return true;
    try {
      const reactionId = await this.add(messageId, emojiType);
      this.remember(messageId, { emoji: emojiType, ...reactionId ? { reactionId } : {} });
    } catch (error) {
      this.options.logger?.warn(`feishu-card: final reaction ${emojiType} on ${messageId} failed: ${error}`);
      return false;
    }
    if (previous?.reactionId) await this.drop(messageId, previous.reactionId);
    return true;
  }
  /**
   * Remove the receipt entirely (the turn failed — "done" would be a lie).
   *
   * @param messageId - the message whose reaction should go away
   * @returns whether something was removed
   */
  async clear(messageId) {
    if (!messageId) return false;
    const previous = this.placed.get(messageId);
    this.placed.delete(messageId);
    if (!previous?.reactionId) return false;
    return this.drop(messageId, previous.reactionId);
  }
  /** Delete one reaction, best effort. */
  async drop(messageId, reactionId) {
    try {
      await this.remove(messageId, reactionId);
      return true;
    } catch (error) {
      this.options.logger?.warn(`feishu-card: could not remove reaction on ${messageId}: ${error}`);
      return false;
    }
  }
  /** What this message currently carries, for tests and diagnostics. */
  placedEmoji(messageId) {
    return this.placed.get(messageId)?.emoji;
  }
};

// src/host/quote.ts
import * as Lark4 from "@larksuiteoapi/node-sdk";
var CARD_TEXT_TAGS = /* @__PURE__ */ new Set(["plain_text", "lark_md", "markdown"]);
function cardText(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "";
  }
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    const record = node;
    const tag = typeof record.tag === "string" ? record.tag : void 0;
    if (tag && CARD_TEXT_TAGS.has(tag) && typeof record.content === "string") {
      const text = record.content.replace(/<[^>]+>/g, "").replace(/[*_`~]/g, "").trim();
      if (text) out.push(text);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") walk(value);
    }
  };
  walk(parsed);
  return out.join("\n").trim();
}
function messageTypeOf(payload) {
  const items = payload?.data?.items;
  const item = Array.isArray(items) ? items[0] : void 0;
  return typeof item?.msg_type === "string" ? item.msg_type : void 0;
}
function parseQuotedMessage(payload) {
  const items = payload?.data?.items;
  const item = Array.isArray(items) ? items[0] : void 0;
  if (!item) return void 0;
  if (item.deleted === true) {
    return { text: "（这条消息已被撤回）" };
  }
  const sender = item.sender;
  const userSender = sender?.sender_type === void 0 || sender.sender_type === "user";
  const senderOpenId = userSender ? sender?.id : sender?.open_bot_id;
  const type = typeof item.msg_type === "string" ? item.msg_type : "unknown";
  const raw = item.body?.content ?? "";
  let text = "";
  try {
    switch (type) {
      case "text":
        text = JSON.parse(raw).text ?? "";
        break;
      case "post":
        text = extractPostText(raw);
        break;
      case "image":
        text = "[图片]";
        break;
      case "file":
      case "audio":
      case "media":
        text = `[${type === "file" ? "文件" : type === "audio" ? "语音" : "视频"}]`;
        break;
      case "interactive":
        text = cardText(raw) || "[卡片消息]";
        break;
      case "system":
        text = "[系统提示]";
        break;
      default:
        text = `[${type === "unknown" ? "未知消息" : type}]`;
        break;
    }
  } catch {
    text = "";
  }
  if (!text.trim()) return void 0;
  return {
    ...senderOpenId ? { senderOpenId } : {},
    ...sender?.sender_name ? { senderName: sender.sender_name } : {},
    text
  };
}
var FeishuQuoteFetcher = class {
  constructor(options) {
    this.options = options;
    if (options.get) {
      this.get = options.get;
      return;
    }
    const client = new Lark4.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === "lark" ? Lark4.Domain.Lark : Lark4.Domain.Feishu
    });
    this.get = (messageId, callOptions) => client.im.v1.message.get({
      path: { message_id: messageId },
      params: {
        with_sender_name: true,
        // Read live: without this an `interactive` message returns Feishu's
        // "请升级至最新版本客户端" placeholder instead of the card body.
        ...callOptions?.cardContent ? { card_msg_content_type: "user_card_content" } : {}
      }
    });
  }
  get;
  /**
   * Resolve one quoted message. Never throws: a quote is context, not a
   * prerequisite, and a failed lookup must not cost the turn.
   */
  async fetch(messageId) {
    if (!messageId) return void 0;
    try {
      const payload = await this.get(messageId);
      const quoted = parseQuotedMessage(payload);
      if (quoted && messageTypeOf(payload) !== "interactive") return quoted;
      const withCard = await this.get(messageId, { cardContent: true });
      return parseQuotedMessage(withCard) ?? quoted;
    } catch (error) {
      this.options.logger?.warn(`feishu-card: could not read quoted message ${messageId}: ${error}`);
      return void 0;
    }
  }
};

// src/host/sessions.ts
import { mkdir as mkdir2, readFile as readFile2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
var SessionStore = class {
  constructor(file2) {
    this.file = file2;
  }
  sessions = /* @__PURE__ */ new Map();
  loaded = false;
  writeChain = Promise.resolve();
  async load() {
    if (this.loaded) return;
    try {
      const text = await readFile2(this.file, "utf8");
      const parsed = JSON.parse(text);
      for (const [key, record] of Object.entries(parsed.sessions ?? {})) {
        if (record && typeof record.sessionId === "string") this.sessions.set(key, record);
      }
    } catch {
    }
    this.loaded = true;
  }
  get(key) {
    return this.sessions.get(key);
  }
  keys() {
    return [...this.sessions.keys()];
  }
  get size() {
    return this.sessions.size;
  }
  /** Record (or refresh) a session for a chat key and persist. */
  put(key, record) {
    this.sessions.set(key, record);
    return this.enqueueFlush();
  }
  remove(key) {
    this.sessions.delete(key);
    return this.enqueueFlush();
  }
  enqueueFlush() {
    this.writeChain = this.writeChain.then(() => this.flush()).catch(() => void 0);
    return this.writeChain;
  }
  async flush() {
    const payload = { version: 1, sessions: Object.fromEntries(this.sessions) };
    await mkdir2(dirname2(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile2(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename2(tmp, this.file);
  }
};

// src/host/commands.ts
var BRIDGE_COMMANDS = ["status", "new", "stop", "help", "model"];
var COMMAND_SET = new Set(BRIDGE_COMMANDS);
function parseInput(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { args: [], text: trimmed };
  const [name, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (name && COMMAND_SET.has(name)) {
    return { command: name, args, text: "" };
  }
  return { args: [], text: trimmed };
}
function formatStatus(input) {
  const lines = [
    `连接：${input.connected ? "已连接" : "未连接"}`,
    `会话：${input.sessionKey}`,
    `session：${input.sessionId ?? "（尚未创建，下一条消息新建）"}`,
    `模型：${input.model ?? "跟随默认模型"}`,
    `私聊：${input.dmPolicy}（${input.allowlist.length} 个 open_id）`,
    `群聊：${input.groupPolicy}（${input.groupAllowlist.length} 个群）`,
    `群需 @：${input.requireMentionInGroups ? "是" : "否"}`,
    `回复模式：${input.replyMode}`,
    `本机会话数：${input.sessions}`
  ];
  return lines.join("\n");
}
function formatHelp() {
  return [
    "可用命令：",
    "/status — 查看连接、会话、模型与白名单状态",
    "/model — 查看当前模型；/model <provider/model> 切换本会话所用模型",
    "/new — 结束当前会话，下一条消息开新会话",
    "/stop — 停止当前正在跑的任务",
    "/help — 显示本帮助",
    "",
    "其它 / 开头的内容会交给 Harness 自己处理（如 /compact、/goal）。"
  ].join("\n");
}
function formatModel(current, requested) {
  if (!requested) {
    return current ? `当前模型：${current.provider}/${current.model}` : "当前模型：跟随默认模型。用 /model <provider/model> 指定，例如 /model magpie/auto-step-5-preview";
  }
  const slash = requested.indexOf("/");
  if (slash <= 0 || slash === requested.length - 1) {
    return `无法解析「${requested}」。格式：/model <provider/model>，例如 /model magpie/auto-step-5-preview`;
  }
  const provider = requested.slice(0, slash);
  const model = requested.slice(slash + 1);
  return `已将模型切换为 ${provider}/${model}，下一条消息生效。`;
}
function formatReset(done) {
  return done ? "已结束当前会话，下一条消息将开新会话。" : "当前没有活动会话。";
}
function formatStop(done) {
  return done ? "已停止当前任务。" : "当前没有正在跑的任务。";
}

// src/host/card/footer.ts
function compactNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1e3) return String(Math.round(value));
  if (value < 1e4) return `${(value / 1e3).toFixed(1)}k`;
  if (value < 1e6) return `${(value / 1e3).toFixed(1)}K`;
  return `${(value / 1e6).toFixed(1)}M`;
}
function formatContext(used, window) {
  if (!window || window <= 0 || used <= 0) return void 0;
  const percent = Math.min(999, Math.round(used / window * 100));
  return `${compactNumber(used)}/${compactNumber(window)} (${percent}%)`;
}
function formatModel2(model) {
  if (!model) return void 0;
  return model.startsWith("auto/") ? model.slice("auto/".length) : model;
}
function formatTokens(usage) {
  const input = usage.uncachedInputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  if (!input && !output) return void 0;
  const parts = [`↑ ${compactNumber(input)}`, `↓ ${compactNumber(output)}`];
  const cache = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (cache > 0) parts.push(`💾 ${compactNumber(cache)}`);
  return parts.join(" ");
}
function pressureTokens(usage) {
  return (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
function buildFooterInput(source) {
  const footer = { status: source.status };
  if (source.model) footer.model = formatModel2(source.model);
  const used = source.usedTokens && source.usedTokens > 0 ? source.usedTokens : source.usage ? pressureTokens(source.usage) : 0;
  const context = formatContext(used, source.contextWindow);
  if (context) footer.context = context;
  if (typeof source.elapsedMs === "number") {
    footer.elapsed = formatElapsedMs(source.elapsedMs);
  }
  const tokens = source.usage ? formatTokens(source.usage) : void 0;
  if (tokens) footer.tokens = tokens;
  return footer;
}
function formatElapsedMs(ms) {
  if (ms < 1e3) return `${ms}ms`;
  const seconds = ms / 1e3;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

// src/host/card/transport.ts
import * as Lark5 from "@larksuiteoapi/node-sdk";
var LarkCardTransport = class {
  constructor(options) {
    this.options = options;
    this.client = new Lark5.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === "lark" ? Lark5.Domain.Lark : Lark5.Domain.Feishu
    });
  }
  client;
  /** Create the card entity, post it into the chat, return its card id. */
  async createCard(chatId, card, replyToMessageId) {
    let cardId;
    try {
      const created = await this.client.cardkit.v1.card.create({
        data: { type: "card_json", data: JSON.stringify(card) }
      });
      cardId = readId(created?.data?.card_id);
    } catch (error) {
      throw toCardError("card.create", error);
    }
    if (!cardId) {
      throw new Error(
        "card.create returned no card_id — 检查应用是否已开通 CardKit（卡片）权限，或把回复模式改成纯文本"
      );
    }
    const messageId = await this.postCardMessage(
      chatId,
      JSON.stringify({ type: "card", data: { card_id: cardId } }),
      replyToMessageId
    );
    if (messageId) this.options.onCardMessage?.({ cardId, messageId });
    this.options.logger?.info?.(`feishu-card: card entity ${cardId} sent`);
    return cardId;
  }
  /**
   * Post a card into the chat, as a reply when a message id is given.
   *
   * Replying makes Feishu render the "回复 XXX" quote header, so an answer is
   * visibly attached to the message it answers.
   */
  async postCardMessage(chatId, content, replyToMessageId) {
    if (replyToMessageId) {
      const sent2 = await this.client.im.v1.message.reply({
        path: { message_id: replyToMessageId },
        data: { msg_type: "interactive", content }
      });
      return readId(sent2?.data?.message_id ?? sent2?.data?.messageId);
    }
    const sent = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: chatId, msg_type: "interactive", content }
    });
    return readId(sent?.data?.message_id ?? sent?.data?.messageId);
  }
  async updateCard(cardId, card, sequence) {
    await this.call(
      "update",
      this.client.cardkit.v1.card.update({
        data: { card: { type: "card_json", data: JSON.stringify(card) }, sequence },
        path: { card_id: cardId }
      })
    );
  }
  async batchUpdate(cardId, actions, sequence) {
    await this.call(
      "batchUpdate",
      this.client.cardkit.v1.card.batchUpdate({
        data: { actions: JSON.stringify(actions), sequence },
        path: { card_id: cardId }
      })
    );
  }
  async settings(cardId, settings, sequence) {
    await this.call(
      "settings",
      this.client.cardkit.v1.card.settings({
        data: { settings: JSON.stringify(settings), sequence },
        path: { card_id: cardId }
      })
    );
  }
  /**
   * Turn a non-zero Feishu code into a CardApiError carrying that code, so the
   * seal executor can branch on 300309/300301/300314/300315.
   */
  async call(operation, promise) {
    let response;
    try {
      response = await promise;
    } catch (error) {
      throw toCardError(operation, error);
    }
    if (response && typeof response.code === "number" && response.code !== 0) {
      throw new CardApiError(response.code, `${operation} failed: code=${response.code} msg=${response.msg}`);
    }
  }
};
function toCardError(operation, error) {
  const code = error?.code ?? error?.response?.code;
  if (typeof code === "number" && code !== 0) {
    return new CardApiError(code, `${operation} failed: code=${code} ${String(error).slice(0, 160)}`);
  }
  return error instanceof Error ? error : new Error(`${operation} failed: ${String(error)}`);
}
function readId(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}

// src/host/ask.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
var ASK_KEY = "feishuCardAsk";
var DEFAULT_TIMEOUT_MS = 5 * 60 * 1e3;
var FeishuAskUser = class {
  constructor(options) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }
  pendings = /* @__PURE__ */ new Map();
  timeoutMs;
  disposed = false;
  /** Number of questions waiting for an answer (diagnostics). */
  get pendingCount() {
    return this.pendings.size;
  }
  /** Remember which chat owns a session, so a tool call can find its way home. */
  bind(sessionId, chatId) {
    this.chats.set(sessionId, chatId);
  }
  chats = /* @__PURE__ */ new Map();
  /**
   * Register the Feishu asker in one agent's scope.
   *
   * Called from the bridge's `setup`, i.e. before the first prompt assembly, so
   * the tool exists for the whole agent lifetime.
   */
  registerTool(agentCtx) {
    const tools = agentCtx.get("tools");
    if (!tools) {
      this.options.log?.("ask_user_question: no tools service on the agent context");
      return;
    }
    tools.register(
      defineTool({
        name: "ask_user_question",
        description: "向用户提问以获取确认、选择或缺失信息。问题会以卡片形式发到当前飞书会话，用户点击选项按钮或直接回复消息即可回答；没有选项时只能直接回复消息。",
        parameters: {
          questions: {
            type: "array",
            required: true,
            description: "要问用户的问题列表。",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", required: true, description: "问题 id" },
                question: { type: "string", required: true, description: "问题正文" },
                header: { type: "string", description: "可选短标题" },
                options: {
                  type: "array",
                  description: "可选项；省略则用户直接回复消息。",
                  items: {
                    type: "object",
                    additionalProperties: true,
                    properties: {
                      label: { type: "string", required: true },
                      description: { type: "string" }
                    }
                  }
                },
                multi_select: { type: "boolean", description: "是否允许多选" }
              }
            }
          }
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answers: {
                type: "array",
                required: true,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string", required: true },
                    selected: { type: "array", required: true, items: { type: "string" } },
                    custom: { type: "string" }
                  }
                }
              }
            }
          },
          render: (_args, value) => [
            {
              type: "text",
              text: JSON.stringify(value)
            }
          ]
        },
        // A question blocks the turn, so two of them must never overlap.
        isConcurrencySafe: () => false,
        execute: async (args, exec) => {
          const agent = exec.agent;
          const sessionId = readSessionId(agent);
          const chatId = sessionId ? this.chats.get(sessionId) : void 0;
          if (!sessionId || !chatId) {
            throw new Error("ask_user_question 需要由飞书会话驱动的 agent");
          }
          const questions = normalizeQuestions(args.questions);
          if (questions.length === 0) throw new Error("ask_user_question 至少需要一个问题");
          const answers = await this.ask(sessionId, chatId, questions, exec.signal);
          return { answers };
        }
      })
    );
  }
  /** Ask one batch of questions and wait for the user's answer. */
  async ask(sessionId, chatId, questions, signal) {
    const id = `ask_${Math.random().toString(36).slice(2, 10)}`;
    const pending = {
      id,
      sessionId,
      chatId,
      questions,
      answers: /* @__PURE__ */ new Map(),
      resolve: () => void 0,
      timer: setTimeout(() => {
        this.pendings.delete(id);
        trace("ask-timeout", { askId: id, sessionId });
        void this.settle(pending, "⏰ 等待超时，已取消本次提问。");
        pending.resolve(this.collected(pending));
      }, this.timeoutMs)
    };
    pending.timer.unref?.();
    this.pendings.set(id, pending);
    const answered = new Promise((resolve) => {
      pending.resolve = resolve;
    });
    signal?.addEventListener(
      "abort",
      () => {
        if (!this.pendings.has(id)) return;
        this.pendings.delete(id);
        clearTimeout(pending.timer);
        trace("ask-aborted", { askId: id, sessionId });
        void this.settle(pending, "已停止。");
        pending.resolve(this.collected(pending));
      },
      { once: true }
    );
    try {
      pending.cardId = await this.options.transport.sendCard(chatId, buildAskCard(pending));
      trace("ask-sent", {
        askId: id,
        sessionId,
        chatId,
        cardId: pending.cardId ?? null,
        questions: questions.length
      });
    } catch (error) {
      this.pendings.delete(id);
      clearTimeout(pending.timer);
      trace("ask-send-failed", { askId: id, error: String(error) });
      throw new Error(`提问卡片发送失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return answered;
  }
  /**
   * Answers in question order, with unanswered questions reported as empty.
   *
   * An empty `selected` is an honest "nobody answered this one"; inventing a
   * value (the old behaviour) is worse than saying nothing.
   */
  collected(pending) {
    return pending.questions.map((question) => {
      const answer = pending.answers.get(question.id);
      return answer ? { id: question.id, selected: [...answer.selected], ...answer.custom ? { custom: answer.custom } : {} } : { id: question.id, selected: [] };
    });
  }
  unansweredQuestions(pending) {
    return pending.questions.filter((question) => !pending.answers.get(question.id)?.done);
  }
  /**
   * Route a card button click to its pending question.
   *
   * Returns the callback response (toast + the refreshed card, so Feishu
   * re-renders immediately) or undefined when the click was not ours.
   */
  async handleCardAction(data) {
    const value = readActionValue(data);
    if (!value || value[ASK_KEY] !== "select") return void 0;
    const askId = typeof value.askId === "string" ? value.askId : void 0;
    const option = typeof value.option === "string" ? value.option : void 0;
    const questionId = typeof value.questionId === "string" ? value.questionId : void 0;
    const confirm = value.confirm === true;
    const pending = askId ? this.pendings.get(askId) : void 0;
    if (!pending || !option && !confirm) return void 0;
    const question = pending.questions.find(
      (candidate) => questionId ? candidate.id === questionId : true
    );
    if (!question) return void 0;
    const current = pending.answers.get(question.id) ?? { id: question.id, selected: [], done: false };
    if (confirm) {
      if (current.selected.length === 0 && !current.custom) return void 0;
      pending.answers.set(question.id, { ...current, done: true });
    } else if (option) {
      const selected = question.multi_select ? current.selected.includes(option) ? current.selected.filter((item) => item !== option) : [...current.selected, option] : [option];
      pending.answers.set(question.id, {
        id: question.id,
        selected,
        done: question.multi_select ? false : true
      });
    }
    const remaining = this.unansweredQuestions(pending);
    const note = confirm ? `✅ 已确认：${(pending.answers.get(question.id)?.selected ?? []).join("、")}` : `✅ 已选择：${(pending.answers.get(question.id)?.selected ?? []).join("、")}`;
    const done = remaining.length === 0;
    if (done) {
      this.pendings.delete(pending.id);
      clearTimeout(pending.timer);
      trace("ask-answered", { askId: pending.id, questions: pending.questions.length });
      void this.settle(pending, "✅ 已全部回答。");
      pending.resolve(this.collected(pending));
    } else {
      trace("ask-partial", { askId: pending.id, remaining: remaining.length });
      void this.settle(pending, note);
    }
    return {
      toast: { type: "success", content: note },
      // `card` must be wrapped as `{type:'raw', data}` — a bare card object is
      // rejected, and Feishu then answers the click with its own error toast
      // even though the selection itself went through.
      card: { type: "raw", data: buildAskCard(pending, { note, settled: done }) }
    };
  }
  /**
   * Answer a pending question with the user's next chat message.
   *
   * The message answers the FIRST question still waiting — not every question,
   * and not "the only one", so a multi-question ask can be finished by typing
   * two replies in a row.
   *
   * There is deliberately no "free-form mode" to enter first: while a question
   * is open, whatever the user types IS the answer. Gating this behind a button
   * (as an earlier revision did) sent the reply to the agent as a brand-new
   * turn, so the question was never answered and the card hung on its loading
   * state forever.
   *
   * @returns true when the message was consumed as an answer.
   */
  handleChatMessage(sessionId, text) {
    let target;
    for (const pending of this.pendings.values()) {
      if (pending.sessionId === sessionId) target = pending;
    }
    if (!target) return false;
    const question = this.unansweredQuestions(target)[0];
    if (!question) return false;
    target.answers.set(question.id, { id: question.id, selected: [], custom: text, done: true });
    const remaining = this.unansweredQuestions(target);
    trace("ask-answered-message", {
      askId: target.id,
      length: text.length,
      remaining: remaining.length
    });
    if (remaining.length === 0) {
      this.pendings.delete(target.id);
      clearTimeout(target.timer);
      void this.settle(target, `✏️ 已收到你的回答：${text}`);
      target.resolve(this.collected(target));
      return true;
    }
    void this.settle(target, `✏️ 已记录这一题：${text}`);
    return true;
  }
  /**
   * Replace a pending ask's card with its current state.
   *
   * Takes the ask object rather than an id: by the time a question is answered
   * it may already have left the map, and looking it up again would silently
   * skip the refresh (leaving a stale, still-clickable card behind).
   */
  async settle(pending, note) {
    if (!pending.cardId) return;
    try {
      const settled = this.unansweredQuestions(pending).length === 0;
      await this.options.transport.updateCard(
        pending.cardId,
        buildAskCard(pending, { note, settled })
      );
      trace("ask-card-updated", { askId: pending.id, cardId: pending.cardId });
    } catch (error) {
      this.options.log?.(`ask card refresh failed for ${pending.id}: ${error}`);
      trace("ask-card-update-failed", { askId: pending.id, error: String(error) });
    }
  }
  /** Cancel every pending question (plugin shutdown). */
  dispose() {
    this.disposed = true;
    for (const pending of this.pendings.values()) {
      clearTimeout(pending.timer);
      pending.resolve(this.collected(pending));
    }
    this.pendings.clear();
  }
};
function buildAskCard(pending, options = {}) {
  const elements = [];
  const collected = pending.answers ?? /* @__PURE__ */ new Map();
  pending.questions.forEach((question, index) => {
    const prefix = pending.questions.length > 1 ? `**${index + 1}. ` : "**";
    const head = [question.header ? `**${question.header}**` : "", `${prefix}${question.question}**`].filter(Boolean).join("\n");
    const answer = collected.get(question.id);
    const choices = question.options ?? [];
    const lines = [head];
    choices.forEach((choice, choiceIndex) => {
      const label = choiceIndex < 26 ? String.fromCharCode(65 + choiceIndex) : String(choiceIndex + 1);
      const mark = answer?.selected.includes(choice.label) ? "✅ " : "";
      lines.push(`${mark}${label}. ${choice.label}`);
    });
    if (answer?.custom) lines.push(`✏️ ${answer.custom}`);
    if (choices.length === 0 && !answer?.done) {
      lines.push("", "直接回复消息输入你的答案。");
    }
    elements.push({
      tag: "markdown",
      element_id: `ask_question_${index}`,
      content: lines.join("\n"),
      i18n_content: { zh_cn: lines.join("\n"), en_us: lines.join("\n") }
    });
    const answered = Boolean(answer?.done);
    if (answered || choices.length === 0) return;
    const buttons = choices.map((choice, choiceIndex) => {
      const active = answer?.selected.includes(choice.label);
      return {
        tag: "button",
        element_id: `ask_option_${index}_${choiceIndex}`,
        text: { tag: "plain_text", content: choice.label.slice(0, 100) },
        // A multi-select keeps its picks visible by rendering them filled.
        type: active ? "primary" : "default",
        behaviors: [
          {
            type: "callback",
            value: {
              [ASK_KEY]: "select",
              askId: pending.id,
              questionId: question.id,
              option: choice.label
            }
          }
        ]
      };
    });
    if (question.multi_select) {
      buttons.push({
        tag: "button",
        element_id: `ask_confirm_${index}`,
        text: { tag: "plain_text", content: "确认" },
        type: "primary",
        behaviors: [
          {
            type: "callback",
            value: {
              [ASK_KEY]: "select",
              askId: pending.id,
              questionId: question.id,
              option: "确认",
              confirm: true
            }
          }
        ]
      });
    }
    elements.push({
      tag: "column_set",
      element_id: `ask_options_${index}`,
      columns: buttons.map((button) => ({
        tag: "column",
        width: "weighted",
        weight: 1,
        elements: [button]
      }))
    });
  });
  if (options.note) {
    elements.push({
      tag: "markdown",
      element_id: "ask_note",
      content: `**${options.note}**`,
      i18n_content: { zh_cn: `**${options.note}**`, en_us: `**${options.note}**` }
    });
  }
  return {
    schema: "2.0",
    config: { locales: ["zh_cn", "en_us"] },
    body: { elements }
  };
}
function normalizeQuestions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw;
    const id = typeof record.id === "string" ? record.id : "";
    const question = typeof record.question === "string" ? record.question : "";
    if (!id || !question) continue;
    const options = Array.isArray(record.options) ? record.options.map((entry) => {
      if (!entry || typeof entry !== "object") return void 0;
      const label = entry.label;
      return typeof label === "string" && label ? { label } : void 0;
    }).filter((entry) => Boolean(entry)) : [];
    out.push({
      id,
      question,
      ...typeof record.header === "string" && record.header ? { header: record.header } : {},
      ...options.length > 0 ? { options } : {},
      ...record.multi_select === true ? { multi_select: true } : {}
    });
  }
  return out;
}
function readActionValue(data) {
  if (!data || typeof data !== "object") return void 0;
  const action = data.action;
  const value = action?.value;
  return value && typeof value === "object" ? value : void 0;
}
function readSessionId(agent) {
  if (!agent || typeof agent !== "object") return void 0;
  const direct = agent.id;
  if (typeof direct === "string" && direct) return direct;
  const header = agent.session?.header?.id;
  return typeof header === "string" && header ? header : void 0;
}

// src/host/contextwin.ts
var BUILT_IN = {
  "deepseek-chat": 65536,
  "deepseek-reasoner": 65536,
  "deepseek-v3": 65536,
  "deepseek-v3.1": 65536,
  "deepseek-flash": 65536,
  "deepseek-v4-flash": 65536,
  "deepseek-v4-pro": 131072,
  "gpt-4o": 128e3,
  "gpt-4o-mini": 128e3,
  "gpt-4.1": 1047576,
  "gpt-5": 4e5,
  "claude-sonnet-4": 2e5,
  "claude-opus-4": 2e5,
  "claude-3-5-sonnet": 2e5,
  "glm-4.6": 2e5,
  "glm-5": 2e5,
  "glm-5.3": 2e5,
  "glm-5.3-flash": 2e5,
  "qwen-max": 32768,
  "qwen-plus": 131072,
  "qwen3-max": 262144,
  "kimi-k2": 262144,
  "mimo-v2.5-pro": 1e6,
  "step-5-preview": 2e5
};
function resolveContextWindow(model, overrides = {}) {
  if (!model) return void 0;
  const exact = overrides[model];
  if (typeof exact === "number" && exact > 0) return exact;
  const known = BUILT_IN[model];
  if (typeof known === "number" && known > 0) return known;
  const slash = model.lastIndexOf("/");
  if (slash > 0) {
    const prefix = model.slice(0, slash);
    const suffix = model.slice(slash + 1);
    const byPrefix = overrides[prefix] ?? BUILT_IN[prefix];
    if (typeof byPrefix === "number" && byPrefix > 0) return byPrefix;
    const bySuffix = overrides[suffix] ?? BUILT_IN[suffix];
    if (typeof bySuffix === "number" && bySuffix > 0) return bySuffix;
  }
  let best;
  for (const [key, value] of Object.entries({ ...BUILT_IN, ...overrides })) {
    if (model.startsWith(key) && value > 0 && (!best || key.length > best[0])) {
      best = [key.length, value];
    }
  }
  return best?.[1];
}

// src/host/usage.ts
function readUsage(ctx, agent, fallbackWindow) {
  const projections = ctx.get("sessionProjections");
  if (!projections) {
    trace("usage-no-service", { fallbackWindow: fallbackWindow ?? null });
    return fallbackWindow ? { contextWindow: fallbackWindow } : {};
  }
  let values;
  try {
    values = projections.snapshot(agent.session, ["tokenUsage", "contextPressure"]).values ?? {};
  } catch (error) {
    trace("usage-snapshot-failed", { error: String(error) });
    return fallbackWindow ? { contextWindow: fallbackWindow } : {};
  }
  const pressure = values.contextPressure;
  const usage = values.tokenUsage;
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
  const contextWindow = pressure?.contextWindow ?? fallbackWindow;
  const reading = {
    usedTokens: typeof usedTokens === "number" ? usedTokens : void 0,
    contextWindow: typeof contextWindow === "number" ? contextWindow : void 0,
    usage: usage && typeof usage === "object" ? usage : void 0
  };
  trace("usage-reading", {
    usedTokens: reading.usedTokens ?? null,
    contextWindow: reading.contextWindow ?? null,
    fallbackWindow: fallbackWindow ?? null,
    hasPressure: Boolean(pressure),
    hasUsage: Boolean(usage),
    pressureKeys: pressure ? Object.keys(pressure) : []
  });
  return reading;
}

// src/host/media.ts
import * as Lark6 from "@larksuiteoapi/node-sdk";
import { mkdir as mkdir3 } from "node:fs/promises";
import path2 from "node:path";
var MAX_BYTES = 30 * 1024 * 1024;
var FeishuMedia = class {
  constructor(options) {
    this.options = options;
    this.client = new Lark6.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === "lark" ? Lark6.Domain.Lark : Lark6.Domain.Feishu
    });
  }
  client;
  /**
   * Download one message resource and return the local path.
   *
   * The file name is derived from the message id (unique per message) plus a
   * sanitized suffix, so two identical screenshots never overwrite each other
   * and a hostile `file_name` cannot escape the directory.
   */
  async saveResource(input) {
    const dir = this.options.dir;
    await mkdir3(dir, { recursive: true });
    const suffix = safeSuffix(input.fileName, input.kind);
    const target = path2.join(dir, `${sanitize(input.messageId)}${suffix}`);
    const response = await this.client.im.v1.messageResource.get({
      path: { message_id: input.messageId, file_key: input.fileKey },
      params: { type: input.kind }
    });
    await response.writeFile(target);
    this.options.logger?.debug?.(`feishu-card: saved ${input.kind} → ${target}`);
    return target;
  }
  /**
   * Upload an image for use inside a card and return its `img_key`.
   *
   * `image_type: 'message'` is the bucket card images and chat images read
   * from; the `'avatar'` bucket would upload fine and never render.
   */
  async uploadImage(bytes, name) {
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error(`image too large (${Math.round(bytes.byteLength / 1024)} KB)`);
    }
    const response = await this.client.im.v1.image.create({
      data: { image_type: "message", image: Buffer.from(bytes) }
    });
    const key = response?.image_key;
    if (!key) throw new Error(`image upload returned no image_key for ${name}`);
    return key;
  }
};
function sanitize(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}
var EXT_BY_KIND = {
  image: ".png",
  file: ".bin",
  audio: ".opus",
  media: ".mp4"
};
function safeSuffix(fileName, kind) {
  if (fileName) {
    const ext = path2.extname(fileName);
    if (ext && ext.length <= 12) return sanitize(ext);
  }
  return EXT_BY_KIND[kind];
}
async function fetchBytes(url, timeoutMs = 5e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new Error("image too large");
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}

// src/host/card/images.ts
var RE_IMAGE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
var MAX_IMAGES_PER_ANSWER = 3;
function createImageResolver(options) {
  const cache = /* @__PURE__ */ new Map();
  const fetch2 = options.fetchBytes ?? fetchBytes;
  const max = options.max ?? MAX_IMAGES_PER_ANSWER;
  return async (text) => {
    const urls = [...text.matchAll(RE_IMAGE)].map((match) => match[2]);
    if (urls.length === 0) return text;
    const unique = [...new Set(urls)].slice(0, max);
    const keys = /* @__PURE__ */ new Map();
    for (const url of unique) {
      const cached = cache.get(url);
      if (cached) {
        keys.set(url, cached);
        continue;
      }
      try {
        const bytes = await fetch2(url);
        const name = url.split("/").pop()?.split("?")[0] || "image.png";
        const key = await options.upload(bytes, name);
        cache.set(url, key);
        keys.set(url, key);
      } catch (error) {
        options.log?.(`feishu-card: image upload failed for ${url}: ${error}`);
      }
    }
    if (keys.size === 0) return text;
    return text.replace(RE_IMAGE, (whole, alt, url) => {
      const key = keys.get(url);
      return key ? `![${alt}](${key})` : whole;
    });
  };
}

// src/host/bot.ts
import * as Lark7 from "@larksuiteoapi/node-sdk";
function createBotOpenId(options) {
  const { read, log } = options;
  let cachedFor;
  let cached;
  let reader;
  const readerFor = () => {
    const config = read();
    if (!config.appId || !config.appSecret) return void 0;
    if (cachedFor !== config.appId || !reader) {
      const create = options.createClient ?? ((input) => new Lark7.Client(input));
      reader = create({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: config.brand === "lark" ? Lark7.Domain.Lark : Lark7.Domain.Feishu
      });
      cachedFor = config.appId;
      cached = void 0;
    }
    return reader;
  };
  return async () => {
    const client = readerFor();
    if (cached) return cached;
    if (!client) return void 0;
    try {
      const response = await client.request({ method: "GET", url: "/open-apis/bot/v3/info" });
      if (response?.code !== void 0 && response.code !== 0) return void 0;
      const openId = response?.bot?.open_id;
      if (openId) cached = openId;
      return openId;
    } catch (error) {
      log?.(`feishu-card: bot info failed: ${String(error).slice(0, 160)}`);
      return void 0;
    }
  };
}

// src/host/recent.ts
import { mkdir as mkdir4, readFile as readFile3, writeFile as writeFile4 } from "node:fs/promises";
import path3 from "node:path";
var RecentContacts = class {
  constructor(options) {
    this.options = options;
    this.limit = options.limit ?? 200;
  }
  senders = /* @__PURE__ */ new Map();
  limit;
  loaded = false;
  saveTimer;
  /** Read the persisted ring; a missing or corrupt file just starts empty. */
  async load() {
    try {
      const raw = await readFile3(this.options.file, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          if (typeof row !== "object" || row === null) continue;
          const entry = row;
          if (typeof entry.openId !== "string" || !entry.openId) continue;
          if (typeof entry.chatId !== "string" || !entry.chatId) continue;
          this.senders.set(entry.openId, {
            openId: entry.openId,
            chatId: entry.chatId,
            at: typeof entry.at === "number" ? entry.at : 0,
            count: typeof entry.count === "number" ? entry.count : 1
          });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.options.log?.(`feishu-card: recent contacts unreadable (${String(error)})`);
      }
    }
    this.loaded = true;
    this.trim();
  }
  /** Record one inbound message's sender. Cheap: in-memory, save is debounced. */
  note(openId, chatId, at = Date.now()) {
    if (!openId || !chatId) return;
    const previous = this.senders.get(openId);
    this.senders.delete(openId);
    this.senders.set(openId, {
      openId,
      chatId,
      at,
      count: (previous?.count ?? 0) + 1
    });
    this.trim();
    this.scheduleSave();
  }
  /** Recent senders, newest first. */
  list() {
    return [...this.senders.values()].sort((a, b) => b.at - a.at);
  }
  /** Distinct chats seen recently, newest first — the group allowlist's shortcut. */
  chats() {
    const seen = /* @__PURE__ */ new Map();
    for (const sender of this.senders.values()) {
      const previous = seen.get(sender.chatId) ?? 0;
      if (sender.at > previous) seen.set(sender.chatId, sender.at);
    }
    return [...seen.entries()].map(([chatId, at]) => ({ chatId, at })).sort((a, b) => b.at - a.at);
  }
  /** Write now, cancelling any pending debounce (used by tests and shutdown). */
  async flush() {
    if (this.saveTimer !== void 0) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    if (!this.loaded) return;
    try {
      await mkdir4(path3.dirname(this.options.file), { recursive: true });
      await writeFile4(this.options.file, JSON.stringify(this.list()), "utf8");
    } catch (error) {
      this.options.log?.(`feishu-card: recent contacts save failed (${String(error)})`);
    }
  }
  trim() {
    while (this.senders.size > this.limit) {
      const oldest = this.senders.keys().next();
      if (oldest.done) break;
      this.senders.delete(oldest.value);
    }
  }
  scheduleSave() {
    if (this.saveTimer !== void 0) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = void 0;
      void this.flush();
    }, 1e3);
    this.saveTimer.unref?.();
  }
};

// src/host/runtime.ts
function shouldSendTextFallback(result) {
  if (result.carded) return false;
  return !(result.reason === "stopped" && result.cardCreated);
}
function stopDenied(owner, clicker) {
  if (!owner || !clicker || owner === clicker) return void 0;
  return "只有发起这条消息的人可以停止本轮回复";
}
function labelOf(kind) {
  switch (kind) {
    case "image":
      return "图片";
    case "audio":
      return "语音";
    case "media":
      return "视频";
    case "file":
      return "文件";
  }
}
function createRuntime(ctx, read, initial, deps = {}) {
  const home2 = process.env.DSH_HOME || path4.join(homedir2(), ".dsh");
  const store = new SessionStore(path4.join(home2, "feishu-card", "sessions.json"));
  const dedup = new Dedup(initial.dedupTtlMs, Date.now, path4.join(home2, "feishu-card", "seen.json"));
  const botOpenId = createBotOpenId({
    read,
    ...deps.createBotReader === void 0 ? {} : { createClient: deps.createBotReader },
    log: (message) => ctx.logger.debug(message)
  });
  const recent = deps.recent ?? new RecentContacts({
    file: path4.join(home2, "feishu-card", "recent.json"),
    log: (message) => ctx.logger.debug(message)
  });
  const media = new FeishuMedia({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    dir: path4.join(home2, "feishu-card", "media"),
    logger: { warn: (message) => ctx.logger.warn(message), debug: (m) => ctx.logger.debug(m) }
  });
  const resolveImages = createImageResolver({
    upload: (bytes, name) => media.uploadImage(bytes, name),
    log: (message) => ctx.logger.debug(message)
  });
  const cardsById = /* @__PURE__ */ new Map();
  const cardIdByMessage = /* @__PURE__ */ new Map();
  const sender = (deps.createSender ?? ((options) => new FeishuSender(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: ctx.logger
  });
  const reactor = (deps.createReactor ?? ((options) => new FeishuReactor(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: { warn: (message) => ctx.logger.warn(message) }
  });
  const quote = (deps.createQuote ?? ((options) => new FeishuQuoteFetcher(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: { warn: (message) => ctx.logger.warn(message) }
  });
  const cardTransport = (deps.createCardTransport ?? ((options) => new LarkCardTransport(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: { warn: (message) => ctx.logger.warn(message) },
    onCardMessage: ({ cardId, messageId }) => {
      cardIdByMessage.set(messageId, cardId);
      if (cardIdByMessage.size > 500) {
        const oldest = cardIdByMessage.keys().next();
        if (!oldest.done) cardIdByMessage.delete(oldest.value);
      }
    }
  });
  const askSequences = /* @__PURE__ */ new Map();
  const askTransport = {
    sendCard: (chatId, card) => cardTransport.createCard(chatId, card),
    updateCard: (cardId, card) => {
      const sequence = (askSequences.get(cardId) ?? 0) + 1;
      askSequences.set(cardId, sequence);
      return cardTransport.updateCard(cardId, card, sequence);
    }
  };
  const ask = new FeishuAskUser({
    transport: askTransport,
    log: (message) => ctx.logger.debug(message)
  });
  const attachWorkspace = async (sessionId, cwd) => {
    const registry = ctx.get("workspaceRegistry");
    if (!registry) return;
    const workspace = await registry.resolveByPath(cwd);
    if (!workspace) {
      ctx.logger.debug(`feishu-card: no workspace registered for ${cwd}; session stays ungrouped`);
      return;
    }
    await workspace.attachSession(sessionId);
    trace("workspace-attached", { sessionId, cwd });
  };
  const bridge = new FeishuBridge(ctx, {
    store,
    // Read live: switching workspace in the panel applies to new sessions.
    defaultWorkspace: () => read().defaultWorkspace,
    // Explicit model route for created agents; absent = the host's default.
    // Without a selection the prompt assembly has no {{model}} variable and
    // every turn fails with "prompt variable \"{{model}}\" has no value".
    // Read per session so a panel edit or /model applies to the next session.
    model: () => {
      const config = read();
      return config.provider && config.model ? { provider: config.provider, model: config.model } : void 0;
    },
    ask,
    attachWorkspace,
    turnTimeoutMs: read().turnTimeoutMs,
    /**
     * One card per turn, or undefined for a plain-text reply.
     *
     * The `replyMode` check lives INSIDE this function, not around it: closing
     * over it once meant switching between 流式卡片 and 纯文本 in the panel only
     * took effect after restarting dsh, the one thing every other setting
     * manages without.
     *
     * `state` is this turn's own object, so two chats streaming at once never
     * read each other's round count or tool list.
     */
    createCard: (chatId, agent, state, replyToMessageId) => {
      if (read().replyMode !== "streaming") return void 0;
      const config = read();
      const card = new StreamingCard({
        transport: cardTransport,
        chatId,
        footerFields: config.footerFields,
        flushIntervalMs: config.flushIntervalMs,
        showReasoning: config.showReasoning,
        panelExpanded: config.panelExpanded,
        sessionKey: state.sessionKey,
        // Only the person who asked may press ◯ 停止 (see handleCardAction).
        ...state.ownerOpenId ? { stopOwnerOpenId: state.ownerOpenId } : {},
        log: (message) => ctx.logger.debug(message),
        resolveImages,
        onCardId: (cardId) => {
          cardsById.set(cardId, card);
          if (cardsById.size > 500) {
            const oldest = cardsById.keys().next();
            if (!oldest.done) cardsById.delete(oldest.value);
          }
        },
        // The panel's header repeats the model, shortened the same way the
        // footer shortens it, plus the reasoning-round and tool counts.
        panelModel: () => {
          const model = agent.options?.model || read().model || void 0;
          return model ? model.replace(/^auto\//, "") : void 0;
        },
        panelRounds: () => state.rounds,
        replyToMessageId,
        footerSource: () => {
          const live = read();
          const model = agent.options?.model || live.model || void 0;
          const projected = readUsage(
            ctx,
            agent,
            resolveContextWindow(model, live.contextWindows)
          );
          const usage = {
            ...projected,
            usedTokens: projected.usedTokens ?? void 0,
            // Same bucket names the projection reports, so the footer's
            // formatter sees one shape whichever source won.
            usage: projected.usage ?? (state.usage.inputTokens || state.usage.outputTokens ? {
              uncachedInputTokens: state.usage.inputTokens,
              outputTokens: state.usage.outputTokens,
              cacheReadTokens: state.usage.cacheReadTokens,
              cacheWriteTokens: state.usage.cacheWriteTokens
            } : void 0)
          };
          trace("footer", {
            chatId,
            model,
            usedTokens: usage.usedTokens ?? null,
            contextWindow: usage.contextWindow ?? null,
            uncachedInput: usage.usage?.uncachedInputTokens ?? null,
            output: usage.usage?.outputTokens ?? null,
            cacheRead: usage.usage?.cacheReadTokens ?? null,
            cacheWrite: usage.usage?.cacheWriteTokens ?? null
          });
          return buildFooterInput({ status: "思考中", model, ...usage });
        }
      });
      return card;
    }
  });
  const gateway = (deps.createGateway ?? ((options) => new FeishuGateway(options)))({
    appId: initial.appId,
    appSecret: initial.appSecret,
    brand: initial.brand,
    logger: {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
      debug: (message) => ctx.logger.debug(message)
    },
    onUnsupported: ({ chatId, chatType, type, senderOpenId, mentioned }) => {
      const decision = decideAccess(
        {
          chatType,
          chatId,
          senderOpenId: senderOpenId ?? "",
          mentioned: Boolean(mentioned),
          mentionAllOnly: false
        },
        read()
      );
      if (!decision.allowed) {
        ctx.logger.debug(
          `feishu-card: unsupported ${type} from ${senderOpenId} in ${chatId} not answered (${decision.reason})`
        );
        return;
      }
      if (chatType !== "p2p") return;
      void sender.sendText(chatId, `暂时只支持文字消息（收到 ${type}）。`).catch(() => void 0);
    },
    onCardAction: (data) => handleCardAction(data),
    // Message protection: the user recalled the card, so stop writing to it.
    onMessageRecalled: ({ messageId }) => {
      const cardId = cardIdByMessage.get(messageId);
      const card = cardId ? cardsById.get(cardId) : void 0;
      if (!card) return;
      card.markUnavailable("recalled");
      cardIdByMessage.delete(messageId);
      cardsById.delete(cardId);
      trace("card-recalled", { messageId, cardId });
      ctx.logger.info(`feishu-card: card ${cardId} was recalled; stopped updating it`);
    },
    onMessage: inbound,
    onAttachment: (attachment) => {
      void handleAttachment(attachment).catch((error) => {
        ctx.logger.warn(`feishu-card: attachment handling failed: ${error}`);
      });
    }
  });
  async function handleAttachment(info) {
    if (!dedup.check(info.eventId)) return;
    recent.note(info.senderOpenId, info.chatId);
    const mentionedBotId = info.mentions?.length ? await botOpenId() : void 0;
    const message = normalizeInbound(
      {
        messageId: info.messageId,
        eventId: info.eventId,
        chatId: info.chatId,
        chatType: info.chatType,
        senderOpenId: info.senderOpenId,
        senderType: info.senderType,
        text: "",
        mentions: info.mentions
      },
      mentionedBotId
    );
    const decision = decideAccess(message, read());
    if (!decision.allowed) {
      ctx.logger.info(
        `feishu-card: denied ${info.type} from ${info.senderOpenId}: ${describeDeny(decision.reason)}`
      );
      return;
    }
    const kind = info.type;
    let localPath;
    try {
      localPath = await media.saveResource({
        messageId: info.messageId,
        fileKey: info.fileKey,
        kind,
        fileName: info.fileName
      });
    } catch (error) {
      ctx.logger.warn(`feishu-card: download failed (${info.type}): ${error}`);
      await sender.sendText(info.chatId, `这个${labelOf(kind)}我没能下载下来：${String(error).slice(0, 160)}`).catch(() => void 0);
      return;
    }
    trace("attachment-saved", { chatId: info.chatId, type: info.type, path: localPath });
    const text = `[用户发来${labelOf(kind)}${info.fileName ? `：${info.fileName}` : ""}]
已保存到本地：${localPath}`;
    await inbound({
      messageId: info.messageId,
      eventId: `${info.eventId}:media`,
      chatId: info.chatId,
      chatType: info.chatType,
      senderOpenId: info.senderOpenId,
      senderType: info.senderType,
      text
    });
  }
  async function handleCardAction(data) {
    const askResponse = await ask.handleCardAction(data);
    if (askResponse) return askResponse;
    const value = data?.action?.value;
    if (!value || typeof value !== "object") return void 0;
    const stop = value;
    if (stop.feishuCardStop !== "stop" || typeof stop.sessionKey !== "string") return void 0;
    const owner = typeof stop.ownerOpenId === "string" ? stop.ownerOpenId : void 0;
    const clicker = operatorOpenId(data);
    const denied = stopDenied(owner, clicker);
    if (denied) {
      trace("card-stop-refused", { sessionKey: stop.sessionKey, owner, clicker });
      return { toast: { type: "warning", content: denied } };
    }
    trace("card-stop", { sessionKey: stop.sessionKey, owner: owner ?? null, clicker: clicker ?? null });
    await bridge.stop(stop.sessionKey);
    return { toast: { type: "info", content: "已请求停止当前任务" } };
  }
  function operatorOpenId(data) {
    if (!data || typeof data !== "object") return void 0;
    const payload = data;
    for (const candidate of [payload.operator?.open_id, payload.open_id, payload.context?.open_id]) {
      if (typeof candidate === "string" && candidate) return candidate;
    }
    return void 0;
  }
  async function describeEnvelope(raw, message) {
    const others = message.othersMentioned ?? [];
    const ids = [message.senderOpenId, ...others.map((mention) => mention.openId ?? "")].filter(
      (id) => id.length > 0
    );
    let senderName = deps.names?.user(message.senderOpenId);
    if (!senderName && deps.directory && ids.length > 0) {
      try {
        const resolved = (await deps.directory.names(ids)).names;
        senderName = resolved[message.senderOpenId];
        if (senderName) deps.names?.rememberUsers({ [message.senderOpenId]: senderName });
      } catch (error) {
        ctx.logger.debug(`feishu-card: sender name lookup failed: ${String(error).slice(0, 160)}`);
      }
    }
    const envelope = {
      chatType: message.chatType,
      senderOpenId: message.senderOpenId,
      ...senderName ? { senderName } : {},
      others
    };
    const quoteId = raw.parentId ?? (message.threadId ? raw.rootId : void 0);
    if (quoteId) {
      try {
        const quoted = await quote.fetch(quoteId);
        if (quoted) {
          if (!quoted.senderName && quoted.senderOpenId && deps.directory) {
            const { names } = await deps.directory.names([quoted.senderOpenId]);
            const name = names[quoted.senderOpenId];
            if (name) quoted.senderName = name;
          }
          envelope.quote = quoted;
          trace("quote-attached", {
            chatId: raw.chatId,
            quoteId,
            length: quoted.text.length,
            sender: quoted.senderOpenId ?? null
          });
        }
      } catch (error) {
        ctx.logger.debug(`feishu-card: quote lookup failed: ${String(error).slice(0, 160)}`);
      }
    }
    return envelope;
  }
  async function inbound(raw) {
    trace("inbound", {
      chatId: raw.chatId,
      chatType: raw.chatType,
      sender: raw.senderOpenId,
      text: (raw.text ?? "").slice(0, 120)
    });
    if (!dedup.check(raw.eventId)) {
      ctx.logger.debug(`feishu-card: duplicate event ${raw.eventId} ignored`);
      trace("dedup-skipped", { eventId: raw.eventId });
      return;
    }
    recent.note(raw.senderOpenId, raw.chatId);
    const mentionedBotId = raw.mentions?.length ? await botOpenId() : void 0;
    const message = normalizeInbound(raw, mentionedBotId);
    const config = read();
    const sessionKey = sessionKeyFor(message, config.sessionScope);
    const decision = decideAccess(message, config);
    if (!decision.allowed) {
      ctx.logger.info(
        `feishu-card: denied ${sessionKey} from ${message.senderOpenId}: ${decision.reason} (${describeDeny(decision.reason)})`
      );
      return;
    }
    void reactor.ack(raw.messageId, ACK_EMOJI);
    const answered = await answerAccepted(raw, message, sessionKey, mentionedBotId);
    void (answered ? reactor.settle(raw.messageId, DONE_EMOJI) : reactor.clear(raw.messageId));
  }
  async function answerAccepted(raw, message, sessionKey, mentionedBotId) {
    if (!message.text) {
      ctx.logger.debug(`feishu-card: empty text after mention strip in ${sessionKey}`);
      return false;
    }
    const sessionId = bridge.describe(sessionKey).sessionId;
    if (sessionId && ask.handleChatMessage(sessionId, message.text)) {
      trace("ask-answered", { sessionKey, length: message.text.length });
      return false;
    }
    const parsed = parseInput(message.text);
    if (parsed.command) {
      await sender.sendText(
        message.chatId,
        await handleCommand(parsed.command, sessionKey, message.chatId, parsed.args, message.senderOpenId),
        raw.messageId
      );
      return true;
    }
    ctx.logger.info(`feishu-card: turn in ${sessionKey} from ${message.senderOpenId}`);
    const envelope = await describeEnvelope(raw, message);
    const turnText = composeTurnText(message.text, envelope);
    trace("turn-start", {
      sessionKey,
      text: message.text.slice(0, 120),
      composed: turnText.length,
      hasQuote: Boolean(envelope.quote),
      senderName: envelope.senderName ?? null
    });
    try {
      const result = await bridge.handleMessage({
        sessionKey,
        chatId: message.chatId,
        text: turnText,
        replyToMessageId: raw.messageId,
        chatType: message.chatType,
        // Ownership of the turn: only this person may stop it.
        senderOpenId: message.senderOpenId,
        ...mentionedBotId ? { botOpenId: mentionedBotId } : {}
      });
      trace("turn-result", {
        sessionKey,
        carded: result.carded,
        timedOut: result.timedOut,
        model: result.model,
        textLength: result.text.length,
        text: result.text.slice(0, 200)
      });
      if (shouldSendTextFallback(result)) {
        await sender.sendText(message.chatId, result.text, raw.messageId);
      }
      return true;
    } catch (error) {
      ctx.logger.warn(`feishu-card: turn failed in ${sessionKey}: ${error}`);
      trace("turn-error", { sessionKey, error: String(error) });
      await sender.sendText(
        message.chatId,
        `出错了：${error instanceof Error ? error.message : String(error)}`,
        raw.messageId
      ).catch(() => void 0);
      return false;
    }
  }
  let connected = false;
  const handleCommand = async (command, sessionKey, chatId, args, requester) => {
    const config = read();
    switch (command) {
      case "help":
        return formatHelp();
      case "status": {
        const info = bridge.describe(sessionKey);
        const override = bridge.modelOverride(sessionKey);
        return formatStatus({
          connected,
          sessionKey,
          sessionId: info.sessionId,
          model: override ? `${override.provider}/${override.model}（/model 覆盖）` : info.model ?? config.model,
          dmPolicy: config.dmPolicy,
          allowlist: config.allowlist,
          groupPolicy: config.groupPolicy,
          groupAllowlist: config.groupAllowlist,
          requireMentionInGroups: config.requireMentionInGroups,
          replyMode: config.replyMode,
          sessions: store.size
        });
      }
      case "model": {
        const requested = args[0];
        const info = bridge.describe(sessionKey);
        const override = bridge.modelOverride(sessionKey);
        if (!requested) {
          if (override) return formatModel(override);
          if (info.model) {
            const live = read();
            return formatModel({ provider: live.provider || "（宿主默认）", model: info.model });
          }
          return formatModel(void 0);
        }
        const slash = requested.indexOf("/");
        if (slash <= 0 || slash === requested.length - 1) {
          return formatModel(void 0, requested);
        }
        const selection = {
          provider: requested.slice(0, slash),
          model: requested.slice(slash + 1)
        };
        void bridge.setModel(sessionKey, selection).catch((error) => {
          ctx.logger.warn(`feishu-card: /model switch failed: ${error}`);
          void sender.sendText(chatId, `模型切换失败：${error}`).catch(() => void 0);
        });
        return formatModel(void 0, requested);
      }
      case "new": {
        const denied = stopDenied(bridge.turnOwner(sessionKey), requester);
        if (denied) return denied;
        return formatReset(await bridge.reset(sessionKey));
      }
      case "stop": {
        const running = bridge.describe(sessionKey).running;
        const denied = stopDenied(bridge.turnOwner(sessionKey), requester);
        if (denied) return denied;
        return formatStop(await bridge.stop(sessionKey) || running);
      }
    }
  };
  return {
    async start() {
      await store.load();
      await dedup.load();
      await recent.load();
      await gateway.start();
      connected = true;
      const config = read();
      ctx.logger.info(
        `feishu-card: bridge armed (dm=${config.dmPolicy}/${config.allowlist.length} ids, group=${config.groupPolicy}/${config.groupAllowlist.length} chats)`
      );
    },
    async stop() {
      connected = false;
      ask.dispose();
      await recent.flush();
      await gateway.stop();
      await bridge.dispose();
    },
    /** Drive one raw Feishu message through the whole pipeline (tests, other channels). */
    inbound,
    recent: () => recent.list(),
    recentChats: () => recent.chats(),
    status: () => ({
      connected,
      sessions: store.size,
      allowlist: read().allowlist.length,
      groupAllowlist: read().groupAllowlist.length
    })
  };
}

// src/host/route.ts
var MODELS_PATH = "/api/feishu-card/models";
var RECENT_PATH = "/api/feishu-card/recent";
var AUTH_PATH = "/api/feishu-card/auth";
var SEARCH_PATH = "/api/feishu-card/search";
var NAMES_PATH = "/api/feishu-card/names";
var CHAT_SEARCH_PATH = "/api/feishu-card/chat-search";
var JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
function reply(res, status, payload) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}
async function handlePanelRequest(req, res, deps) {
  let url;
  try {
    url = new URL(req.url ?? "/", "http://feishu-card.local");
  } catch {
    reply(res, 400, { ok: false, error: "请求地址无法解析" });
    return;
  }
  const isPost = req.method === "POST";
  if (req.method && req.method !== "GET" && req.method !== "HEAD" && !isPost) {
    reply(res, 405, { ok: false, error: "只支持 GET" });
    return;
  }
  if (url.pathname === AUTH_PATH) {
    const action = url.searchParams.get("action") ?? "state";
    try {
      if (action === "begin") {
        reply(res, 200, { ok: true, ...await deps.directory.begin() });
        return;
      }
      if (action === "poll") {
        reply(res, 200, { ok: true, ...await deps.directory.poll() });
        return;
      }
      if (action === "forget") {
        await deps.directory.forget();
        reply(res, 200, { ok: true, authorized: false });
        return;
      }
      reply(res, 200, { ok: true, ...deps.directory.state() });
    } catch (cause) {
      reply(res, 200, { ok: false, authorized: false, error: String(cause) });
    }
    return;
  }
  if (url.pathname === SEARCH_PATH) {
    const query = (url.searchParams.get("q") ?? "").slice(0, 64);
    try {
      const found = await deps.directory.search(query);
      reply(res, 200, {
        ok: true,
        people: found.people,
        ...found.error ? { error: found.error } : {}
      });
    } catch (cause) {
      reply(res, 200, { ok: false, people: [], error: String(cause) });
    }
    return;
  }
  if (url.pathname === NAMES_PATH) {
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 60);
    const userIds = ids.filter((id) => id.startsWith("ou_"));
    const chatIds = ids.filter((id) => id.startsWith("oc_"));
    try {
      const [users, chats] = await Promise.all([
        deps.names.users(userIds),
        deps.names.chats(chatIds)
      ]);
      reply(res, 200, {
        ok: true,
        users: users.names,
        chats,
        ...users.error ? { error: users.error } : {}
      });
    } catch (cause) {
      reply(res, 200, { ok: false, users: {}, chats: {}, error: String(cause) });
    }
    return;
  }
  if (url.pathname === CHAT_SEARCH_PATH) {
    const query = (url.searchParams.get("q") ?? "").slice(0, 64);
    try {
      const found = await deps.names.chatSearch(query);
      reply(res, 200, {
        ok: true,
        chats: found.chats,
        ...found.error ? { error: found.error } : {}
      });
    } catch (cause) {
      reply(res, 200, { ok: false, chats: [], error: String(cause) });
    }
    return;
  }
  if (url.pathname === RECENT_PATH) {
    try {
      const seen = deps.recent();
      reply(res, 200, { ok: true, people: seen.people, chats: seen.chats });
    } catch (cause) {
      reply(res, 200, { ok: false, people: [], chats: [], error: String(cause) });
    }
    return;
  }
  if (url.pathname !== MODELS_PATH) {
    reply(res, 404, { ok: false, error: "未知接口" });
    return;
  }
  if (isPost) {
    reply(res, 405, { ok: false, error: "该接口只支持 GET" });
    return;
  }
  try {
    const catalog = await deps.listModels();
    reply(res, 200, {
      ok: true,
      choices: catalog.choices,
      ...catalog.fallback ? { fallback: catalog.fallback } : {},
      ...catalog.error ? { error: catalog.error } : {}
    });
  } catch (cause) {
    reply(res, 200, { ok: false, choices: [], error: String(cause) });
  }
}
function registerPanelRoutes(ctx, deps, log) {
  try {
    ctx.inject(["webServer"], (child) => {
      child.effect(() => {
        const server = child.webServer;
        if (!server) {
          log?.("feishu-card: webServer service absent — 面板的模型下拉框/快捷选取不可用");
          return () => {
          };
        }
        const handler = (req, res) => void handlePanelRequest(req, res, deps);
        let offs = [];
        try {
          offs = [
            server.register({ kind: "exact", path: MODELS_PATH, handler }),
            server.register({ kind: "exact", path: RECENT_PATH, handler }),
            server.register({ kind: "exact", path: AUTH_PATH, handler }),
            server.register({ kind: "exact", path: SEARCH_PATH, handler }),
            server.register({ kind: "exact", path: NAMES_PATH, handler }),
            server.register({ kind: "exact", path: CHAT_SEARCH_PATH, handler })
          ];
          log?.(
            `feishu-card: 面板路由已挂载 (${MODELS_PATH}, ${RECENT_PATH}, ${AUTH_PATH}, ${SEARCH_PATH}, ${NAMES_PATH}, ${CHAT_SEARCH_PATH})`
          );
        } catch (error) {
          log?.(`feishu-card: route registration failed: ${String(error)}`);
          return () => {
          };
        }
        return () => {
          for (const off of offs) off();
        };
      }, "feishu-card: panel routes");
    });
  } catch (error) {
    log?.(`feishu-card: webServer unavailable (${String(error)}) — 面板快捷选取不可用`);
  }
}

// src/host/models.ts
async function readModelCatalog(ctx) {
  const fallback = readFallback(ctx);
  const fromSettings = harvestFromSettings(ctx);
  const choices = [...fromSettings];
  const seen = new Set(choices.map((choice) => encodeModelRoute(choice.provider, choice.model)));
  const llm = ctx.get("llm") ?? void 0;
  if (llm) {
    try {
      for (const provider of llm.listProviders()) {
        let models = [];
        try {
          models = await llm.listModels(provider.provider);
        } catch {
          continue;
        }
        for (const model of models) {
          const key = encodeModelRoute(provider.provider, model.id);
          if (seen.has(key)) continue;
          seen.add(key);
          choices.push({
            provider: provider.provider,
            model: model.id,
            label: model.name?.trim() || model.id,
            ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow }
          });
        }
      }
    } catch (error) {
      if (choices.length === 0) {
        return { choices, error: `读取模型列表失败：${String(error).slice(0, 160)}` };
      }
    }
  }
  if (choices.length === 0) {
    return {
      choices,
      fallback,
      error: llm ? "没有可选的模型（provider 可能还没配好密钥），请手动填写模型 id。" : "当前环境没有模型服务，只能手动填写模型 id。"
    };
  }
  return { choices, fallback };
}
function harvestFromSettings(ctx) {
  const settings = ctx.get("settings");
  if (!settings) return [];
  const out = [];
  let descriptors = [];
  try {
    descriptors = settings.describe();
  } catch {
    return [];
  }
  for (const descriptor of descriptors) {
    const value = descriptor.value;
    const providers = value?.providers;
    if (!providers || typeof providers !== "object") continue;
    for (const [provider, profile] of Object.entries(providers)) {
      const models = profile?.models;
      if (!Array.isArray(models)) continue;
      for (const model of models) {
        if (typeof model !== "object" || model === null) continue;
        const row = model;
        if (typeof row.id !== "string" || !row.id) continue;
        out.push({
          provider,
          model: row.id,
          label: typeof row.name === "string" && row.name ? row.name : row.id,
          ...typeof row.contextWindow === "number" ? { contextWindow: row.contextWindow } : {}
        });
      }
    }
  }
  return out;
}
function readFallback(ctx) {
  const service = ctx.get("agentDefaultModel");
  const selection = service?.currentSelection?.();
  if (!selection?.provider || !selection.model) return void 0;
  return { provider: selection.provider, model: selection.model };
}
function encodeModelRoute(provider, model) {
  return `${provider}\0${model}`;
}

// src/host/directory.ts
import { mkdir as mkdir5, readFile as readFile4, rm, writeFile as writeFile5 } from "node:fs/promises";
import path5 from "node:path";

// src/host/device-flow.ts
function oauthEndpoints(brand2) {
  return brand2 === "lark" ? {
    deviceAuthorization: "https://accounts.larksuite.com/oauth/v1/device_authorization",
    token: "https://open.larksuite.com/open-apis/authen/v2/oauth/token"
  } : {
    deviceAuthorization: "https://accounts.feishu.cn/oauth/v1/device_authorization",
    token: "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
  };
}
var PENDING = 20094;
var PENDING_ERROR = "authorization_pending";
var SLOW_DOWN = "slow_down";
async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回无法解析（HTTP ${response.status}）：${text.slice(0, 160)}`);
  }
}
async function requestDeviceAuthorization(options) {
  const doFetch = options.fetch ?? fetch;
  const endpoints = oauthEndpoints(options.brand);
  const response = await doFetch(endpoints.deviceAuthorization, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: options.appId,
      client_secret: options.appSecret,
      scope: options.scope
    }).toString()
  });
  const body = await readJson(response);
  if (!body.device_code || !body.user_code) {
    throw new Error(
      `申请授权码失败：${body.error_description ?? body.msg ?? body.error ?? `HTTP ${response.status}`}`
    );
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri ?? body.verification_url ?? "",
    verificationUriComplete: body.verification_uri_complete ?? body.verification_url ?? "",
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 600,
    interval: typeof body.interval === "number" ? body.interval : 5
  };
}
async function pollDeviceToken(options, deviceCode) {
  const doFetch = options.fetch ?? fetch;
  const endpoints = oauthEndpoints(options.brand);
  const response = await doFetch(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: options.appId,
      client_secret: options.appSecret,
      device_code: deviceCode
    }).toString()
  });
  const body = await readJson(response);
  if (body.error === PENDING_ERROR || body.code === PENDING) return void 0;
  if (body.error === SLOW_DOWN) return void 0;
  if (!body.access_token) {
    throw new Error(
      `换取用户凭证失败：${body.error_description ?? body.msg ?? body.error ?? `HTTP ${response.status}`}`
    );
  }
  return {
    accessToken: body.access_token,
    ...body.refresh_token ? { refreshToken: body.refresh_token } : {},
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 7200,
    ...body.scope ? { scope: String(body.scope) } : {}
  };
}
async function refreshUserToken(options, refreshToken) {
  const doFetch = options.fetch ?? fetch;
  const endpoints = oauthEndpoints(options.brand);
  const response = await doFetch(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: options.appId,
      client_secret: options.appSecret,
      refresh_token: refreshToken
    }).toString()
  });
  const body = await readJson(response);
  if (!body.access_token) {
    throw new Error(
      `刷新用户凭证失败：${body.error_description ?? body.msg ?? body.error ?? `HTTP ${response.status}`}`
    );
  }
  return {
    accessToken: body.access_token,
    ...body.refresh_token ? { refreshToken: body.refresh_token } : {},
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 7200,
    ...body.scope ? { scope: String(body.scope) } : {}
  };
}
var DIRECTORY_SCOPES = "contact:user:search contact:user.base:readonly offline_access";

// src/host/directory.ts
var DirectorySearch = class {
  constructor(options) {
    this.options = options;
  }
  token;
  pending;
  polling;
  loaded = false;
  /**
   * Set when a refresh was actually attempted and failed.
   *
   * A dead refresh token is not the same as a network blip: without this flag
   * the panel kept claiming "authorized" for days while every search returned a
   * token error (live report 2026-11-10: 搜索报错，断开重连授权才行).
   */
  refreshFailed = false;
  /** Load a previously stored token; a missing file is not an error. */
  async load() {
    try {
      const raw = await readFile4(this.options.file, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed.accessToken === "string" && parsed.accessToken) {
        this.token = {
          accessToken: parsed.accessToken,
          ...typeof parsed.refreshToken === "string" ? { refreshToken: parsed.refreshToken } : {},
          expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
          ...typeof parsed.scope === "string" ? { scope: parsed.scope } : {},
          ...typeof parsed.userName === "string" ? { userName: parsed.userName } : {}
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.options.log?.(`feishu-card: delegated token unreadable (${String(error)})`);
      }
    }
    this.loaded = true;
  }
  /** Current state, without touching the network. */
  state() {
    const now = (this.options.now ?? Date.now)();
    const pending = this.pending;
    const expiresAt = pending ? pending.startedAt + pending.auth.expiresIn * 1e3 : 0;
    const token = this.token;
    const expired = token !== void 0 && token.expiresAt <= now;
    const dead = token !== void 0 && expired && (this.refreshFailed || !token.refreshToken);
    return {
      authorized: token !== void 0 && !dead,
      ...dead ? { needAuth: true } : {},
      ...token?.userName ? { userName: token.userName } : {},
      ...pending && expiresAt > now ? {
        pending: {
          userCode: pending.auth.userCode,
          verificationUri: pending.auth.verificationUri,
          verificationUriComplete: pending.auth.verificationUriComplete,
          expiresAt
        }
      } : {}
    };
  }
  /**
   * Begin an authorisation. Returns the code and link for the panel to show;
   * `complete()` then polls until the person confirms.
   */
  async begin() {
    const config = this.options.read();
    if (!config.appId || !config.appSecret) {
      return { authorized: false, error: "请先填写并保存 App ID 和 App Secret。" };
    }
    try {
      const auth = await requestDeviceAuthorization({
        appId: config.appId,
        appSecret: config.appSecret,
        brand: config.brand,
        scope: DIRECTORY_SCOPES,
        ...this.options.fetch ? { fetch: this.options.fetch } : {}
      });
      this.pending = { auth, startedAt: (this.options.now ?? Date.now)() };
      return this.state();
    } catch (error) {
      return { authorized: false, error: `申请授权失败：${String(error).slice(0, 200)}` };
    }
  }
  /**
   * Poll once. Called by the panel every few seconds while it shows the code.
   *
   * Concurrent calls share one request: the panel may re-render faster than the
   * network answers, and Feishu rate-limits polling.
   */
  async poll() {
    if (!this.pending) return this.state();
    if (this.polling) return this.polling;
    const config = this.options.read();
    const pending = this.pending;
    const run = (async () => {
      try {
        const token = await pollDeviceToken(
          {
            appId: config.appId,
            appSecret: config.appSecret,
            brand: config.brand,
            scope: DIRECTORY_SCOPES,
            ...this.options.fetch ? { fetch: this.options.fetch } : {}
          },
          pending.auth.deviceCode
        );
        if (!token) {
          const expired = pending.startedAt + pending.auth.expiresIn * 1e3 <= (this.options.now ?? Date.now)();
          if (expired) this.pending = void 0;
          return this.state();
        }
        await this.store(token);
        this.pending = void 0;
        return this.state();
      } catch (error) {
        this.pending = void 0;
        return { authorized: this.token !== void 0, error: String(error).slice(0, 200) };
      } finally {
        this.polling = void 0;
      }
    })();
    this.polling = run;
    return run;
  }
  /** Forget the delegation (the panel's "断开" button). */
  async forget() {
    this.token = void 0;
    this.pending = void 0;
    this.refreshFailed = false;
    try {
      await rm(this.options.file, { force: true });
    } catch {
    }
  }
  /** Search people by name, e-mail or open_id. Needs a live delegated token. */
  async search(query) {
    const text = query.trim();
    if (!text) return { people: [] };
    const accessToken = await this.usableToken();
    if (!accessToken) {
      return {
        people: [],
        error: this.state().needAuth ? "授权已过期，点「重新授权」后再搜索。" : "还没有授权，先点「用我的身份搜索」完成一次授权。"
      };
    }
    const config = this.options.read();
    const endpoints = oauthEndpoints(config.brand);
    const base = endpoints.token.replace("/open-apis/authen/v2/oauth/token", "");
    const url = `${base}/open-apis/search/v1/user?query=${encodeURIComponent(text)}&page_size=20`;
    const doFetch = this.options.fetch ?? fetch;
    try {
      const response = await doFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const body = await response.json();
      if (body.code !== void 0 && body.code !== 0) {
        return { people: [], error: `搜索失败：${body.msg ?? "未知错误"}（code ${body.code}）` };
      }
      const people = [];
      for (const row of body.data?.users ?? []) {
        if (!row.open_id) continue;
        const name = row.name?.trim();
        people.push({
          openId: row.open_id,
          name: name || row.open_id,
          ...row.department_ids ? { departmentIds: row.department_ids } : {}
        });
      }
      if (this.options.names) {
        const found = {};
        for (const person of people) {
          if (person.name && person.name !== person.openId) found[person.openId] = person.name;
        }
        if (Object.keys(found).length > 0) this.options.names.rememberUsers(found);
      }
      return { people };
    } catch (error) {
      return { people: [], error: `搜索失败：${String(error).slice(0, 160)}` };
    }
  }
  /**
   * Resolve open_ids to names, so a chip can read `ou_0000… (张三)`.
   *
   * Runs on the delegated token for the same reason search does: with the
   * tenant token this app can only see one person, so every other id would come
   * back `41050 no authority`. It doubles as an id check — a real id resolves,
   * a made-up one does not.
   *
   * Results are cached per id (names rarely change, and the panel asks on every
   * refresh), and unknown ids are simply absent from the map.
   */
  async names(ids) {
    const book = this.options.names;
    const unique = [...new Set(ids.filter(Boolean))];
    const known = book ? book.usersOf(unique) : {};
    const wanted = unique.filter((id) => !known[id]).slice(0, 30);
    if (wanted.length === 0) return { names: known };
    const accessToken = await this.usableToken();
    if (!accessToken) {
      return {
        names: known,
        error: this.state().needAuth ? "授权已过期，点「重新授权」后再显示新增的人名（已缓存的名字不受影响）。" : "还没有授权，先完成一次授权才能显示人名。"
      };
    }
    const config = this.options.read();
    const base = oauthEndpoints(config.brand).token.replace("/open-apis/authen/v2/oauth/token", "");
    const doFetch = this.options.fetch ?? fetch;
    const entries = await Promise.all(
      wanted.map(async (id) => {
        try {
          const response = await doFetch(
            `${base}/open-apis/contact/v3/users/${encodeURIComponent(id)}?user_id_type=open_id`,
            { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const body = await response.json();
          const name = body.data?.user?.name?.trim();
          return body.code === 0 && name ? [id, name] : void 0;
        } catch {
          return void 0;
        }
      })
    );
    const resolved = {};
    for (const entry of entries) if (entry) resolved[entry[0]] = entry[1];
    book?.rememberUsers(resolved);
    return { names: { ...known, ...resolved } };
  }
  /** A token that will work right now, refreshing it if it is about to expire. */
  async usableToken() {
    if (!this.loaded) await this.load();
    const token = this.token;
    if (!token) return void 0;
    const now = (this.options.now ?? Date.now)();
    if (token.expiresAt - 6e4 > now) return token.accessToken;
    if (!token.refreshToken) {
      this.refreshFailed = true;
      return void 0;
    }
    const config = this.options.read();
    try {
      const next = await refreshUserToken(
        {
          appId: config.appId,
          appSecret: config.appSecret,
          brand: config.brand,
          scope: DIRECTORY_SCOPES,
          ...this.options.fetch ? { fetch: this.options.fetch } : {}
        },
        token.refreshToken
      );
      this.refreshFailed = false;
      await this.store(next, token.userName);
      return next.accessToken;
    } catch (error) {
      this.refreshFailed = true;
      this.options.log?.(`feishu-card: token refresh failed (${String(error)})`);
      return void 0;
    }
  }
  async store(token, userName) {
    this.refreshFailed = false;
    this.token = {
      accessToken: token.accessToken,
      ...token.refreshToken ? { refreshToken: token.refreshToken } : {},
      expiresAt: (this.options.now ?? Date.now)() + token.expiresIn * 1e3,
      ...token.scope ? { scope: token.scope } : {},
      ...userName ? { userName } : {}
    };
    try {
      await mkdir5(path5.dirname(this.options.file), { recursive: true });
      await writeFile5(this.options.file, JSON.stringify(this.token), { encoding: "utf8", mode: 384 });
    } catch (error) {
      this.options.log?.(`feishu-card: delegated token save failed (${String(error)})`);
    }
  }
};

// src/host/names.ts
import { mkdir as mkdir6, readFile as readFile5, rename as rename3, unlink as unlink2, writeFile as writeFile6 } from "node:fs/promises";
import path6 from "node:path";
import * as Lark9 from "@larksuiteoapi/node-sdk";
var NameBook = class {
  constructor(options) {
    this.options = options;
  }
  users = /* @__PURE__ */ new Map();
  chats = /* @__PURE__ */ new Map();
  loaded = false;
  dirty = false;
  timer;
  writing = Promise.resolve();
  tmpSeq = 0;
  /** Read the cache. A missing or corrupt file is simply an empty cache. */
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile5(this.options.file, "utf8"));
      for (const [id, name] of Object.entries(parsed.users ?? {})) {
        if (id && typeof name === "string" && name) this.users.set(id, name);
      }
      for (const [id, name] of Object.entries(parsed.chats ?? {})) {
        if (id && typeof name === "string" && name) this.chats.set(id, name);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.options.log?.(`feishu-card: name cache unreadable (${String(error)})`);
      }
    }
  }
  /** Cached name for any id, whichever kind it is. */
  lookup(id) {
    return this.users.get(id) ?? this.chats.get(id);
  }
  user(id) {
    return this.users.get(id);
  }
  chat(id) {
    return this.chats.get(id);
  }
  usersOf(ids) {
    return pick(this.users, ids);
  }
  chatsOf(ids) {
    return pick(this.chats, ids);
  }
  /** Everything cached, for diagnostics (`scripts/probe-names.ts`). */
  snapshot() {
    return {
      users: Object.fromEntries(this.users),
      chats: Object.fromEntries(this.chats)
    };
  }
  rememberUsers(names) {
    if (remember(this.users, names)) this.schedule();
  }
  rememberChats(names) {
    if (remember(this.chats, names)) this.schedule();
  }
  /** Persist on the next tick; unref'd so a card/panel never holds the process. */
  schedule() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.flush();
    }, this.options.flushDelayMs ?? 500);
    this.timer.unref?.();
  }
  /** Write now (shutdown, tests). */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const payload = JSON.stringify({
      version: 1,
      users: Object.fromEntries(this.users),
      chats: Object.fromEntries(this.chats)
    });
    const file2 = this.options.file;
    const tmp = `${file2}.${process.pid}.${this.tmpSeq += 1}.tmp`;
    this.writing = this.writing.then(async () => {
      await mkdir6(path6.dirname(file2), { recursive: true });
      await writeFile6(tmp, payload, "utf8");
      await rename3(tmp, file2);
    }).catch(async (error) => {
      await unlink2(tmp).catch(() => void 0);
      this.options.log?.(`feishu-card: name cache write failed (${String(error)})`);
    });
    return this.writing;
  }
};
function remember(target, names) {
  let changed = false;
  for (const [id, name] of Object.entries(names)) {
    if (!id || !name) continue;
    if (target.get(id) === name) continue;
    target.set(id, name);
    changed = true;
  }
  return changed;
}
function pick(source, ids) {
  const out = {};
  for (const id of ids) {
    const name = source.get(id);
    if (name) out[id] = name;
  }
  return out;
}
var ChatNames = class {
  constructor(options) {
    this.options = options;
  }
  reader;
  client() {
    const config = this.options.read();
    if (!config.appId || !config.appSecret) return void 0;
    const key = `${config.appId}:${config.brand}`;
    if (this.reader?.config !== key) {
      const create = this.options.createClient ?? ((input) => {
        const client = new Lark9.Client(input);
        return {
          get: async (chatId) => {
            const response = await client.im.v1.chat.get({
              path: { chat_id: chatId },
              params: { user_id_type: "open_id" }
            });
            return response;
          },
          list: async () => {
            const response = await client.im.v1.chat.list({
              params: { page_size: 100, user_id_type: "open_id" }
            });
            return response;
          },
          search: async (query) => {
            const response = await client.im.v1.chat.search({
              params: { query, page_size: 20, user_id_type: "open_id" }
            });
            return response;
          }
        };
      });
      this.reader = {
        config: key,
        client: create({
          appId: config.appId,
          appSecret: config.appSecret,
          domain: config.brand === "lark" ? Lark9.Domain.Lark : Lark9.Domain.Feishu
        })
      };
    }
    return this.reader.client;
  }
  /**
   * Resolve chat ids to names, skipping the ones already cached by the caller.
   *
   * `chats/{id}` is the precise call but it answers an error code for a chat the
   * bot left (or a p2p id it does not recognise), so a failed batch falls back to
   * ONE `chats.list` pass over everything the bot is in — the same names, one
   * request, and no `未知群` for a chat that is plainly visible in Feishu.
   *
   * Never throws: fewer names is fine, the panel has a neutral label for that.
   */
  async resolve(ids) {
    const wanted = [...new Set(ids.filter(Boolean))].slice(0, 30);
    if (wanted.length === 0) return {};
    const client = this.client();
    if (!client) return {};
    const out = {};
    const failed = [];
    await Promise.all(
      wanted.map(async (id) => {
        try {
          const response = await client.get(id);
          const name = response?.data?.name?.trim();
          if (response?.code === 0 && name) out[id] = name;
          else if (response?.code === 0 && response?.data?.chat_mode === "p2p") {
            out[id] = "单聊";
          } else {
            failed.push(id);
            this.options.log?.(
              `feishu-card: chat name ${id} via get failed (${response?.code} ${response?.msg ?? ""})`
            );
          }
        } catch (error) {
          failed.push(id);
          this.options.log?.(`feishu-card: chat name ${id} via get failed (${String(error).slice(0, 120)})`);
        }
      })
    );
    if (failed.length === 0 || !client.list) return out;
    try {
      const listed = await client.list();
      const rows = listed?.data?.items ?? [];
      for (const row of rows) {
        const id = row.chat_id;
        const name = row.name?.trim();
        if (id && name && failed.includes(id)) out[id] = name;
      }
      if (listed?.code !== void 0 && listed.code !== 0) {
        this.options.log?.(
          `feishu-card: chat list fallback failed (${listed.code} ${listed.msg ?? ""})`
        );
      }
    } catch (error) {
      this.options.log?.(`feishu-card: chat list fallback failed (${String(error).slice(0, 120)})`);
    }
    return out;
  }
  /**
   * Search the chats this bot can see by name.
   *
   * `im/v1/chats/search` is bot-identity, so it needs no delegated token: group
   * picking keeps working while a person's authorisation is expired.
   */
  async search(query) {
    const text = query.trim();
    const client = this.client();
    if (!client) return { chats: [], error: "还没配置 App ID/App Secret，无法搜索群。" };
    if (!text) {
      if (!client.list) return { chats: [] };
      try {
        const listed = await client.list();
        const chats = (listed?.data?.items ?? []).filter((row) => row.chat_id).map((row) => ({ chatId: row.chat_id, name: row.name?.trim() || "未命名群" }));
        this.rememberSearch(chats);
        return { chats };
      } catch (error) {
        return { chats: [], error: `读取群列表失败：${String(error).slice(0, 160)}` };
      }
    }
    if (!client.search) return { chats: [], error: "当前环境不支持群搜索。" };
    try {
      const response = await client.search(text);
      if (response?.code !== void 0 && response.code !== 0) {
        return { chats: [], error: `搜索群失败：${response.msg ?? "未知错误"}（code ${response.code}）` };
      }
      const chats = [];
      for (const row of response?.data?.items ?? []) {
        if (!row.chat_id) continue;
        chats.push({ chatId: row.chat_id, name: row.name?.trim() || "未命名群" });
      }
      this.rememberSearch(chats);
      return { chats };
    } catch (error) {
      return { chats: [], error: `搜索群失败：${String(error).slice(0, 160)}` };
    }
  }
  rememberSearch(chats) {
    if (!this.options.remember || chats.length === 0) return;
    const names = {};
    for (const chat of chats) names[chat.chatId] = chat.name;
    this.options.remember(names);
  }
};

// src/host/index.ts
function homeDir() {
  return process.env.DSH_HOME || path7.join(homedir3(), ".dsh");
}
var inject = ["settings", "agents", "sessionPersistence"];
function registerPagePolicy(ctx) {
  try {
    ctx.inject(["settings"], (child) => {
      child.effect(() => child.settings.configure({ auto: false }));
    });
  } catch (error) {
    ctx.logger.warn(`feishu-card: settings service unavailable (${error}) — edit the profile patch instead`);
  }
}
function logPosture(ctx, config) {
  const dm = config.dmPolicy === "disabled" ? "disabled" : config.dmPolicy === "open" ? "open" : `allowlist (${config.allowlist.length} open_id)`;
  const group = config.groupPolicy === "disabled" ? "disabled" : config.groupPolicy === "open" ? "open" : `allowlist (${config.groupAllowlist.length} chat_id)`;
  const dormant = !config.appId || !config.appSecret;
  ctx.logger.info(
    `feishu-card: ${dormant ? "dormant (appId/appSecret not configured)" : "armed"} — dm=${dm} group=${group} mention=${config.requireMentionInGroups} reply=${config.replyMode}`
  );
}
function evaluate(ctx, config, request) {
  const decision = decideAccess(request, config);
  if (!decision.allowed) {
    ctx.logger.debug(
      `feishu-card: denied chat=${request.chatId} sender=${request.senderOpenId} reason=${decision.reason} (${describeDeny(decision.reason)})`
    );
  }
  return decision;
}
async function apply(ctx, config) {
  ctx.logger.info(`feishu-card: entry ${PLUGIN_ID} loaded`);
  registerPagePolicy(ctx);
  const read = () => readConfig(config);
  const initial = read();
  logPosture(ctx, initial);
  const recent = new RecentContacts({
    file: path7.join(homeDir(), "feishu-card", "recent.json"),
    log: (message) => ctx.logger.debug(message)
  });
  ctx.effect(() => {
    void recent.load();
    return () => {
      void recent.flush();
    };
  }, "feishu-card: recent contacts");
  const nameBook = new NameBook({
    file: path7.join(homeDir(), "feishu-card", "names.json"),
    log: (message) => ctx.logger.debug(message)
  });
  const chatNames = new ChatNames({
    read: () => {
      const live = read();
      return { appId: live.appId, appSecret: live.appSecret, brand: live.brand };
    },
    // A group found by search is a group worth naming from now on.
    remember: (names) => nameBook.rememberChats(names),
    log: (message) => ctx.logger.debug(message)
  });
  ctx.effect(() => {
    void nameBook.load();
    return () => {
      void nameBook.flush();
    };
  }, "feishu-card: name cache");
  const directory = new DirectorySearch({
    read: () => {
      const live = read();
      return { appId: live.appId, appSecret: live.appSecret, brand: live.brand };
    },
    file: path7.join(homeDir(), "feishu-card", "user-token.json"),
    names: nameBook,
    log: (message) => ctx.logger.debug(message)
  });
  ctx.effect(() => {
    void directory.load();
    return () => {
    };
  }, "feishu-card: delegated token");
  const resolveChatNames = async (ids) => {
    const known = nameBook.chatsOf(ids);
    const missing = ids.filter((id) => !known[id]);
    if (missing.length === 0) return known;
    const resolved = await chatNames.resolve(missing);
    nameBook.rememberChats(resolved);
    return { ...known, ...resolved };
  };
  registerPanelRoutes(
    ctx,
    {
      listModels: () => readModelCatalog(ctx),
      recent: () => ({ people: recent.list(), chats: recent.chats() }),
      directory,
      names: {
        users: (ids) => directory.names(ids),
        chats: resolveChatNames,
        chatSearch: (query) => chatNames.search(query)
      }
    },
    (message) => ctx.logger.info(message)
  );
  if (!initial.appId || !initial.appSecret) {
    ctx.logger.warn(
      "feishu-card: appId/appSecret missing — fill them in the Plugins settings page (设置 → 插件 → dsh-feishu-card) to start the bridge"
    );
    return;
  }
  const runtime = createRuntime(ctx, read, initial, {
    recent,
    directory,
    names: nameBook
  });
  ctx.effect(async () => {
    await runtime.start();
    return () => {
      void runtime.stop().catch((error) => {
        ctx.logger.warn(`feishu-card: shutdown failed: ${error}`);
      });
    };
  });
}
export {
  config_default as Config,
  apply,
  evaluate,
  inject,
  readConfig
};
//# sourceMappingURL=index.js.map
