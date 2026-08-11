# Agent 侧栏 Assistant 文案规范

> 状态：**已确认**（2026-08-06）  
> 范围：`AgentSideRail` 用户可见助手文案、SSE 呈现协议、原子创作（atomic_create）路径  
> 触发：山海经三视图对话暴露内部 context 泄露、多段拼接、术语外露等问题  
> 非范围：三视图四格的事前确认弹窗（产品已定：仅 informational 说明，不阻断）

---

## 0. 原则

| 原则 | 说明 |
| --- | --- |
| **用户语言优先** | 侧栏只展示创作者能读懂的中文，禁止路由名、节点 type、debug context |
| **一轮一气泡、阶段替换** | 同一 user turn 内助手气泡用 `text_replace` 随阶段更新，不 append 多段机器日志 |
| **内外分离** | `canvas_context`、checkpoint、confidence 仅给 LLM/parse，**禁止**拼进 `AIMessage` |
| **进度可感知** | 原子路径 emit `task_list` / `task_update`，与 Campaign 任务卡一致 |
| **说一次** | turnaround 四格说明只在「创建节点→生成中」阶段出现一次 |

---

## 1. 可见 vs 不可见

### 1.1 禁止出现在侧栏

- `原子创作：`、`image 节点（直达）`、`flow_mode`、`atomic_parse`
- 方括号内的 parse context：`[上轮原子:… \| 画布 N 节点 \| 近期对话:…]`
- `record:`、`generationRecordId`、内部 error type
- Campaign 方案全文、无关会话摘要

### 1.2 允许（info，非 confirm）

- 三视图 pipeline 说明：`已按角色设定图模版扩写…四格横排…2:1 画幅（非账户默认比例）。`  
  — **仅**在「已在画布创建节点，正在生成…」阶段附加一次，**不**事前询问「可以吗」

---

## 2. SSE 协议

| 事件 | 用途 | 前端行为 |
| --- | --- | --- |
| `text_replace` | 图节点产出的**整段**用户可见文案（每阶段一次） | 替换当前 assistant 气泡 `content` |
| `text_delta` | LLM 流式 token（Campaign plan 等） | 追加 token（保留现有行为） |
| `task_list` | 原子/Campaign 任务清单初始化 | 渲染任务进度卡 |
| `task_update` | 单任务状态变更 | 更新进度卡 |
| `node_status` | 画布节点 generating/completed | 画布 + 可选轮询（已有） |

**规则：** `runs.py` 对 LangGraph 节点 `AIMessage` 发 `text_replace`；仅真实 LLM streaming 用 `text_delta`。

---

## 3. 原子创作（atomic_create）文案模板

实现：`services/agent-runtime/app/graph/sidebar_copy.py`

### 3.1 阶段 A — 意图确认（parse_atomic_intent）

**时机：** 解析成功，尚未建节点  

**单节点：**

| 条件 | 模板 |
| --- | --- |
| 默认 | `好的，我来生成{模态}「{title}」。` |
| turnaround_image | `好的，我来生成「{title}」的角色设定图（四格）。` |
| confirm_gate（video/audio） | `收到，将为你创建{模态}「{title}」。提交前需你确认。` |
| 话题切换 | 前缀 `已按你的新需求处理：` |

**多图：**

`好的，我将创建 {N} 张图片：{title1}、{title2}、…。`

### 3.2 阶段 B — 创建节点（create_atomic_node）

`已在画布创建节点，正在为「{title}」生成…`

- turnaround：`+ turnaround_pipeline_user_note()`（四格 + 2:1 说明）
- 其他：`可在画布查看进度。`

同时 emit：

```json
{ "type": "task_list", "data": { "items": [{ "id": "...", "title": "...", "status": "pending", "nodeId": "..." }] } }
```

### 3.3 阶段 C — 生成完成（run_atomic_gen）

| 结果 | 模板 |
| --- | --- |
| 成功 | `「{title}」生成完成，请在画布查看节点。` |
| 部分失败 | `部分完成：…；未完成：…。请在画布查看。` |
| 失败 | `「{title}」生成未完成（{reason}）。可在画布节点重试。` |

emit `task_update`：`running` → `done` / `failed`

