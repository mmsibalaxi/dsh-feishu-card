# dsh-feishu-card — 设计方案

> 自研 DeepSeek Harness（DSH）飞书桥接插件。本文件是唯一权威设计文档；实现偏离本文档时，先改文档再改代码。
> 配套：[README.md](README.md)（安装与能力总览）、[references/](references/)（已核实的契约与事实）、[docs/E2E-RUNBOOK.md](docs/E2E-RUNBOOK.md)（真飞书联调）。

## 1. 目标与非目标

### 目标（按优先级）
1. **R1 面板配置**：飞书 `app_id` / `app_secret` 在 DSH 面板里可填可改（桌面版：侧栏「插件」→ 本插件卡片）。
2. **R2 双白名单**：open_id（私聊回复白名单）+ 群 chat_id（群白名单）都可配，默认拒绝。
3. **R3 流式卡片**：飞书 CardKit v2.0 真流式（思考过程 + 工具状态 + 答案逐字），不是纯文本分段发。
4. **R4 底部常驻状态行**：`已完成 · ⚕<model> · 31.1K/1.0M (3%) · 12.3s`（status / model / 上下文占比 / 耗时），流式过程中持续刷新，封卡时定稿。
5. 会话隔离：每个群/话题/私聊映射到独立 DSH session，跨重启可恢复。

### 非目标（本期不做）
- 不做多平台（微信/钉钉/Slack…），只做飞书/Lark。
- 不做 Lark 国际版之外的域名适配以外的花活（`brand: feishu | lark` 一个开关就够）。
- 不做"扫码自动建应用"（二维码创建应用流程复杂且和面板填 app_id 重复；用户已有飞书应用可直接填）。
- 不发布 npm（本地路径安装）。

## 2. 运行形态与安装

- 插件是 **cordis bundle**：`package.json` 声明 `dsh.bundle.patch` + 兄弟键 `dsh.client`，`cordis.patch.yml` 以 `insert` 方式把本插件作为一层并入 profile（详见 `references/dsh-plugin-contract.md`）。
- Host 半侧跑在 dsh 进程内（桌面版即 Electron 主进程里的 dsh runtime），Client 半侧是浏览器端模块。
- **安装通道**：桌面版 GUI 侧栏「插件 → 添加插件」→ 输入本地绝对路径 `D:\workspace\dsh-feishu-card`。安装器会 `inspect`（读 package.json，要求必须有 bundle patch）→ `pnpm add` → 默认启用。装完**重启桌面应用**（bundle 层变化需重启）。
- **发布形态**：仓库内提交预构建 `lib/`，**不写 prepare/postinstall 脚本**（避免 pnpm 11 构建脚本审批，参考 dsh-bottom-stats 的做法）。
- **版本兼容**：不声明任何 DSH peerDependencies（peer 会被安装器拿来做版本闸，锁 0.1.x 会被拒）；改用 `engines.dsh` + `dsh.compatibility` 块声明兼容 0.2.x（dsh-im 同款写法）。DSH 的 `@deepseek-ai/*` 包只进 **devDependencies**（本机构建/类型检查用，不随插件发布），运行时由宿主提供。

## 3. 架构

```
飞书/Lark ──WS 长连接(@larksuiteoapi/node-sdk)──► ┌──────────────── Host 半侧（dsh 进程内）────────────────┐
                                                  │ gateway        连接、事件路由、去重、@提及剥离、并发串行化   │
                                                  │ access         双白名单门禁（DM open_id / 群 chat_id）      │
                                                  │ sessions       chat/thread/sender → DSH session 映射+持久化  │
                                                  │ bridge         agents.resume/create → followup → 流式事件订阅 │
                                                  │ card           CardKit 流式卡片控制器（移植 hermes）          │
                                                  │ footer         status/model/上下文%/耗时 组装与刷新          │
                                                  │ contextwin     模型→上下文窗口注册表（全生态缺的原语）       │
                                                  └────────────────────────────────────────────────────────────┘
                                                  ┌──────────────── Client 半侧（浏览器）──────────────────────┐
                                                  │ settings.plugin.item 卡片：appId/appSecret/白名单/footer 字段 │
                                                  └────────────────────────────────────────────────────────────┘
```

