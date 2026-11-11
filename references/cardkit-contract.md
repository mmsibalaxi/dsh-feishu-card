# 已核实契约：飞书 CardKit v2.0 流式卡片（移植来源 = 用户 hermes 插件）

> 来源：`~/AppData/Local/hermes\plugins\hermes-lark-streaming`（v2.4.0 + 本机 fork）。
> 这是用户"效果不错"的那套实现；M2 移植时逐条对齐。文件行号供回查。

## 1. 四个 API（`@larksuiteoapi/node-sdk`，`feishu/client.py`）
| 动作 | SDK 调用 | 关键参数 |
|---|---|---|
| 整卡更新 | `client.cardkit.v1.card.aupdate(UpdateCardRequest)` | `card_id`、`request_body.card = Card.builder().type("card_json").data(dumps(card)).build()`、`sequence` |
| 局部更新 | `client.cardkit.v1.card.abatch_update(BatchUpdateCardRequest)` | `card_id`、`request_body.actions = dumps(actions)`、`sequence` |
| 关流式/改摘要 | `client.cardkit.v1.card.asettings(SettingsCardRequest)` | `settings = { config: { streaming_mode: false, summary: {content, i18n_content} } }`、`sequence` |
| 建卡（发消息时） | 消息体带 card_json（`cardkit/cards.py` 产出的 dict） | 见 §2 |

- `sequence`：单调递增，**每次 API 调用都要带**（hermes 用 `session.sequence`）。
- `summary` 截断到 120 字符，必须同时给 `content` 与 `i18n_content{zh_cn,en_us}`。

## 2. 建卡结构（`cardkit/cards.py::build_streaming_card_v2` verbatim 语义）
```jsonc
{
  "schema": "2.0",
  "config": {
    "streaming_mode": true,
    "streaming_config": {
      "print_frequency_ms": { "default": 70 },   // 飞书侧的吐字频率
      "print_step": { "default": 4 },             // print_strategy=delay 时每次吐几个字符块
      "print_strategy": "delay"
    },
    "locales": [...],
    "summary": { "content": "处理中…", "i18n_content": {...} }
  },
  "body": { "elements": [
    { "element_id": "answer_content", ... 流式 markdown 元素 ... },  // 答案（置顶，用户 fork 的选择）
    { ...loading hint 占位... },
    { "element_id": "loading_icon", ... 旋转图标 ... },
    { ...统一过程面板占位（reasoning + tools，放最底部）... }
  ] }
}
```
- 固定 element_id：`answer_content`、`loading_icon`、`footer_hr`、`footer_status`（后两个是本机 fork 加的，用于幂等修复）。
- 元素顺序 = 用户 fork 的选择：**answer 在上、过程面板在底部**（原版 panel 在中间）。
- 文本字号：正文 `normal_v2`，footer/notation 用 `notation`。

## 3. 流式刷新（`controller/linear_mixin.py` + `flush/controller.py`）
- 客户端节流：`flush_interval_ms`（hermes 配置默认 200ms；我们设计默认 800ms，见 DESIGN §5.5）、`print_strategy: delay` + `print_step: 4`。
- 每个 flush：把脏的 answer 文本 `aupdate`/`abatch_update` 上去；过程面板按需更新。
- `_streaming_element` 是带流式能力的 markdown 元素（飞书侧按 `print_frequency_ms` 吐字）。

## 4. 封卡 seal 顺序（hermes 的生产教训，**顺序即正确性**）
1. flush 残留脏数据（`answer_dirty` → 先写干净）。
2. `batch_update`：过程面板置终态（`partial_update_element` 是 set 语义，重复发同样内容免费，是唯一的内容兜底）。
3. **加 footer**：`add_elements(insert_before(loading_icon))` 必须**先于** `delete_elements(loading_icon)`；`insert_before` 失败（300315）→ 退化为 `append`（需显式 `"type": "append"`，否则飞书回 `10002 add element type is nil`）。
4. `asettings` 关流式，带 summary（**只在未关过时调一次**）。
5. 删除动作**逐个单独一个 batch**，绝不分组（batch 原子：一个失败动作会回滚同批所有动作）。

## 5. 错误码对照（`feishu/client.py:125` 起 + controller 分支）
| code | 含义 | 处理 |
|---|---|---|
| `300309` / `300313` | 流式已关闭（间歇性时序竞态） | 退化为 `batch_update` 写正文；标记 `_streaming_closed`，后续只走 seal 修复 |
| `300301` | element_id 重复 | = "已经在那儿了"，视为满足 |
| `300314` | 删不存在的元素 | 视为满足（delete 组） |
| `300315` | `insert_before` 目标已没了 | **不能**证明 footer 没加上 → 必须落 append 重试 |
| `10002` | add element 没带 type | 显式带 `"type": "append"` |

## 6. 已知坑（hermes 踩过，我们直接避开）
- `batch_update` **非幂等**：首次尝试服务端可能已落地，重试会撞 `300301`；所以重试策略要按上面的码分流，不能无脑重试。
- `batch` 返回 `code=0` 也可能有逐动作结果丢失：要读 `resp.data` 记录。
- 卡片的完整 message_id 只有建卡日志里有；卡片 API 不返回 → 想保可修复性就从日志拿 id。
- `card_ttl_sec`（hermes 600s）：长任务要有 TTL/续期策略，否则卡片过期。
- 群聊发送文件走审批卡（提示注入外泄面），我们默认只在私聊直接发文件（DESIGN §5.4）。

## 7. M2 交付时对这些的落地方式
- `src/host/card/{builder,streaming,md}.ts` 三个文件对应上面 §2/§3+§4/§5。
- 单测必须覆盖：seal 动作序列顺序、`insert_before→delete` 相邻性、各错误码分支、flush 节流、`md.ts` 的 13000B 截断与可见标记。
