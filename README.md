# dsh-feishu-card

DeepSeek Harness（DSH）的飞书 / Lark 桥接插件。把飞书会话接到本机 DSH agent：面板配置、双白名单、CardKit 2.0 流式卡片、hermes 同款底部状态行、卡内停止按钮、图片与附件。

> 设计见 [DESIGN.md](DESIGN.md)，契约见 [references/](references/)，真飞书联调见 [docs/E2E-RUNBOOK.md](docs/E2E-RUNBOOK.md)。
> **动手改这个插件之前**先读 [references/panel-rules.md](references/panel-rules.md)（21 条踩过的坑，每条标注是哪一轮踩的）。

## 功能

| 能力 | 状态 |
|---|---|
| 面板配置 app_id / app_secret / 模型 / 白名单 / 策略 / footer 字段 / 超时 | ✅ 浏览器实测（读 + 写，改完即生效） |
| 私聊 open_id 白名单 + `oc_` 群白名单 + 可选「群内只响应某些人」 | ✅ |
| 飞书长连接（WebSocket，无需公网回调） | ✅ |
| 每会话独立 DSH session，跨重启恢复 | ✅ |
| CardKit 2.0 流式卡片（思考过程可选 / 工具面板 / 逐字答案） | ✅ |
| 底部状态行 `已完成　💠model　31.1K/1.0M (3%)　12.3s`（回合结束才出现） | ✅ 字段可配 |
| **卡内 ◯ 停止按钮**（右下角，红色空心圈）+ `/stop` | ✅ |
| **消息保护**：卡片被撤回 / 删除后停止写入 | ✅ |
| **思考过程渲染**（面板内 `🧠`，默认关闭） | ✅ 开关 |
| **工具调用面板**：状态点 + 名称 + 真实耗时 + 参数预览 + 失败原因 | ✅ |
| **元素上限保护**：工具步骤过多时折叠旧步骤，不撞飞书 200 元素上限 | ✅ |
| **出站图片**：`![](https://…)` 自动上传替换 `img_key` | ✅ |
| **入站多媒体**：图片 / 文件 / 语音 / 视频 落盘后交给 agent | ✅ |
| **富文本 post** 解析成纯文本 | ✅ |
| **去重持久化**（重启后不重跑重投事件） | ✅ |
| `/status` `/new` `/stop` `/model` `/help` | ✅ |
| 多卡片拆分（超过 200 元素续一张新卡） | ❌ 见下 |
| 中英双语卡片文案 | ❌ 中文为主 |

## 与 hermes-lark-streaming 的差异

对比基准：`hermes-lark-streaming`（卡片渲染） + `hermes-agent/plugins/platforms/feishu`（网关准入）。

**这个插件更强的地方**

- 图形化面板：凭据、白名单、策略、footer、超时全部面板可改且热生效；hermes 靠 `config.yaml`
- 人员 / 群组选择器：直接搜通讯录和机器人所在群，点选加白名单
- 每会话独立 DSH session，和 Harness 的 workspace / session 打通（可在 GUI 里打开历史）
- 模型下拉（从 `ctx.llm` + settings 双源采集，带 contextWindow）
- `ask_user_question` 落到飞书：卡片按钮 + 文本回复双通道，支持多问题逐个作答

**已知缺口（有意保留）**

| 缺口 | 说明 |
|---|---|
| 超长卡片不拆分 | 改为「折叠旧工具步骤」（保留最近 60 步）。真正的多卡续写要跨卡维护流式状态，收益不如折叠直接 |
| 无 cron / 后台任务主动推送 | 插件只做「收到消息 → 回复」；主动推送应由 Harness 侧定时任务负责 |
| 卡片样式定制少 | 没有 header 状态栏、正文字号、footer 分组/标签开关；只有 footer 字段开关 + 面板展开 |
| 文案中文硬编码 | 卡片静态文案是中文（i18n 未做） |
| 无 pairing 配对 | `dmPolicy=pairing` 面板不提供，行为等同全拒 |

## 安装

仓库里已经提交了预构建的 `lib/`，没有 `prepare` / `postinstall` 脚本，所以**无需自己构建**即可安装：

```bash
git clone https://github.com/mmsibalaxi/dsh-feishu-card.git
```

1. 桌面版侧栏 **插件 → 添加插件** → 输入上面 clone 下来的本地绝对路径
2. 安装后点**立即启用**，然后**重启 DeepSeek Harness**（bundle 层变化需要重启）
3. 侧栏 **插件 → dsh-feishu-card** 填 App ID / App Secret / 白名单，保存（配置走 volatile 活引用，改完即生效）
4. 飞书里私聊机器人，或在白名单群里 @它

想自己改代码再构建：`npm install && npm run build`（产物仍然落在 `lib/`）。

**飞书应用要求**（自建应用，**不要复用其它进程正在长连接的应用**——两个长连接会互相抢事件）：

