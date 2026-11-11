# 已核实事实：DSH 插件契约（0.2.x 桌面版）

> 全部来自本机实测：`<DSH install>\resources\app.asar`（用 `<workspace>/.dsh-check\{list-asar-entries,extract-asar}.js` 抽取）与 `~/.dsh\profiles\desktop\`。
> 写代码前先读这篇；不要凭记忆或凭其他版本的经验。

## 1. 版本与运行形态
- `DeepSeek Harness.exe` FileVersion = **0.2.0-rc.2**；asar 内 `@deepseek-ai/dsh-desktop-runtime` = **0.2.1-rc.2**（nightly 通道，包版本比产品版本新一级）。
- dsh 以 **Electron 内 node** 运行：`DeepSeek Harness.exe --expose-internals "...\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js" "...\app.asar\dsh" "~/.dsh\profiles\desktop" "...\runtime\primary-runtime" "...\runtime\pnpm\bin\pnpm.mjs" "...\runtime\bin"`。
- 本机 Node v24.18.0；`dsh` **不在 PATH**（`where.exe dsh` 无结果）；应用自带 pnpm 在 `<DSH install>\resources\runtime\pnpm\bin\pnpm.mjs`。

## 2. profile 与安装通道（最重要）
- profile 目录 `~/.dsh\profiles\desktop\`：`package.json`（bundles: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`）、`pnpm-workspace.yaml`（`nodeLinker: hoisted`）、`cordis.yml`（空数组）、`cordis.patch.yml`（我们的配置覆盖写这里也行，但设计上配置走设置文档，见 DESIGN §6）。
- **CLI 不能管 desktop profile**：`@deepseek-ai/dsh/lib/bin.js:36` → `if (profile.toLowerCase() === "desktop") program.error('error: profile "desktop" is managed exclusively by the Electron application')`。想跑 CLI 只有一条路：`$env:ELECTRON_RUN_AS_NODE=1; & "<DSH install>\DeepSeek Harness.exe" "<asar>\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" ...`（能跑 `--version` 出 0.2.0-rc.2，但 `--profile desktop` 一律被拒）。
- **GUI 安装**：桌面版侧栏「插件」页（`@deepseek-ai/dsh-client-ui-plugin-manager`）→「添加插件」接受 **包名（可带版本）/ Git 地址 / 压缩包 / 本地绝对路径**；自动探测 npm 官方源与 npmmirror；pnpm 拦构建脚本时给「允许这些脚本并重试」（授权写进 profile 的 `pnpm-workspace.yaml`）。
- 安装器流程（`@deepseek-ai/dsh-plugin-manager` README）：`inspect(spec)`（读 package.json / `pnpm view`）→ 必须**声明 bundle patch**，否则 `not-a-bundle` 被拒 → `pnpm add` → 成功后默认启用（追加进 `package.json` 的 `dsh.profile.bundles`）→ 发 `plugin-manager/changed`。
- **版本闸**：点名包的安装会在 pnpm 前检查 peer；不兼容的 DSH peer 直接 `incompatible-version` 失败，需在 profile 的 `compatibility.json` 里做豁免（`dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <runtime> --accept-risk`）。
  → **我们的策略：不写任何 DSH peerDependencies**，用 `engines.dsh` + `dsh.compatibility` 声明（dsh-im 同款），DSH 包只进 devDependencies。
- 限制：一次只能装一个；无版本选择器（升级=卸载重装）；bundle 层变化**需重启应用**。

## 3. bundle 清单格式（`@deepseek-ai/dsh-package-manifest` README 原文示例）
```ts
const manifest: DshPackageManifest = {
  name: 'example-dsh-plugin',
  version: '1.0.0',
  engines: { node: '>=24', dsh: '0.1.5-alpha.1' },
  dsh: {
    manifestVersion: 1,
    bundle: { patch: './cordis.patch.yml' },   // 也接受有序路径列表
    client: { platform: 'web' },
  },
}
```
- `dsh.bundle.patch` = 安装型插件的**发现标记**；`dsh.client` 是与 `bundle` **平级的兄弟键**（不是 `bundle.client`）；`dsh-plugin` 只是 npm `keywords` 里的发现词。
- `dsh.client.inject` 列出 client 半侧依赖的**官方包名**（会作为 Loader 行注入）。
- `engines.dsh` 与 `dsh.manifestVersion` **当前不被安装器/加载器强制校验**（README 原文：「当前安装器和加载器不强制检查」），真正的闸是 peer。

