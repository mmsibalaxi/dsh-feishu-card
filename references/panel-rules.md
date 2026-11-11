# 这个插件返工出来的规则（改任何一块之前先读）

来源：17 轮真机迭代里每一轮的根因。按「哪一轮踩的」标注，方便回查。
**新增任何卡片结构 / 面板控件 / 跨进程调用之前，先在这里找有没有对应规则。**

## 一、抄，不要发明

1. **卡片结构先找 hermes 的对应 builder，把返回值的每个键都对一遍**（第16轮：自己发明的 `extra` 键 → `300313`，整批 batchUpdate 回滚，卡片永远停在思考中）。参考实现：`~/AppData/Local/hermes\plugins\hermes-lark-streaming\`。
2. **官方控件的 markup/CSS 从 app.asar 里挖出来抄**，不要自己设计（第18轮：用户说"排版真的丑"）。`@deepseek-ai/dsh-client-ui-primitives` 不是独立包，实现在 `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`，导出表里 `SettingsForm: sR` / `SettingsValueField: aR` / `SettingsSecretField: lR` / `settingsNumberField: cR`，CSS 在同名 `.css` 里按 class 名搜。
3. **插件不许 import 任何 Harness Client 包**（DSH 自带 skill 明令）：会变、无类型检查、抛错整块刷掉 slot。抄过来改类名前缀，只留 `--dsw-alias-*` 令牌。

## 二、Cordis / 宿主

4. **Context 是 Proxy**：`ctx.<服务>` 不在 `inject` 列表里会抛 `cannot get property "X" without inject`。可选服务用 `ctx.get(name)`（返回 `undefined`）。
5. **`ctx.get()` 在插件激活早期拿不到后激活的插件提供的服务**（第18轮：`ctx.get('webServer')` 永远 undefined，请求落到 connection 包的 `/api` 前缀路由上返回 `404 not found`）。跨插件拿服务一律 `ctx.inject(['name'], child => child.effect(...))`。
6. **`ctx.effect` 的同步回调必须返回 disposer**，返回 `undefined` 类型不通过（TS2769）。
7. **`export default` 会让 cordis 把模块当普通函数插件**，`Config` 被静默丢掉、整个面板表单消失。只写命名导出。
8. **面板表单只投影 `.volatile()` 字段**；`.role('secret')` 只写不回显。
8.5 **插件依赖的 `@deepseek-ai/*` 是插件自己 `node_modules` 里的一份拷贝，和 app.asar 里的内核不是同一份**（2026-11-09：插件解析到 `dsh-agent@0.2.1-rc.2`，内核是 `0.2.2-rc.1`）。凡是「拿上游包当 API 用」的 hook 型 helper，升级内核后语义可能已变。**具体事故**：`dsh-agent@0.2.1-rc.2` 的 `installModelSelection` 用 `agent/request` 钩子直接改写请求的 provider/model；而 0.2.2 内核在 `prepareRequest()` 里把本步路由定死、并校验 `agent/request` 不得改路由，于是每轮都抛
`agent/request proposed "magpie/auto/…" after step preparation fixed "magpie/raccoon/…"; use agent.model.select() before step preparation`
→ **整轮失败**。规则：**模型路由只走 `agent.model.select()`（create/resume 之后、第一步之前）**；`agentOptions` 只是新会话的初始值，**resume 会重放日志里的 `model/selection` 盖过它**，所以必须显式钉一次；`{{provider}}/{{model}}` 只通过 `system-prompt/assemble` 补；绝不在 `agent/request` 里改路由。升级内核前先 diff helper 注册了哪些事件。

## 三、客户端（浏览器半边）

9. **表单快照读不到"密钥是否已保存"**（第19轮）：宿主的 `ConfigFormController.derive()` 只把 `revision/base/user/writable/value` 写进 store，**丢掉了 `secrets` 位置数组**。要去 `ctx.configForms.describe()`（共享 mirror）的 `view.namespaces[].secrets` 里读——官方类型 `SettingsNamespaceView.secrets: SettingsSecretView[]` 保证它一定在。
10. **客户端是 classic script + CJS + React 外部**，用 `window.__ModuleLoader__.load({id, factory})` 包裹；esbuild 必须 `charset: 'utf8'`，否则中文全变 `\uXXXX`。
11. **飞书 OpenAPI 没有 CORS**，所以浏览器不能直接调；App Secret 又不会回传浏览器。需要宿主数据的界面一律走同源路由（`webServer.register({kind:'exact'})`，精确路由优先于 connection 的 `/api` 前缀路由）。目前只剩 `/api/feishu-card/models` 一条。

## 四、卡片 / 飞书协议

12. **按姓名搜人只有 user_access_token 能用**：`GET /open-apis/search/v1/user`（注意是 **v1**）**只支持 user token**，tenant token 调返回 `99991663`。**但这不是死路——用 Device Flow 拿用户自己的委托授权**（见 12.9）。
12.5 **「能看到多少人」由数据权限范围决定，不是由 API 权限决定**。实测 `SomeBot`（cli_xxxxxxxxxxxxxxxx）已授权 **186 个 scope**（含 `contact:user.base:readonly`），但 `GET /open-apis/contact/v3/scopes` 返回的 `user_ids` 只有 1 个 → `contact/v3/users` 只返回 1 个人；`find_by_department?department_id=0` 直接报 `40004 no dept authority error`（根部门要求全员通讯录权限）。**改法不在代码里**：开发者后台 → 权限管理 → 「可访问的数据范围」列 → 配置 → 通讯录 → **全部成员** → 保存 → 发布并等审核。默认范围是「与应用的可用范围一致」，这就是只看到 1 人的原因。联调捷径：用「测试企业与人员」把应用切到测试版本，默认就有全员通讯录权限。
12.6 `pc_default_ability="bot"` 的**仅机器人应用**，开发者后台是精简导航，**没有「开发配置」这层分组**，「权限管理」直接在左侧第一层。找不到入口时先看这个字段（`applications.get` 能读）。
12.7 `application.v6.applications.get` 返回的 `scopes` 里可能包含**已申请未生效**的权限——实测列表里有 `im:chat.members:read`，但真调群成员接口仍报 99991672。以实际调用结果为准，别信这个列表。
12.8 排查顺序：先 `GET /open-apis/contact/v3/scopes` 看授权范围，再 `applications.get` 看权限列表，最后才怀疑代码。**要拉第三方系统的人/群之前，先用这个顺序探一遍，再决定做不做选择器。**
12.9 **要「以用户身份」做事，用 Device Flow（RFC 8628），不要 OAuth 回调**。回调流程要配 redirect_uri + 起本地监听；设备码流程什么都不用配：
```
POST https://accounts.feishu.cn/oauth/v1/device_authorization
     client_id=<appId>&client_secret=<secret>&scope=<space separated>
  → {device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}
POST https://open.feishu.cn/open-apis/authen/v2/oauth/token
     grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…&client_id&client_secret
  → 400 {"error":"authorization_pending","code":20094}   ← 未确认是状态，不是错误
  → 200 {access_token, refresh_token, expires_in}        ← 确认后
```
- **`verification_uri` 必须原样使用**：飞书自己的 message 明确说不要重新编码/拼接
- `authorization_pending` 和 `slow_down` 都当「继续等」，不要当失败
- 续期用 `grant_type=refresh_token`，可能返回**新的** refresh_token，要存回去
- 前提：应用要已授权目标 scope（`contact:user:search`、`offline_access` 等），否则授权页报 `20027`
- 这条路的价值：`search/v1/user` 返回的 `open_id` 是**本应用命名空间**的，正好是白名单要存的值
- 发现来源：别人插件的实现（`.dsh-check/packs/harness-lark/lib/device-flow-*.mjs`）比翻文档快
12.95 **设备码授权是「人」的凭证，不是应用的**：存盘用 `mode: 0o600`，给一个「断开」入口，别把它当租户凭证用。
12.97 **`41050 no user authority` 不能用来判断 id 真假**：它只表示「不在应用的通讯录可见范围内」——机器人自己的 open_id 也返回 41050。要确认某个 open_id 是谁，只能用 user token 查（`GET /contact/v3/users/{id}`）。
12.98 **人名反查必须走 user token**：面板徽章要显示 `张三 ou_5e48…`，就得用委托 token；tenant token 对可见范围外的 id 一律 41050。`DirectorySearch.names()` 带缓存，面板刷新时不会反复打接口。
12.981 **名称要落盘，不能只放内存**（第 25 轮）：DSH 重启 = 名字全丢，面板一夜回到 `ou_…`。`~/.dsh/feishu-card/names.json` 存 `{users, chats}` 两类，原子写 + 去抖 + 读失败当空缓存。群名走**机器人自己的** `GET /im/v1/chats/{id}`（`im:chat:read`），和人授权完全解耦 —— 委托 token 死了群名照样在。
12.982 **`usableToken()` 刷新失败时绝不能返回旧 accessToken**（第 25 轮）：拿废票去请求 API，用户只看到"搜索失败"，然后自己发现"断开重连才行"。正确做法：返回 `undefined` + `state().needAuth = true`，面板显示「授权已过期，点重新授权」。
12.983 **面板永不显示 id**（第 25 轮）：徽章只显示名字，未知时显示 `未知用户`/`未知群`，id 放 `title` 悬停。名字解析不到时给一句「可能不在应用可见范围内」的解释，别让人对着一片"未知"猜。
12.984 **授权成功后要重新解析名字**：`useEffect` 只依赖 id 列表时，重新授权不会触发重取，徽章会一直停在旧状态直到刷新页面。授权状态变化要往上抛（`onAuthChange`）并 bump 一个 epoch。
12.985 `41050 no user authority` 用 **user token** 查也会出现（第 25 轮实测：`ou_5b9e…` 用本人 token 仍 41050）——这表示那个 id 不在可见范围/不属于本企业，不是"没授权"。这种 id 永远解析不出名字。
12.986 **「能搜到人」≠「能按 id 反查」**（第 27 轮真机）：`search/v1/user` 走**用户的可见范围**，`contact/v3/users/{id}` 受**应用的通讯录数据范围**管（本应用只有 1 个人 → 别人一律 41050，用本人 token 也一样）。所以**搜索响应里的名字必须当场落盘**（`directory.search()` → `NameBook.rememberUsers`），否则"搜到的人"加进白名单后照样显示未知用户。`search/v1/user` 不匹配 open_id，纯粘贴的外来 id 无解——面板要给原因，别只写"未知"。
12.987 **群名走机器人身份**：`im/v1/chats/{id}`；对报错的 id 回退一次 `chats/list`（一次覆盖全部）。**p2p 会话没有名字**（`chat_mode:'p2p'`），要贴「单聊」而不是「未知群」——「机器人见过的群」里混着单聊 id 是常态。
12.988 **群选择要有搜索**：`im/v1/chats/search?query=`（机器人身份，无过期问题），空 query 时用 `chats/list` 直接列出来（打开即见，比让人猜关键词好用）。只能搜到机器人自己在的群，这是正确口径。
13. **CardKit v2.0 的 action 形状是 `{action, params:{...}}`**，不是扁平的 `{kind, element_id, content}`。形状错了飞书返回 `code=0` 但什么都不做——这是最难发现的一类 bug。
14. **`partial_element` 只带元素内部字段**（没有 `tag`、没有 `element_id`）。
15. **卡片回调响应必须包一层**：`{toast, card: {type:'raw', data: <card>}}`。
15.1 **`plain_text` 元素没法给局部上色**，所以模型前的图标用 **emoji**（现在是 `💠`，21轮之前是 `✦`）：emoji 在 `plain_text`（面板头）和 `markdown`（footer）里都自带颜色，`<font color='…'>` 只对 markdown 生效。用户 2026-11-09 的原话：「这个模型前的✦标识整个带颜色的」。
15.2 **卡片底部状态行是「结果」不是「进度」**：创建卡片时**不要**带 footer（用户 2026-11-09：「没有完成回复前底部的状态可以不显示」）。footer + 分隔线由 seal 用 `add_elements insert_before(loading_icon)` 补上（`footerPresent: false`）。
15.3 **接 15.2：flush 里绝对不能 patch `footer_status`**——那时元素还不存在，整批 `batchUpdate` 回滚，答案就一起写不进去了（300313/元素不存在）。flush 只 patch `answer_content` + `agent_process_panel` 两个。
15.4 **卡内停止按钮**：右下角靠 `column_set` 里一个 `width:'weighted', weight:1` 的空列推过去（`horizontal_align` 不在我们能依赖的 schema 里，未知键会让整批失败）；**红色空心圈**用 `type:'danger'` + 文本 `◯ 停止`——`⏹`（U+23F9）在飞书里渲染成蓝色方块，正是用户 2026-11-09 说不要的那个。
15.5 **「消息栏显示什么」= `config.summary`**（会话列表/通知预览），不是 footer。seal 时用 `summaryFromAnswer(answer, status)` 给正文首句；给状态词（"已完成"）会让每个会话预览都一模一样（用户 2026-11-09：「最后回复完 不要消息栏显示已完成」）。
15.6 **收到消息先贴一个表情**（用户 2026-11-09：「收到消息要有回复的表情」）：`POST /open-apis/im/v1/messages/{id}/reactions`，需要 `im:message.reactions:write_only`（本应用已授权），`emoji_type` 是飞书自有驼峰键（`OnIt`/`DONE`…），不是 emoji 字符。必须 best-effort：没权限/被撤回/限流都不能影响这一轮。
15.7 **表情是「状态」，不是贴纸**（用户 2026-11-10：「回复完成之后…改成DONE」）：`OnIt` 只在「收到了、正在做」时成立；答案发出后必须换成 `DONE`（✅），**失败时直接删掉**（打勾等于撒谎）。做法：`create` 会返回 `reaction_id`，`settle()` **先加新表情再删旧的**（反过来会有一瞬间一个表情都没有，看着像被撤回），`clear()` 只删不加。真机验证：`scripts/probe-reaction.ts` 跑完用 `messageReaction.list` 复核，`remaining: ["DONE"]`。
15.8 **footer 的「已停止/出错」要红**：footer 是 markdown 元素，`<font color='red'>已停止</font>` 有效（hermes 的 status pill 同款）；`已完成` 保持默认色。
15.9 **`carded` ≠ 「卡片存在」**：它只表示「正文写进卡片了」。停止的回合一个字都没有，`carded=false`，runtime 就会误以为卡片没送到而补发 `（本轮无输出）`——用户截图里那条多余的气泡。判断要用 `cardCreated + reason`（`shouldSendTextFallback()`）：**卡在 + stopped → 不发**；卡不在 → 必须发（否则用户什么都没有）。
15.10 **斜杠命令一次只回一条消息**：`/new`、`/stop` 以前先回「正在…」再补一条结果，一次提问两条通知。命令处理改成 async、`await` 真正做完再返回**结果那一句**（并由调用方作为引用回复发出）。
15.11 **停止要按「这一轮是谁发起的」限定**（用户 2026-11-10）：飞书**一张卡给全群看**，做不到按人渲染按钮，只能在 `card.action.trigger` 回调里比对 `operator.open_id`（v2 在 `operator`，老版本在顶层或 `context`，三处都读）与按钮 value 里的 `ownerOpenId`，对不上返回 warning toast、**不调 stop**。拿不到 clicker 时放行（礼貌性防护，不是授权边界）。**同一规则必须同时盖住 `/stop` 和 `/new`**（`reset()` 内部就是 `stop()`），否则打字就绕过去了 —— 只守按钮等于没守。
15.12 **封卡是一次「必须落地」的写**（第 26 轮）：`runSeal` 早期版本在跑 plan **之前**就置 `sealed=true`，plan 一抛错（`sealCard` 只 warn 不重抛）卡片就永远停在「转圈 + 停止按钮」。规则：**拆成 `closed`（内容冻结）与 `sealed`（plan 已落地）**，只有成功才置 `sealed`，失败保持可重试；并且 **seal 的 batchUpdate 必须走 `write()` 写链**——它靠 `sequence` 递增，和还在飞的 flush 撞号就是 `300317`，而这正是「封不上」最常见的触发方式。
15.13 **封卡要重试**：默认 `[0, 800, 2500]`；若这张卡此前成功写过（`wroteOk`）再加一次 10s 尾尝试（短抖动通常 10s 内恢复），从没写成功过的卡（没权限）不加，避免每轮白等。重试前**跳过已用序号**，否则重试又撞 317。最后一帧 flush 失败也不能阻断封卡（重试一次，仍失败就照封）。
15.14 **`trace.log` 里必须能分辨「测试噪声」和「线上事故」**（第 28 轮教训）：`trace()` 打的是本机真实路径，测试一旦跑到失败分支，就会把假 transport 的 `createCard is not a function`、假投影的 `no projections` 写进生产日志——一次对标审计据此报了 338 条"线上 bug"。现在 `VITEST` 下静默（`FEISHU_CARD_TRACE=1` 可开）。**排查第一步永远是看 `sessionKey`**：`oc_dm` 之类是 fixture，真实群是 `oc_<32hex>`。
15.15 **单卡有预算，长答案要续卡**（第 28 轮）：`ANSWER_MAX_BYTES`（≈13KB markdown）之外不能只截断。`splitAnswer()` 按字节切、**优先段落边界**、上限 4 段；主卡显示第 1 段 +「已续到下一张卡片」，其余 seal 后作为**静态卡**发出（fire-and-forget，失败不影响封卡）。
15.16 **面板（工具列表）是写链上最大的负担**（第 28 轮实测：72% 的 flush 不推进正文、中位间隔 913ms）：面板刷新周期 2s，最多 24 行，**只有最新 5 行带参数预览**（错误行永远保留）。面板和正文仍必须同一个 `batchUpdate`（同一张卡 sequence 单调，真并行必撞 300317）。
16. **`agent/assistant-stream` 的 `end` 是每次 LLM 尝试的结束，不是一轮的结束**；一轮的边界是持久化的 `session/event` → `turn/end`。
17. **一个应用只能有一条长连接**：起第二个实例会偷事件，表现为"插件时好时坏"。本地调试前先杀掉其他 `DeepSeek Harness` 进程。
18. **open_id 按应用隔离**，同一个人不同应用下不一样。
19. **飞书的拒绝报文里自带授权页 URL**（`https://open.feishu.cn/app/xxx/auth?q=...`），抽出来展示成可点链接，比让人自己去后台找权限好用得多。
19.5 **搜不到人时先分清是「权限」还是「范围」**：`GET /open-apis/contact/v3/scopes` 返回的 `user_ids`/`department_ids` 就是应用能看到的人。范围只有 1 个人时，任何权限都白搭——面板里的提示文案就是按这个写的（`directory.ts` 的 `SCOPE_HINT_THRESHOLD`）。

## 四之后、上下文注入（第 24 轮，对标 Hermes 网关）

20.1 **agent 只知道正文 = 半个机器人**。Hermes 网关会注入 chat_id/chat_type（`gateway/session.py:310`）、发送人姓名+open_id 前缀、引用原文、群内 @ 了谁；本插件之前一项都没有。规则：**会话级事实进系统提示词，逐条事实进消息前缀**。
20.2 **系统提示词的注入点用 `agent/system-prompt/assemble` 瀑布**（`next()` 之后 append 一个段），不要用 `ctx.systemPrompt.section()` —— 那个注册作用域是服务自己的 ctx，不是 agent 的 scope（`layers.effect(this.ctx…)`）。append 的段必须 `interpolate: false`，否则 `renderPrompt` 会把散文里的 `{{…}}` 当变量并抛错。
20.3 **`parent_id` 才是「被引用的那条」**，`root_id` 是话题开篇。普通「回复」也带 root_id，用它当引用会把线程开篇贴到每一轮。`root_id` 只在有 `thread_id` 时兜底。
20.4 **`im.v1.message.get` 两个坑（真机实测，文档没写）**：① `interactive`（卡片）默认返回「请升级至最新版本客户端」占位，必须传 `card_msg_content_type: user_card_content`，所以要**二次 get**；② **app/bot 发送者的 `sender.id` 是 app_id（`cli_…`）不是 open_id**，真 open_id 在 `sender.open_bot_id`。`with_sender_name: true` 会直接给 `sender_name`，不需要通讯录权限。
20.5 **引用/发送人姓名全部 best-effort**：目录没授权就只写 open_id，引用拉不到就不加前缀，任何一项失败都不能让这一轮失败。
20.6 **卡片流式：正文和面板必须分开 dirty**（第 24 轮）：每帧重发「正文+整块面板」时，实测约一半写入没推进正文却占着串行写链，观感就是「一行一行蹦」。正文 100ms（Hermes 值）、面板 500ms。
20.7 **多步回合要分段追加**：`assistant/message` 是**每一步**的权威文本，`setAnswer` 整体覆盖会让之前的段消失（用户看到的「文字回退」）。用 `segments[]` + `step/start → newSegment()`。
20.8 `im.v1.message.list` 需要 `im:message.group_msg`（本应用没有）——想拿 message_id 只能从自己的发送/回调里存。

## 四点五、宿主模型列表

19.5 **`ctx.llm.listModels()` 在 provider 缺凭证时返回 `[]` 而不是报错**（pi-ai 的 `MISSING_CREDENTIAL` 分支）——所以模型下拉框必须有两个数据源：适配器目录 + **设置文档**（`ctx.settings.describe()` 里每个命名空间的 `providers.<route>.models[]`，不需要凭证）。只用一个源，休眠 profile 里下拉框就是空的。
19.6 `agentDefaultModel` 的读方法叫 **`currentSelection()`**。

## 五、流程

18. **本地起 profile 验证**（不起长连接的那个）：`$env:ELECTRON_RUN_AS_NODE=1; & '<DSH install>\DeepSeek Harness.exe' --expose-internals '…\dsh-desktop-host\lib\cli.js' --profile cardweb --no-open --port 18831 --host 127.0.0.1`，然后 `curl -c jar "http://127.0.0.1:PORT/?token=<启动打印的 token>"` 拿 cookie，再打路由。
19. **要验证"有密钥"的分支但又不能起桥接**：把 `appId` 置空、保留 `appSecret`——插件 `apply()` 会提前返回（休眠），但设置命名空间仍然被服务，面板照常渲染。
20. **截图走查**：`agent-browser --session <名字> open <带 token 的 URL>` → `snapshot -i --json` 拿 ref → `click "@e35"` → `screenshot`。注意 `find text "保存"` 会点错元素，用 `.fc-save` 这种选择器或 ref 更可靠。
21. **`ctx.logger` 不会出现在 CLI stdout**；看插件自己的 `~/.dsh/feishu-card/trace.log`。