- 事件订阅选**长连接**，订阅 `im.message.receive_v1`、`card.action.trigger`、`im.message.recalled_v1`
- 权限：`im:message`、`im:message:readonly`、`im:message:send_as_bot`、`im:resource`
- 群场景再加 `im:chat:read`；要显示人员姓名加通讯录可见范围
- 要流式卡片必须开通 **CardKit**；没开通时插件会退回纯文本回复（不会卡住不出答案）
- 改完权限要**创建并发布版本**才生效

## 配置项

面板里能改的（括号内是默认值）：

| 字段 | 说明 |
|---|---|
| `appId` / `appSecret` | 飞书应用凭据。`appSecret` 只写不回显，留空 = 不改已保存的 |
| `brand` | `feishu` / `lark` |
| `dmPolicy` | `allowlist`(默认) / `open` / `disabled`。`allowlist` 时 `allowlist` 为空 = 谁都不放行 |
| `allowlist` | 私聊 open_id 白名单。**只管私聊**，不影响群里谁可以说话 |
| `groupPolicy` / `groupAllowlist` | 群聊策略与 `oc_` 群白名单 |
| `groupSenderAllowlist` | 可选：白名单群里只响应这些人（空 = 群里所有人都可以） |
| `requireMentionInGroups` | 群里要 @机器人 才响应（默认开）。**@别人不会触发** |
| `respondToMentionAll` | @所有人 是否算提及（默认关） |
| `allowBots` | 其它机器人/应用的消息是否驱动 agent（`none` 默认 / `mentions` / `all`） |
| `sessionScope` | 会话粒度：`chat`(默认) / `thread` / `sender` |
| `replyMode` | `streaming`(默认) / `text`，改完下一条消息生效 |
| `footerFields` | 底部状态行显示哪些字段及其顺序 |
| `flushIntervalMs` | 流式刷新节流（200ms，和 hermes 一致；太小容易撞飞书频率限制） |
| `turnTimeoutMs` | 单回合超时（600000 = 10 分钟），超时会取消 agent 并封卡 |
| `showReasoning` / `panelExpanded` | 面板显示思考过程 / 回合结束后保持展开 |
| `provider` + `model` | 桥接 agent 用的模型；留空跟随宿主默认 |
| `defaultWorkspace` | 新会话的工作目录（留空则 GUI 里点不开历史） |
| `dedupTtlMs` | 去重窗口（12h） |

`/model provider/model` 是**会话级**覆盖，不会改宿主的全局默认模型。

## 凭据与发布安全

- 插件**从不把凭据写进仓库**：`appSecret` 走面板 → profile patch（`role('secret')`，不回显），live 探针脚本读 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 环境变量
- `npm run check-secrets` 会扫全仓库，命中真实 app_id / open_id / chat_id / 密钥字面量 / 本机路径就 exit 1；`prepublishOnly` 已经挂上
- 提交前自查：

```bash
npm run check-secrets
git grep -nE "cli_[a-z0-9]{16}|ou_[a-f0-9]{32}|oc_[a-f0-9]{32}"
```

- 如果密钥曾经进过 git 历史：**先去开发者后台重置 App Secret**，再考虑 `git filter-repo`。洗历史不能替代轮换

## 开发

```bash
npm install
npm run check     # tsc --noEmit
npm test          # vitest
npm run build     # esbuild → lib/{host,client} + tsc 产出 .d.ts
npm run smoke     # 构建产物可加载性 + 导出形状
```

`lib/` 提交进仓库（**不要加回 .gitignore**）：桌面插件安装器不跑 prepare/postinstall，git 安装必须自带产物。

**模块导出硬规则**（违反会让面板表单静默消失）：host/client 都**不能有 `export default`**，且 `Config` 必须作为值再导出（否则被 tree-shake）。`src/host/index.test.ts` 和 `scripts/smoke.mjs` 有防回归断言。

**client bundle 硬规则**（违反会在浏览器里直接崩）：经典脚本 CJS + `window.__ModuleLoader__.load({id, factory})` 外壳；**React 必须 external**；slot 用 `plugins.item` + `configForms.whileServed` 包裹。

## 卸载

侧栏 **插件 → dsh-feishu-card → 卸载**（会要求确认）。本地状态在 `~/.dsh/feishu-card/`（`sessions.json` / `seen.json` / `media/` / `trace.log`），卸载不删除。

## 0.2.0 行为变更（从 0.1.0 升级）

- **私聊白名单不再约束群内发言人**：以前填了私聊名单，白名单群里所有同事都会被静默拒绝。现在群聊只看 `groupAllowlist`（+ 可选的 `groupSenderAllowlist`）
- **`dmPolicy=open` 就是任何人**：以前残留的名单会在 open 下继续拦截，而面板把这个字段藏起来了，用户看不到原因
- **`delivered` 语义收紧**：只有「答案真的写进了卡片」才算送达；卡片写失败会退回文本回复，不再出现「一张空卡片 + 没有回答」
- **超时会取消 agent**：以前只封卡，回合还在后台跑，且同一会话会并发两个回合
- **`/model` 改为会话级**，不再改宿主全局默认模型

## License

MIT