### 3.1 目录
```
dsh-feishu-card/
├── DESIGN.md / README.md
├── references/           已核实契约（DSH 插件契约 / CardKit 契约 / hermes footer 规格）
├── package.json          dsh.bundle.patch + dsh.client + engines.dsh + dsh.compatibility
├── cordis.patch.yml      insert 一行插件（带 schema 默认值 config 块，见 §6）
├── tsconfig.json
├── src/
│   ├── host/
│   │   ├── index.ts          插件入口：**只有命名导出，禁止 export default**（见 §6.1）
│   │   ├── config.ts         配置 schema（含默认值、归一化）
│   │   ├── gateway.ts        WS 长连接 + 事件分发 + 去重 + 提及剥离
│   │   ├── access.ts         双白名单门禁
│   │   ├── sessions.ts       会话映射与持久化（state.json）
│   │   ├── bridge.ts         agent 生命周期 + followup + 事件订阅
│   │   ├── card/
│   │   │   ├── builder.ts    卡片元素构建（answer/loading/panel/footer）
│   │   │   ├── streaming.ts  流式控制器（flush 节流、sequence、封卡 seal）
│   │   │   └── md.ts         markdown 安全化（转义/表格降级/超长截断）
│   │   ├── footer.ts         footer 字段渲染（status/elapsed/model/context/tokens）
│   │   ├── contextwin.ts     模型→上下文窗口注册表
│   │   └── state.ts          运行状态（Outbox 式：至少一次投递 + 崩溃补发）
│   ├── client/
│   │   └── index.tsx         settings.plugin.item 设置卡片（React）
│   └── shared/
│       ├── types.ts          配置类型（host/client 共用）
│       └── footer-fields.ts  footer 字段白名单与顺序
├── lib/                    预构建产物（提交进仓库）
└── scripts/build.mjs       构建（esbuild/tsc，见 §7）
```

## 4. 关键契约（实现前必读，均已核实）

| 契约 | 出处 |
|---|---|
| DSH bundle 清单格式、安装通道、设置页 slot id、0.2.x 运行时有哪些包、版本闸与豁免机制 | `references/dsh-plugin-contract.md` |
| CardKit v2.0：create/update/batch_update/settings 四件套、sequence、封卡顺序、错误码 | `references/cardkit-contract.md` |
| hermes footer 的字段、格式、用户既有偏好（不要 cost、正文不重复统计行） | `references/hermes-footer-spec.md` |

## 5. 模块设计要点

### 5.1 gateway
- `@larksuiteoapi/node-sdk` 的 `WSClient` + `EventDispatcher`，长连接（无需公网回调）。订阅 `im.message.receive_v1` + `card.action.trigger`。
- 去重：`event_id` + `message_id` 双集合，TTL 12h，落盘（重启后不重复处理）。
- 群消息：`requireMentionInGroups` 默认 true；剥离 `@_user_1` 前缀；`@all` 不响应。
- 并发：**每个 chat 串行**（一个 chat 同时只有一个 turn 在跑），新消息进队列；`/stop` 取消当前。

### 5.2 access（双门禁，照搬 hermes 的语义）
- DM：`dmPolicy: open | pairing | allowlist | disabled`；`allowlist` 非空时只放行名单内 open_id；`disabled` 一律不回。
- 群：`groupPolicy: open | allowlist | disabled`；`allowlist` 为 `oc_` chat_id 名单；未命中 → 静默忽略（不回复、不报错）。
- 顺序：先过 chat 维度（群白名单），再过 sender 维度（open_id 白名单）。两层都过才进 agent。
- 默认值：`dmPolicy: allowlist`、`groupPolicy: allowlist`、两个名单初始为空 = **谁也进不来**（fail-closed，用户填了才通）。

### 5.3 sessions
- key = `chat_id`（可切 `thread`：话题独立；`sender`：按人独立）。映射 `{ sessionId, workspace, updatedAt }` 落盘到 `<DSH_HOME>/feishu-card/sessions.json`。
- 启动时：`ctx.agents.resume(sessionId)`，失败则 `create` 后回写。
- 每个 session 绑定 workspace（默认配置里的 `defaultWorkspace`，面板可改）。

### 5.4 bridge（agent 事件 → 卡片）
- 新消息：`agent.followup(text)`；首条：`create` + `followup`。
- 订阅流式事件：reasoning delta → 思考面板；text delta → answer 流式元素；tool 事件 → 工具状态行；`turn/end` → 封卡。
- 附件：图片 → attachment 存储（视觉模型）；文件 → 落到 session workspace 的 `.feishu/inbox/<ts>-<hash>/`。
- 出站文件：只允许 workspace 内的常规文件，大小上限 20 MiB，路径只以"工作区内相对位置"呈现（防提示注入外泄）。

