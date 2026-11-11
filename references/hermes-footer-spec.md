# hermes footer 规格（用户既有偏好，必须继承）

> 来源：`~/AppData/Local/hermes\plugins\hermes-lark-streaming` + `~/AppData/Local/hermes\skills\hermes\hermes-feishu-plugins\SKILL.md`（那份 skill 是用户长期使用沉淀下来的偏好，属于硬约束）。

## 1. 用户当前的配置（`%LOCALAPPDATA%\hermes\config.yaml`）
```yaml
streaming:
  enabled: true
  header: { enabled: false }          # 不要卡片标题栏
  footer:
    enabled: true
    fields: [[status, elapsed, context, model]]
hermes_lark_streaming:
  footer:
    fields: [[status, elapsed, model, context]]
    show_label: false                  # 不带"状态/耗时"这类标签前缀
  print_strategy: delay
  print_step: 4
  flush_interval_ms: 200
  card_ttl_sec: 600
  max_tool_steps: 20
  max_reasoning_rounds: 20
```

## 2. 目标格式（用户明确满意的形状）
```
已完成 · 54.6s · ⚕mimo-v2.5-pro · 31.1K/1.0M (3%)
```
字段语义（`cardkit/elements.py::_render_footer_field`）：
| 字段 | 渲染 | 数据来源 |
|---|---|---|
| `status` | `已完成` / `已停止` / 出错态 | 回合终态（error/aborted/completed） |
| `elapsed` | `54.6s`（`_format_elapsed(ms)`） | 本轮 duration |
| `model` | `⚕<model>`（图标紧贴模型名，无空格） | 当前模型；注意 hermes 显示的是**配置模型**，fallback 后不更新 |
| `context` | `31.1K/1.0M (3%)` | `context_used` / `context_max`（`_compact()` 千分位缩写） |
| `tokens`（可选，用户没开） | `↑ 1.2k ↓ 320` | input/output tokens |
| `cost` | **用户明确要求移除，不要加回来** | — |

## 3. 用户既有偏好（硬约束）
1. **footer 不显示 cost**（用户主动要求删，且不要再出现）。
2. **正文绝不重复统计行**：正文只留内容（发现、表格、注意事项），不要把"耗时 ~40s · model x"写进正文——会和 footer 打架且用户已经点名过这个毛病。
3. `show_label: false`：字段之间用 ` · ` 分隔，不带"状态："这类前缀。
4. 中断态也要有 footer：`已停止 · 35.6s · …`（不能只有"已完成"一种）。
5. footer 用 `notation` 小字号；位置在卡片最底部（`footer_hr` 分隔线 + `footer_status`）。
6. 卡片标题栏（header）关闭；过程面板可折叠；answer 在上、面板在下。

## 4. 移植到 DSH 时的差异点
- DSH 侧没有 hermes 的 `estimated_cost_usd` / `cost_status`，本来就不显示 cost，天然合规。
- `context_max`（模型上下文窗口）hermes 来自 `config.yaml` 的 `custom_providers.*.models.*.context_length`；DSH 侧**没有现成服务**（子代理确认全生态缺失）→ 我们自建 `contextwin.ts` 注册表 + 面板可覆盖（DESIGN §5.6）。
- `model`：DSH 侧应从 agent/session 的实际模型取（不要学 hermes 只显示配置模型的缺陷；取不到再退配置模型）。

## 5. 用户 hermes 插件的其他可继承行为（M2 参考）
- 思考过程（reasoning）以灰色 notation 展示，可折叠；`display.show_reasoning` 用户设为 false 时仍走面板（用户 fork 加了 `streaming.show_tools` 开关，关掉后不画工具面板）。
- 工具调用：图标 + 状态 + 结果，`max_tool_steps: 20` 上限。
- 新消息到达时，同 chat 的旧卡片会话标记 `ABORTED`（`Interrupted by new message`）。
- 消息被撤回/删除时自动终止卡片。
- 飞书原生思考消息（CoT）需要 PC 7.70 / 移动端 7.74+，旧客户端退化为打字机卡片（DSH 侧同理，`output: cot | stream` 二选一，我们默认走打字机流式元素，兼容性最好）。