## 4. 真实例子（verbatim）
**harness-lark 0.1.22**（`<workspace>/.dsh-check\packs\harness-lark\package\package.json`）：
```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "inject": ["@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-client-ui-slots"], "platform": "web" } },
"dependencies": { "@deepseek-ai/dsh-settings": "^0.1.0-rc.6", "@deepseek-ai/schemastery": "^3.18.1", "@larksuiteoapi/node-sdk": "^1.64.0" },
"peerDependencies": { "@deepseek-ai/cordis": "^4.0.1", "@deepseek-ai/dsh-agent": "^0.1.0-rc.6", ... }
```
其 `cordis.patch.yml` 全文：
```yaml
- insert:
    - id: lark
      name: 'harness-lark'
      config:
        appId: !!js process.env.FEISHU_APP_ID
        appSecret: !!js process.env.FEISHU_APP_SECRET
        brand: feishu
        connectionMode: websocket
        dmPolicy: open
        groupPolicy: open
        requireMentionInGroups: true
        respondToMentionAll: false
        replyMode: streaming
        topicSeparateSession: true
```
⚠ 它 `inject` 的 `@deepseek-ai/dsh-client-runtime` 在 0.2.x 运行时里**不存在** → 它的设置页加载不出来；`dependencies` 里的 0.1.x `dsh-settings` 会和宿主 0.2.x 撞车。**这两个坑我们不踩。**

**dsh-im 5.1.0**（npm `@xmanrui/dsh-im`）：
```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "inject": ["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-runtime",
                                 "@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-slots",
                                 "@deepseek-ai/dsh-client-locale"], "platform": "web" },
         "compatibility": { "dsh": "0.2.1-rc.2",
                            "dshReleases": { "0.2.0-rc.2": "compatible", "0.2.1-rc.2": "compatible" },
                            "profiles": ["web"] } }
```
其 `cordis.patch.yml` 全文只有 3 行、**没有任何 config**（配置全走设置页）：
```yaml
- insert:
    - id: xmanrui-dsh-im
      name: '@xmanrui/dsh-im'
```
→ **照这个来：patch 只 insert 一行，配置走设置文档。**

## 5. 客户端设置页的两种真实写法（子代理源码级核实）
**(a) 挂在「设置 → 插件」里的卡片（最简单，推荐）** — dsh-lark-bot `src/client/settings-card.tsx`：
```ts
export const SETTINGS_NAMESPACE = 'dsh-lark-bot'
export const inject = ['slots', 'settingsScope']
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<BrowserSettings>({ namespace: SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, inject: () => ({ scope }),
  }, SettingsCard))
}
```
保存：`scope.set(key, value)` / `scope.unset(key)`；**secret 行留空即跳过**（不会覆盖已存密钥）。
**(b) 自建顶级设置分区** — harness-lark `src/client/index.tsx`：
```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'lark', order: 50, label: '飞书',
}, AgentsSection))
```
（它之所以自建 `/lark/api/settings.*` 路由，是因为 DSH settings RPC 不给第三方 namespace 服务——我们用 (a) 绕开这个问题。）
- 官方包 `dsh-client-ui-plugin-manager` 的 README 还提到 `plugins.bundle.config` / `plugins.row.config` 两个 slot 键，但**子代理在所有第三方插件里都没见到有人用**；用 (a) 的 `settings.plugin.item` 最稳。

## 6. 0.2.x 运行时里确实存在、我们能用的包（asar 实测）
`@deepseek-ai/dsh-token-meter`、`dsh-session-stats`、`dsh-credentials`、`dsh-settings`、`dsh-agent`、`dsh-session`、`dsh-tools`、`dsh-client-ui-slots`、`dsh-client-ui-settings`、`dsh-client-connection`、`dsh-client-locale`、`dsh-client-modules`、`dsh-hmr`、`dsh-sandbox*`、`dsh-skill`、`dsh-attachment*`、`dsh-workflow`、`dsh-subagent*`、`dsh-commands`、`dsh-system-prompt`、`dsh-compaction*`、`dsh-goal`、`dsh-jobs*`、`dsh-schedule`、`dsh-mcp-client`。
**不存在**：`dsh-client-runtime`（harness-lark 踩的坑）。
以上 `@deepseek-ai/*` 在 npm 都能按 `0.2.1-rc.2` 装到 → 本机构建/类型检查无障碍。

## 7. 其他实测
- 宿主 pnpm 子进程通过 `@deepseek-ai/dsh-subprocess-local/lib/runner.js` 启动；agent 沙箱模式 `workspace-write`（本会话实测 `pwsh` 在该模式下起不来，放宽到 `danger-full-access` 才正常——排查时注意）。
- 会话目录 `~/.dsh\sessions\--D-workspace--\...`，插件若写自己的状态放 `~/.dsh\feishu-card\`（自建目录，勿污染 sessions）。
