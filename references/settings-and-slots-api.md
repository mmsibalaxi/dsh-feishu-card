# 已核实 API：DSH 0.2.x 设置 / 凭据 / Slots（写代码前必读）

> 来源：本机 `node_modules/@deepseek-ai/*@0.2.1-rc.2` 的 `.d.ts`（npm 可装，版本与桌面运行时一致），辅以 asar 内同名包的 README。
> 这篇是 M1a 的落地成果：**配置怎么在面板上读写**的完整答案。

## 1. Host 侧：`ctx.settings`（`@deepseek-ai/dsh-settings`）

```ts
interface SettingsDescriptor {
  ns: string              // = profile 条目 id（我们的是 'feishu-card'）
  autoGenerate: boolean   // UI 是否可以在没有自定义页时自动生成页面
  schema: unknown
  value: unknown          // 当前生效值（已解析）
  revision: number
  base?: unknown          // 组合层继承值（清除字段时回退到它）
  user?: unknown          // 用户层原文（字段"存在"于此即视为覆盖）
  applies: 'live'
  secrets?: RedactedSecret[]
}

class SettingsForms extends Service {
  get writable(): boolean
  get documentPath(): string                       // profile patch 路径
  prepareDocument(): Promise<string>
  describe(options?): SettingsDescriptor[]         // 按条目 id 列出全部表单
  update(ns, patch, expectedRevision?): Promise<void>      // 合并 editable 字段
  replace(ns, section, expectedRevision?): Promise<void>   // 先重置再设置
  mutate(ns, ops: readonly SettingsPathOp[], expectedRevision?): Promise<void>
  configure(presentation: { auto?: boolean }, owner?: Fiber): () => void  // 注册页面策略
}
class SettingsConflictError extends Error { code = 'SETTINGS_CONFLICT'; expected; actual }

type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }
```

**要点**
- 表单只投影 Config 里 `.volatile()` 的字段 → 我们所有面板可编辑项都必须 `.volatile()`。
- `.role('secret')` 字段的值/继承值/覆盖值/schema 默认值**全部对客户端隐藏**，只回传存在性 → 所以面板的密码框必须"留空=不修改"，且写入要走 `mutate` 的 path op，**不能**用 `replace`（会用脱敏文档把密钥冲掉）。
- 改动持久化进当前 profile 的 `cordis.patch.yml`（按条目 id 的覆盖层）；home patch / 命令行 overlay 优先级更高，会被覆盖的写入被拒。
- 自带页面的插件：`apply` 里 `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false })))`。我们已注册（因为自带浏览器卡片，不需要自动页）。
- `ctx.settings` 只在注入了该服务的 Context 上存在（我们在 `src/augmentations.d.ts` 引入 `@deepseek-ai/dsh-settings` 才有类型）。

## 2. Browser 侧：`ctx.configForms`（`@deepseek-ai/dsh-client-ui-settings/client`）

```ts
interface ConfigFormSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined      // 最近一次被接受的 schema 解析值
  base: unknown             // 组合层（清除后回退到哪）
  user: unknown             // 用户层原文
  revision: number | undefined  // 下一次写入的围栏
  writable: boolean
}
interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void     // 配 useSyncExternalStore
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean>
}
// 用法
const form = ctx.configForms.get<FeishuCardConfig>('feishu-card')   // 键 = profile 条目 id
```

- 每个浏览器一个表单控制器，重复 `get(entryId)` 返回同一个；写入队列保序，每次带最新 revision；Host 拒绝最新写入会重新拉取 Host 状态。
- client 模块自己的 `inject` 要声明 `['slots', 'configForms', 'remote.settings']`（官方注释：every caller declare `remote.settings` in its own inject）。

## 3. 凭据：`ctx.remote.credentials`（`@deepseek-ai/dsh-api-settings-controller`）

- `describe(refs)` → `{ [ref]: CredentialInfo }`（脱敏，最多 64 个/次）
- `set(ref, value)` / `unset(ref)` → 机密值**只在这个方向过 wire**，没有任何方法会把它读回来
- 拒绝 → `credential-rejected`（带提供方消息）
- settings 三个写操作：`update` / `replace` / `mutate`，过期写入 → `settings-conflict`，提供方拒绝 → `settings-rejected`；`openSettingsDocument()` 用原生编辑器打开设置文档

> 当前实现把 appSecret 放在 cordis Config 的 `.role('secret')` 字段里（由设置服务负责脱敏与持久化）。若未来想把密钥挪到 credentials 服务，用 `appSecretRef` 指向凭据名即可——两条路都通，选一条别混。

## 4. `ctx.slots`：上游没发 Context 类型，我们本地声明了最小面

```ts
ctx.slots.inject('settings.plugin.item', () =>
  ctx.slots.register({ name: 'settings.plugin.item', key: 'feishu-card',
                       inject: () => ({ form: ctx.configForms.get('feishu-card') }) },
                     SettingsCard))
```
- `dsh-client-ui-slots` 只发布 slot **类型**（`SlotEntryDef` / `SlotMap` / `FactoryLocalSlotDef`…），运行期服务由客户端 slots host 提供，**没有 Context 增强** → 我们在 `src/augmentations.d.ts` 里补了最小声明（`inject` / `register`）。上游补类型后可删。
- slot 名语义（来自官方 README）：`settings.section` = 顶级设置分区；`settings.plugins.tab` = 「插件」分区里的标签页；`settings.plugin.item` = 插件页上的条目卡片。**我们用的是 `settings.plugin.item`**（dsh-lark-bot 同款，最简单且已被验证）。

## 5. 版本与安装（复述自 dsh-plugin-contract.md，便于单篇查阅）
- 桌面 0.2.0-rc.2 / 运行时 0.2.1-rc.2；profile `~/.dsh/profiles/desktop`；CLI 拒管 desktop profile；安装走 GUI「插件 → 添加插件 → 本地绝对路径」。
- 我们**不写 DSH peerDependencies**（peer 是安装器的版本闸），用 `engines.dsh` + `dsh.compatibility` 声明；DSH 包只进 devDependencies（锁 0.2.1-rc.2）。
- 已知安装摩擦：`@larksuiteoapi/node-sdk` 的传递依赖 `protobufjs` 有 postinstall，pnpm 11 会拦 → GUI 会出现「允许这些脚本并重试」，点一次即可（dsh-lark-link 的 README 明确说 protobufjs 不执行 postinstall 也完全可用）。若想去掉这个点击，需要摆脱该 SDK（自实现 WS 长连接），列入后续可选优化。