### 3.4 澄清（clarify）

直接使用 `clarify_question` 原文，已是用户语言。

---

## 4. 问题对照与修复

| 级别 | 问题 | 修复 |
| --- | --- | --- |
| **P0** | `canvas_context` 泄露到侧栏 | `parse_outcome_to_state` 不再把 context 拼进 `AIMessage`；仅写入 state/LLM |
| **P0** | 多阶段 AIMessage 被 append 成乱文 | Runtime 发 `text_replace`；前端 `replaceAssistantText` |
| **P0** | turnaround 说明重复两次 | 仅从 `format_atomic_create_progress` 输出一次 |
| **P1** | 开发者术语 | 统一走 `sidebar_copy` 模板 |
| **P1** | 话题切换无 acknowledge | `topic_switch_prefix()` 检测 prior vs new title |
| **P2** | 原子路径无进度卡 | `create_atomic_node` → `task_list`；`run_atomic_gen` → `task_update` |
| **P2** | `record:` 泄露 | 完成文案不再附加 record id |

### Phase 1 实现（本 PR）

- [x] `app/graph/context_packet.py` — packet 构建 + relevance gate
- [x] `app/graph/context_render.py` — markdown 渲染
- [x] `atomic_context.py` — 委托 packet/render
- [x] `intent_parse_llm` / `atomic_parse_llm` — `context_markdown`
- [x] `tests/test_context_packet.py`

---

## 5. Campaign / 其他路径（后续）

本期仅强制 atomic_create。Campaign 路径沿用现有文案，但应逐步：

- plan 摘要避免 manifest 机器列表裸露
- busy tip / 出图汇总保持短句 + 任务卡

### 5.1 product_visual v2（2026-08-11 延伸）

实物产品视觉出图（`flow_mode: product_visual` + scheme v2）的 **门控呈现、卡片/表格选型、13 类 UAT 问题清单** 见：

**[2026-08-11-agent-conversation-ux-product-visual-design.md](./2026-08-11-agent-conversation-ux-product-visual-design.md)**

要点：

- 门控消息使用 **presentation envelope**（`presentation_kind` + 槽位），非侧栏硬编码
- 延续本文 §0 原则；冲突时 product_visual 专用章节以延伸规格为准
- machine payload（`__macro_scheme_decision__` 等）禁止出现在 assistant 可见正文

---

## 6. 验收

1. 输入「帮我生成一个山海经的神兽的三视图」  
   - 侧栏**无**蓝牙耳机/营销方案/方括号 context  
   - **无**「原子创作」「image 节点（直达）」  
   - 四格说明**最多出现一次**  
2. 同一 turn 内气泡内容随阶段**替换**，非无限变长拼接  
3. 生成过程中任务进度卡可见，完成后可定位节点  
4. 连发不同主题时，第二条含「已按你的新需求处理：」（当 title 明显不同）

---

## 7. 相关文件

| 文件 | 职责 |
| --- | --- |
| `app/graph/sidebar_copy.py` | 文案模板 |
| `app/graph/atomic_parse_schema.py` | parse 阶段 AIMessage |
| `app/graph/nodes/atomic_create_node.py` | 创建 + task_list |
| `app/graph/nodes/run_atomic_gen.py` | 完成文案 + task_update |
| `app/runs.py` | `text_replace` 发射 |
| `apps/web/src/stores/agent.ts` | `replaceAssistantText` |
| `apps/web/src/components/agent/AgentSideRail.vue` | 处理 `text_replace` |
| `apps/web/src/components/agent/agentChipSet.ts` | atomic 确认门检测 snippet |

---

## 8. Context Engineering（延伸）

Presentation 层（本文）与 Model Context 层分离。上下文如何按阶段装配、避免话题污染、预算丢弃策略，见：

**[2026-08-06-agent-context-engineering-design.md](./2026-08-06-agent-context-engineering-design.md)**

要点摘要：

- **ContextPacket** 替代扁平 `canvas_context` 字符串
- **默认零 episodic**；仅指代/风格继承时注入历史
- **Topic switch** 时丢弃 prior atomic，parse prompt 显式声明「新任务」
- parse / plan / gen **分阶段配方**，不共用同一 history 块
