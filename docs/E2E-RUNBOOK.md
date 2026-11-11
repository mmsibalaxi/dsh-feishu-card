# E2E 联调执行手册（Runbook）

> 代码侧已全部完成并通过 194 个测试 + 真实环境验证（面板读写、卡片形状、安装加载、三轮真机联调）。
> **联调中发现的三个问题（提问弹窗只在 GUI / 卡片无正文 / footer 0/200K）已修**。踩坑规则见 [references/panel-rules.md](../references/panel-rules.md)。
> 设计见 [DESIGN.md](DESIGN.md)。

---

## 0. 前置：新建一个飞书应用（不要复用现有应用）

**为什么不能复用**：`cli_yyyyyyyyyyyyyyyy`（知识库里的"OpenCode 机器人"）正被 Hermes 长连接占用。同一个应用的多个长连接会互相抢事件，消息可能随机落到一边。

1. 打开 [飞书开放平台](https://open.feishu.cn/) → 创建企业自建应用
2. **事件订阅**：选「使用长连接接收事件」，添加事件 `im.message.receive_v1`；**提问卡按钮**还要加卡片回调 `card.action.trigger`（不加也能用——用户可以**直接回复消息**回答，保底路径）
3. **权限**（改完要「创建并发布版本」才生效）：
   - `im:message`、`im:message:readonly`、`im:message:send_as_bot`、`im:resource`
   - 群场景再加 `im:chat:read`
   - 表情回执：`im:message.reactions:read` / `im:message.reactions:write_only`
4. 记下 **App ID**（`cli_` 开头）和 **App Secret**

## 1. 一分钟连通性检查（先做这个，失败了后面不用跑）

```bash
cd <workspace>\dsh-feishu-card
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy npm run e2e
```

预期 4 项全 PASS。常见失败对照：

| 现象 | 原因 |
|---|---|
| `code 10003 invalid param` | App ID/Secret 打错，或用了 ISV 应用 |
| `invalid appId` | App ID 格式错（不是 `cli_` 开头） |
| token 通了但建卡失败 | 应用没发布版本 / 缺 `im:message` 权限 |
| WS 报 `app ticket` 相关 | 应用未启用机器人能力 |

## 2. 装进桌面版 GUI

1. `cd <workspace>\dsh-feishu-card && npm run build`
2. 桌面版侧栏 **插件 → 添加插件 → 输入本地绝对路径** `<workspace>\dsh-feishu-card`
3. 安装完成后点 **立即启用** → **重启 DeepSeek Harness**（bundle 层变化必须重启）
4. 侧栏 **插件** 里应看到 `dsh-feishu-card`，开关为开

## 3. 面板配置（侧栏 插件 → 内置插件配置 → 飞书）

| 字段 | 填什么 |
|---|---|
| App ID | 第 0 步的 `cli_xxx` |
| App Secret | 对应的 secret（**留空 = 不覆盖已保存的**） |
| 私聊策略 | `allowlist` |
| open_id 白名单 | `ou_0000000000000000000000000000000b`<br>`ou_0000000000000000000000000000000c` |
| 群聊策略 | `allowlist` |
| 群 chat_id 白名单 | `oc_0000000000000000000000000000000c`<br>`oc_0000000000000000000000000000000d`<br>`oc_0000000000000000000000000000000e` |
| 回复模式 | `streaming`（流式卡片） |
| 模型 | 留空 = 跟随宿主默认 |
| **默认工作目录** | **填一个已注册的工作区**（默认 `<workspace>\dsh-feishu`，标题「飞书」）。留空的话桥接会话会落进 `_no-cwd`、不属于任何工作区，GUI 里点开会话历史会报 `session/not-found`，侧栏里也只能看到一个没有标题的「未命名」分组 |

保存即生效（配置走 volatile 活引用，**不用重启**）。

> 若启动时用了 `--patch <file>` 覆盖凭据，面板会变只读——那是正确行为（overlay 优先级更高），别当 bug。

## 4. 验收清单

- [ ] **私聊**：白名单内的人发消息 → 出现流式卡片（思考过程 → 工具状态 → 逐字答案），底部有 `已完成 · ⚕<模型> · <已用>/<窗口> (N%) · <耗时>`
- [ ] **白名单外的人**私聊 → **零响应**（不回复、不报错）
- [ ] **白名单群**里 `@机器人` → 正常响应；不 @ → 无响应
- [ ] **非白名单群** → 无响应
- [ ] **提问卡片**：发一句「不知道选哪个你就问我」→ 飞书收到带按钮的提问卡（**不是** Harness 弹窗）→ 点按钮或直接回复消息 → 回合继续
- [ ] `/status` → 回复连接/会话/模型/白名单状态，且不消耗 agent
- [ ] `/model` → 显示当前模型；`/model magpie/auto-step-5-preview` → 切换并持久化
- [ ] `/stop` → 能中断正在跑的任务
- [ ] **重启 DSH** → 同一会话上下文还在（session 映射已持久化）
- [ ] 正文里**没有**重复的统计行（统计只在底部 footer）
- [ ] 底部占比**不是** `0/200K`：没有真实占用时该字段整个不显示，有占用时用投影/本轮 usage 的真实数字

## 5. 出问题时先看哪

| 症状 | 第一排查点 |
|---|---|
| **卡片能出来但永远不更新**（footer 不动、答案不出现、loading 不消失、一直是「思考中」） | `batchUpdate` 的 action 形状错了。`actions` 只是个 JSON 字符串，字段名不认就**静默丢弃**但返回 `code=0`。正确形状是 `{action, params:{element_id, partial_element}}`，且 `partial_element` 只放元素**内部字段**。有 `emits the real CardKit wire shape` 回归测试盯着 |
| 插件列表里没有「飞书」条目 | 客户端模块没加载 → 看 GUI console 有没有 `import failed`；确认跑过 `npm run build` |
| 有条目但点开是空的 | 设置服务没投影我们的条目 → 确认 host 侧没有 `export default`（有回归测试盯着） |
| 能收消息但不回 | ① `~/.dsh/feishu-card/trace.log` 看 `frame` / `status` / `turn-result`；② dsh 日志里 `feishu-card: turn failed …` |
| 卡片有 footer 没正文 | trace 里 `card-flush-failed` / `card-start-failed`；这类情况现在会自动补发一条文本回复 |
| 回一句「（本轮无输出）」 | trace 里有 `turn-blocked` → **会话被归档了**。`~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds` 里会有这个 session id；插件现在会自动开新会话并说明原因，也可以手工把它从归档列表里删掉 |
| **卡片只有前言、没有最终答案** | 不可能了——回合边界用耐久的 `turn/end`，不是流式的 `end` 帧（后者按 attempt 发）；有回归测试盯着 |
| **卡片停在「正在加载上下文…」不动** | 不可能了——先建卡再开回合，且卡片还不存在时收到的 seal 会由 `start()` 补执行；有回归测试盯着 |
| **封卡报 300317 / 卡片没变成「已完成」** | 不可能了——`seal()` 可重入，并发调用共用同一份计划；有回归测试盯着 |
| **插件时好时坏、偶尔整条消息没反应** | **同一飞书应用有两个长连接实例**（比如本地联调 profile 没退出）在抢事件 → 关掉多余实例，只留桌面版 |
| 提问弹窗出现在 Harness 而不是飞书 | `ask_user_question` 没被我们的工具遮蔽 → trace 里看有没有 `agent-setup` 之后的工具注册失败 |
| 提问卡按钮点了没反应 | 开发者后台没订阅 `card.action.trigger` 卡片回调 → 让用户**直接回复消息**（保底路径，卡片上有按钮） |
| `/new` 之后还是旧会话 | trace 里确认 `inbound` 有没有记录；没有 = 消息被另一个实例拿走了 |
| 上下文占比不显示 | 正常降级：`sessionProjections` 不可用或模型不在上下文窗口表里 → 在面板「上下文窗口」按模型 id 补一行 |
| 每次引用回复都开新会话 | 不可能了——`root_id` 不当 thread 有专门测试盯着 |

### trace.log 怎么看

`ctx.logger` 到不了 CLI stdout，所以插件自己写了一份 JSONL：

```
~/.dsh/feishu-card/trace.log
```

本地起 profile 时加 `FEISHU_CARD_DEBUG=1` 可同步看到。一次正常回合的关键行：

```
inbound → turn-start → agent-ready → agent-setup(-done) → card-create →
frame(×N 个 attempt，每个都有自己的 end) → session-event(assistant/message) →
session-event(turn/end) → card-seal → turn-result
```

注意 `frame … frameType:end` 会出现**多次**（每个 LLM 尝试一次），回合是否结束只看 `session-event turn/end`。

## 6. 本地复测环境（不需要真凭据）

```bash
npm test          # 194 个测试，含集成 + parity + ask-user
npm run smoke     # 构建产物可加载性 + 导出形状
npm run e2e       # 真飞书连通性（需要凭据）
```

联调 profile（`cardtest` / `cardweb`，`link:` 指向本仓库）保留在 `~/.dsh/profiles/` 下，方便反复启动：

```bash
$env:ELECTRON_RUN_AS_NODE=1
$env:FEISHU_CARD_DEBUG=1          # 把 trace 同步打到 stdout
& "<DSH install>\DeepSeek Harness.exe" `
  "<DSH install>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  --profile cardweb --no-open --port 18831 --host 127.0.0.1
```

> ⚠️ **用完必须确认进程真的退出了**。同一个飞书应用同时只能有一个长连接实例，
> 本地 profile 和桌面版并存会互相抢事件，表现为「插件时好时坏、消息莫名没响应」。
> `job_kill` 只杀 pwsh 外壳，Electron 子进程要单独 `Stop-Process`。

另有两个一次性探针脚本（都在 `scripts/`）：

| 脚本 | 用途 |
|---|---|
| `probe-card-send.mjs` | 单独验证「建卡实体 → `im.v1.message.create` → `batchUpdate`」全链路（e2e 原本漏了发消息那一步） |
| `send-as-bot.mjs` | 以机器人身份往群里发一条消息，用来在本地驱动整条桥接链路 |