### 5.5 card（移植 hermes，见 `references/cardkit-contract.md`）
- 建卡：`schema 2.0` + `streaming_mode: true` + `streaming_config{print_frequency_ms, print_step, print_strategy}`，元素顺序：`answer_content`(流式) → loading hint → loading spinner → 统一过程面板（**放最底部**，沿用你的 fork 选择，让 answer 在上面流式）。
- 刷新：`cardkit.v1.card.aupdate`（整卡，带 sequence）或 `abatch_update`（局部动作，带 sequence）；sequence 单调递增；**batch 原子且非幂等** → 一组语义一个 batch，删除动作不分组。
- 节流：`flushIntervalMs` 默认 800ms；`print_strategy: delay` + `print_step` 默认 4（照 hermes）。
- 封卡（seal）顺序（hermes 的教训，必须遵守）：
  1. flush 残留脏数据 → 2. batch_update 把过程面板置终态 → 3. 加 footer（`insert_before(loading_icon)` 必须先于 `delete(loading_icon)`；失败退化为 append）→ 4. `asettings` 关流式并带 summary。
  4. 错误码：`300309/300313`（流式已关）→ 退化为 batch_update 写正文；`300301`（id 重复）= 已存在，视为满足；`300314`（删不存在的元素）= 满足；`300315`（insert_before 目标没了）→ 落 append 重试；`10002` → 显式带 `type`。

### 5.6 footer（R4）
- 字段：`status`（已完成/已停止/出错）、`elapsed`（本轮耗时，`_format_elapsed`）、`model`（`⚕<model>`）、`context`（`<used>/<window> (<pct>%)`）、可选 `tokens`（`↑in ↓out`）。
- 用户既有偏好（来自 hermes 插件文档，必须继承）：**footer 里不放 cost**；**正文绝不重复统计行**（正文只留内容）。
- `context` 的 `used`：优先 host 侧 token 计量（`@deepseek-ai/dsh-token-meter` / `dsh-session-stats`，M3 spike 确认读取方式），退化方案：从流式事件累计 usage。
- `window`：`contextwin.ts` 注册表（模型 id → 上下文窗口 token 数），内置常见模型 + 面板可覆盖（`contextWindows: Record<string, number>`）。**这是全生态缺失的原语，我们做一次，任何桥接都能用。**

### 5.7 state（可靠性，照 hermes 的零丢失思路简化版）
- 出站 Outbox：JSONL + 至少一次 + 幂等键；进程被杀后重启自动续投。
- 入站 WAL：agent 处理到一半崩溃/重启 → 重启后自动重放该条用户消息（次数/时间窗上限，可关）。

## 6. 配置与"单一事实来源"（重要决策，2026-10-19 依据官方文档修正）

**权威结论**（`@deepseek-ai/dsh-settings` README 原文语义）：
- 表单编辑的就是**插件自己 cordis Config 里 `.volatile()` 声明的字段**，按 profile 条目 id 定位；
- 改动经"按完整插件 Config 校验 + 修订号"后，**持久化进当前 profile 的 `cordis.patch.yml`**（作为该条目 id 的覆盖层）；
- 密钥字段标 `.role('secret')`：实际值/继承值对客户端隐藏，只回传"存在性"标记；reset 恢复到 schema 默认值；home patch / 命令行 overlay 优先级更高，会被覆盖的写入被拒绝；
- 自带页面的插件在 `apply` 里用 `ctx.inject(['settings'], ...)` 子级 + `configure({ auto: false }, ctx.fiber)` 声明策略；**业务插件直接读自己的 Config 引用**。

**因此我们的设计**：
- **唯一事实来源 = 插件的 cordis Config schema**（host 侧 `ctx.config` 直读，官方推荐路径）。
- `cordis.patch.yml` 的 `insert` 行**必须带 schema 默认值 config 块**：cordis 的 `resolveConfig()` 对 `undefined` 直接透传、不为缺省 row 应用默认值，所以没有 config 块时 `apply(ctx, config)` 收到的是 `undefined`（首启直接炸，已修 + 测试锁定）。用户的面板编辑由设置服务合并进同一个块，`.volatile()` 字段仍是活引用——**单一事实来源 = patch 里的这个 config 块**（harness-lark 同款做法）。

### §6.1 模块导出形状（硬规则，2026-10-19 用真实运行时应证）
1. **禁止 `export default`**（host 和 client 都不行）：loader 看到 default 导出就把模块当普通函数插件，`runtime.Config` 变 undefined → 条目从 `ctx.settings.describe()` 里消失 → **面板表单完全不出现，且没有任何报错**。
2. **`Config` 必须作为值再导出**（`export { Config, readConfig }`）：只 import 内部用会被 esbuild tree-shake，产物里消失 → 同样没有表单。
3. 防回归：`src/host/index.test.ts` 断言无 default + Config 是带 `~standard` 的值导出；`scripts/smoke.mjs` 对**构建产物**再断言一次。
- **面板**：自己的 client 卡片挂在「设置 → 插件」页（`settings.plugin.item` + `settingsScope`/form API，见 references §5），驱动设置服务对本条目的表单读写（`form.state` / `form.mutate(operations, expectedRevision)`）。
- Secret：`appSecret` 字段 `.role('secret')`，面板密码框留空=不覆盖；不落配置文件明文、不进卡片、不进日志。
- ⚠ **M1 spike #1（第一个要落实的技术点）**：确认第三方 client 如何拿到自己条目 id 的 form（state/mutate）——查 `@deepseek-ai/dsh-client-ui-settings` + `dsh-api-settings-controller` + `api-remotes` 的 RPC 面（都在 asar 里，可抽）。若第三方拿不到，退化方案：client 卡片走宿主提供的 `plugin_manager`/settings RPC，或退化为"面板只读展示 + 引导用户编辑 patch"（最后手段）。
- 配置项（全部面板可编辑）：

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `appId` | string | — | 飞书应用 App ID |
| `appSecretRef` | string | `FEISHU_APP_SECRET` | credentials 里的引用名 |
| `brand` | enum | `feishu` | feishu / lark |
| `dmPolicy` | enum | `allowlist` | open/pairing/allowlist/disabled |
| `allowlist` | string[] | `[]` | open_id 私聊白名单（一行一个） |
| `groupPolicy` | enum | `allowlist` | open/allowlist/disabled |
| `groupAllowlist` | string[] | `[]` | `oc_` 群白名单（一行一个） |
| `requireMentionInGroups` | bool | `true` | 群需 @ 才回 |
| `sessionScope` | enum | `chat` | chat/thread/sender |
| `replyMode` | enum | `streaming` | streaming/text |
| `footerFields` | string[] | `[status,model,context,elapsed]` | 顺序即展示顺序 |
| `flushIntervalMs` | number | `800` | 流式刷新节流 |
| `contextWindows` | map | `{}` | 模型 id → 窗口 token 数（覆盖内置表） |
| `defaultWorkspace` | string | — | 新 session 的默认工作目录 |

## 7. 构建与工程

- TypeScript ESM，`tsc` 出 `lib/`（host: `lib/host/index.js`，client: `lib/client/index.js`），**不打包**（依赖运行时从 profile node_modules 解析）。
- 单测：`vitest`，覆盖 access / footer 渲染 / md 安全化 / contextwin / 会话映射（全部无网络，可在无飞书应用状态下跑）。
- 类型检查依赖：`@deepseek-ai/*` 固定 `0.2.1-rc.2`（npm 已验证可装），`@larksuiteoapi/node-sdk ^1.64`，`typescript ^5.9`，`vitest`。
- 构建脚本 `scripts/build.mjs`：`tsc -p tsconfig.json`，并把 `src/client/index.tsx` 一起编（React 类型只用于类型检查，产物是 ESM JS）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 桌面版 profile 只能由 GUI 管理（CLI 明确拒绝 `desktop`） | 安装走 GUI 本地路径；配置改动走面板；都不需要 CLI |
| DSH 0.2.x 与插件 API 漂移 | devDeps 锁 0.2.1-rc.2 做类型检查；`dsh.compatibility` 声明；不用 peer 锁版本 |
| CardKit 流式细节踩坑（hermes 那套错误码全是生产教训） | 已把契约写进 `references/cardkit-contract.md`；M2 按 seal 顺序单测覆盖 |
| 上下文占比缺原语 | 自建 contextwin 注册表 + M3 spike 确认 host token 计量接口 |
| 同一个飞书应用被 hermes 占用 | **新建独立飞书应用**；配置里 appId 填新应用的 |
| 面板写不进/读不到（settings API 未核实） | M1 第一个 spike：从 asar 抽 `dsh-settings` 的 README/types 确认 host 读法；不通则退化为"面板写 cordis patch 的 config 行"（备选方案见 §6） |
| 上下文爆掉 | 每个里程碑结束在 issue / 提交说明里记录（改了什么、验证证据、下一步、未决问题）；新会话先读 DESIGN + README 即可续上 |

## 9. 验收标准（对应目标）

1. 桌面版 GUI 能装本插件并启用，重启后插件列表显示"运行中"。
2. 面板能填 appId/appSecret/两个白名单，保存后重启生效；未授权 open_id / 未授权群 100% 无响应。
3. 授权会话里发消息 → 出现流式卡片：思考过程 + 工具状态 + 答案逐字；`/stop` 能中断。
4. 卡片底部常驻 `已完成 · ⚕<model> · <used>/<window> (<pct>%) · <耗时>`，流式中持续刷新，封卡定稿；正文无重复统计行。
5. 杀进程重启后：未发出去的消息补发，会话映射保留。
