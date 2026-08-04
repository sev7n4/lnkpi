# Atomic Studio Intent — 意图驱动画布原子创作（设计）

> 状态：**P4 已交付**（2026-08-04）；**L1-03 atomic_regenerate ✅**（PR #122）  
> 日期：2026-08-03（v1.1）；2026-08-04（L1-03 修订）  
> 前置：[2026-07-26-graph-engineering-design.md](./2026-07-26-graph-engineering-design.md)、P3 单节点快速生成（#113）、Phase B/C（#114）  
> Loop 层：[2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md)

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.2 |
| 创建日期 | 2026-08-03 |
| 文档定位 | 跨六层工程栈的设计规格（指导 P4 迭代） |
| 关联 | [2026-07-26-graph-engineering-design.md](./2026-07-26-graph-engineering-design.md)、P3 单节点快速生成（#113）、Phase B/C 用户路径（#114） |
| 状态 | **P4 已交付** — atomic_create + L1-03 regenerate |

### 已确认决策（2026-08-03）

| # | 决策 | 说明 |
|---|------|------|
| **D1** | 「分镜提示词」默认 **`text` 节点** | 产出为脚本/正文，写入 `content`；**不**默认建 `prompt` 节点 |
| **D2** | **`video` / `audio` P4 即需生成前确认** | 建节点 + 预览 prompt 后 `interrupt_before await_atomic_confirm`；用户确认后再调 Studio |

**`prompt` 节点触发条件（D1 补充）**：仅当用户**显式**要求「prompt 扩写 / 提示词模式 / 多模式扩写」时，`target_type=prompt`。

---

## 一、需求摘要

### 1.1 用户期望（产品语言）

用户在 Agent 侧栏用**自然语言**描述想要的资产，Agent 应：

1. **理解意图**（模态 + 主题 + 约束）
2. **驱动画布**新建对应类型节点
3. **填入提示词/内容**并**提交 Studio 生产任务**
4. **将结果反馈**给用户（侧栏文案 + 画布节点终态 + 可选聚焦）

**示例**

| 用户输入 | 期望模态 | 期望行为 |
|----------|----------|----------|
| 「帮我生成一个模特人物图」 | `image` | 新建 image 节点 → 写 prompt → 出图 → 回传 url |
| 「帮我生成一个蓝牙耳机的分镜提示词」 | **`text`** | 新建 **text** 节点 → 写脚本正文 → `run-text-generation` → 回传 content |
| 「给这段文案配一段旁白」 | `audio` | 新建 audio 节点 → 写脚本 → **确认门** → TTS → 回传音频 url |
| 「做一个 15 秒产品展示视频」 | `video` | 新建 video 节点 → 写 prompt → **确认门** → 文生视频 → 回传 url |

### 1.2 与现有能力的关系

| 能力 | 现状 | 与本需求差异 |
|------|------|----------------|
| **Campaign 全链路** | plan → split → topo → 批量出图 | 多节点、多 HITL 门；非单句原子创作 |
| **P3 单节点快速生成** | 选中已有节点 +「快速生成这张」 | **不新建节点**；依赖 `focusNodeId` |
| **chat 分支** | 纯 LLM 回复，明确禁止擅自出图 | 无画布副作用 |
| **画布 Dock 手动** | 用户点 Dock 建节点 + Studio 生成 | 无 Agent 意图理解 |
| **Studio API** | image/video/text/audio/prompt 均已具备 | Agent Harness **仅暴露 image/video** 内部工具 |

**本需求 = 新 `flow_mode: atomic_create`**：从自然语言到「建节点 + 生产 + 反馈」的**单轮原子闭环**，不走 Campaign 三门。

### 1.3 非目标（P4 不做）

- 替代 Campaign 14 节点营销方案
- 多节点编排（如一次生成分镜 12 张）— 留给 Loop/Skill 扩展
- 自动连边/拓扑规划（除非用户明确「接到主图后面」）
- 前端全新 Studio 页改造
- 真实积分 UI 与 Dock 徽章对齐（可沿用现有扣费，验收以 record 为准）

---

## 二、六层工程拆解

### 2.1 Graph Engineering（控制流）

#### 2.1.1 设计原则（继承 G-P1~G-P12）

- **G-NEW-1**：原子创作是**独立子图**，不污染 Campaign 主图边数
- **G-NEW-2**：判定节点（意图分类）**不用 LLM 或仅用轻量 LLM**；副作用集中在 IO 节点
- **G-NEW-3**：**image / text / prompt** 原子流无 HITL；**video / audio** 在 P4 即设 **`await_atomic_confirm`** 生成前确认（D2）
- **G-NEW-4**：与 P3 `single_node` 并列，由 `intake` 路由

#### 2.1.2 主图路由（增量）

```
START → intake ─┬─ flow_mode=atomic_create → atomic_create_gate → done → END
                ├─ flow_mode=single_node   → prepare_single_gen → …（已有）
                ├─ skill_id + campaign     → decide_plan_mode → …（已有）
                └─ else                    → chat → END
```

#### 2.1.3 `atomic_create_gate` 子图

**低成本路径（image / text / prompt）— 5 节点**

| 节点 | 职责 | LLM | 副作用 |
|------|------|-----|--------|
| `parse_atomic_intent` | 抽取 `target_type`、title、prompt | 规则 + 可选 LLM | 否 |
| `create_canvas_node` | `add_nodes_batch` + 可选 `connect_nodes` | 否 | 是 |
| `run_atomic_generation` | 调 Harness 按模态生产 | 否 | 是 |
| `compose_atomic_reply` | AIMessage + task_summary | 否 | emit |

**高成本路径（video / audio）— 在 create 与 run 之间插入确认门（D2）**

```
parse → create_canvas_node → await_atomic_confirm ─┬─ confirm → run_atomic_generation → compose → done
                                                    └─ cancel  → compose（已建 draft 节点）→ done
```

| 节点 | 职责 |
|------|------|
| `await_atomic_confirm` | `interrupt_before`；展示节点 title、prompt 摘要、预估积分；等待「确认生成」/「取消」 |
| `preview_atomic_cost` | （可选）Nest 查询 modality 单次扣费，写入确认文案 |

**确认关键词**：`确认生成`、`开始生成`、`确认`（与 `CONFIRM_GEN_HINTS` 子集对齐，scope 限定 atomic 门）

**State 增量字段（Tier A）**

```python
flow_mode: Literal["campaign", "single_node", "atomic_create"] | None
atomic_spec: AtomicCreateSpec | None  # 见 2.6
atomic_node_id: str | None
atomic_record_id: str | None
phase: ... | "await_atomic_confirm"  # video/audio 确认门
user_decision: ... | "atomic_confirm" | "atomic_cancel"
```

#### 2.1.4 与 P3 的边界

| 维度 | P3 single_node | P4 atomic_create |
|------|----------------|------------------|
| 触发 | 选中节点 + 再生关键词 | 自然语言「帮我生成…」 |
| 画布 | 不新建 | **新建**节点 |
| focusNodeId | 必需 | 不需要 |
| 模态 | image/video | **五种** |

---

### 2.2 Loop Engineering（迭代语义）

#### 2.2.1 默认循环：Single-Shot + 可恢复

```
Goal: 用户一句指令 → 画布上出现完成态资产
Act:   parse → create → [video/audio: confirm] → generate
Observe: Studio record status / node data
Adjust:  recoverable 错误 → 重试（≤N）
Terminate: success | needs_user | hard_fail | atomic_cancel → compose_reply → done
```

**不做**多轮 Critic-Refiner（V2）；**不做** ReAct 无限工具循环（避免与 Graph 双栈）。

#### 2.2.2 错误分级（继承 G-P6）

| 级别 | 示例 | 行为 |
|------|------|------|
| recoverable | tool_timeout, downstream_unavailable | 重试 + SSE task_update |
| needs_user | fallback_pending, 积分不足 | force_choice + 节点 error 态 |
| hard_fail | param_error, permission_denied | 回复失败原因，不创建脏节点或标记 error |

#### 2.2.3 与 checkpoint 的关系

- 原子流 **单轮完成** 后 `phase=done`；失败也 `done` 并留 `last_error`
- 用户可说「再试一次」→ 新 thread turn，若 `atomic_node_id` 仍在 state 可走 **atomic_regenerate**（P4.2 可选）

**已实现（L1-03 ✅）**：`atomic_regenerate_intent` 检测 regenerate 关键词 + checkpoint 保留 `atomic_node_id`/`atomic_spec` → intake 路由 `flow_mode=atomic_regenerate` → `prepare_atomic_regenerate`（跳过 parse/create/confirm）→ 复用 `run_atomic_gen`。实现计划：[2026-08-04-atomic-regenerate.md](../plans/2026-08-04-atomic-regenerate.md)

---

### 2.3 Context Engineering（上下文组装）

#### 2.3.1 每次 LLM 调用（仅 parse 节点）应看到

| 块 | 来源 | 用途 |
|----|------|------|
| 用户原句 | messages[-1] | 主输入 |
| 会话摘要 | `get_canvas_summary` 节点数/类型统计 | 避免重复建 10 个「主图」 |
| 账户默认 | Nest account gen prefs | 默认 model/voice/ratio |
| 模态枚举 | 静态 schema | 约束 JSON 输出 |
| 近期 history | W17 窗口 | 指代消解「按刚才那个风格」 |

#### 2.3.2 不进入 Context 的内容

- 完整 canvas JSON（过大）
- Campaign plan_draft / split_manifest（atomic 路径不加载）

#### 2.3.3 Tool description 措辞（Harness 层暴露给未来 Tool-Agent 时）

统一动词：`create_{modality}_node`, `run_{modality}_generation`, `get_generation_result`

---

### 2.4 Prompt Engineering（单次推理模板）

#### 2.4.1 意图解析 Prompt（`parse_atomic_intent`）

**输出 JSON Schema（强制）**

```json
{
  "target_type": "image|text|video|audio|prompt",
  "title": "节点标题，≤20字",
  "prompt": "送入 Studio 的完整提示词",
  "confidence": 0.0,
  "reason": "一句话分类依据"
}
```

**Few-shot 要点（含 D1）**

- 「模特人物图」→ `image`
- 「**分镜提示词**」「分镜脚本」「脚本」「广告词」「文案」→ **`text`**（默认，D1）
- 「**prompt 扩写**」「提示词模式」「多模式扩写」→ `prompt`（显式才用 prompt 节点）
- 「旁白」「配音」→ `audio`（**走确认门**）
- 「视频」「动效」→ `video`（**走确认门**）
- 含「详情页」「营销方案」「14 个节点」→ **reject** → Campaign

#### 2.4.2 规则层（先于 LLM）

```python
ATOMIC_CREATE_HINTS = (
    "帮我生成", "帮我做一张", "生成一个", "生成一张", "做一个",
    "来一张", "来一段", "写一段", "配一段", "扩写",
)
MARKETING_OVERRIDE = marketing_intent(text) and not is_atomic_phrase(text)
```

**路由优先级**

1. `marketing_intent` 且非纯原子句 → Campaign
2. `focus_node_id` + `single_node_gen_intent` → P3
3. `atomic_create_intent` → atomic_create
4. else → chat

#### 2.4.3 回复模板（`compose_atomic_reply`）

成功：`已在画布创建「{title}」({target_type})，生成完成。{可选：url 摘要}`

失败：`创建节点成功但生成失败：{reason}。可在画布点击节点重试。`

---

### 2.5 Harness Engineering（工具与 IO）

#### 2.5.1 现状 Gap

| 模态 | Studio | Agent internal API | gen_node |
|------|--------|-------------------|----------|
| image | ✅ | ✅ run/start/wait image | ✅ |
| video | ✅ | ✅ run video | ✅ |
| text | ✅ | ❌ | ❌ |
| audio | ✅ | ❌ | ❌ |
| prompt | ✅ | ❌ | ❌ |

#### 2.5.2 新增 Internal API（Nest `agent-canvas-tools`）

| 端点 | 行为 |
|------|------|
| `POST /agent/internal/run-text-generation` | 调 `studio.generateText`，persist 节点 content + generationRecordId |
| `POST /agent/internal/run-prompt-generation` | 调 `studio.generatePrompt`，写 prompt 节点 data |
| `POST /agent/internal/run-audio-generation` | 调 `studio.generateAudio`，写 url + recordId |

契约：对齐现有 `run-image-generation` 模式（start/wait 或 sync），返回 `{ status, url?, generationRecordId?, actions[] }`。

#### 2.5.3 画布写入策略

| 场景 | stage | 说明 |
|------|-------|------|
| 会话无 pending stage | `persist` 直接写 | 与手工 Dock 一致 |
| 会话在 Campaign await_topo | `stage=True` | 继承 #114 教训 |
| atomic 独立会话 | 默认 persist | 简化 MVP |

`create_canvas_node` 使用已有 `add_nodes_batch` + `modalityDefaults`。

#### 2.5.4 权限与扣费

- 走 Studio 既有 `points.consume`
- Agent 仅 service-token 调 Nest；积分不足 → `needs_user` + 侧栏提示

---

### 2.6 数据契约

#### 2.6.1 `AtomicCreateSpec`（TypedDict / Pydantic）

```python
class AtomicCreateSpec(TypedDict):
    target_type: Literal["image", "text", "video", "audio", "prompt"]
    title: str
    prompt: str
    model: str | None          # 可选，来自 Agent dock model
    connect_to: str | None     # 可选 node_id 连边
```

#### 2.6.2 Web → Nest → Runtime

现有 `POST /api/agent/chat/conversation` **无需新端点**；可选扩展：

```typescript
// 可选 V2：显式原子模式，避免误判
atomicMode?: 'auto' | 'image' | 'text' | ...
```

MVP 仅靠消息意图识别，不增加 UI 字段。

#### 2.6.3 SSE 事件

沿用：`canvas_action`, `node_status`, `task_update`, `task_summary`, `text_delta`, `done`

新增可选：`atomic_created` `{ nodeId, targetType, title }`（便于前端聚焦）

---

## 三、端到端用户路径

### 3.1 路径 A — 空白会话原子出图

```
用户：帮我生成一个模特人物图
  → intake: atomic_create
  → 画布出现 image 节点（generating → completed）
  → 侧栏：「已创建模特人物图，生成完成」
  → 画布自动 focus 新节点（Web 可选）
```

### 3.2 路径 B — 分镜文案（D1：text 节点）

```
用户：帮我生成一个蓝牙耳机的分镜提示词
  → target_type=text（固定默认，不因「提示词」三字改为 prompt）
  → 新建 text 节点 → run-text-generation
  → 节点 data.content 写入分镜正文
  → 侧栏展示摘要 + 画布可编辑
```

### 3.3 路径 B2 — 高成本模态（D2：生成前确认）

```
用户：做一个 15 秒蓝牙耳机展示视频
  → parse → create video 节点（draft）
  → interrupt await_atomic_confirm
  → 侧栏：「将生成视频，预估消耗 N 积分。回复「确认生成」继续。」
  → 用户：确认生成
  → run-video-generation → url 回写
```

audio 路径同理。

### 3.4 路径 C — Campaign 进行中（边界）

```
用户已在 await_topo，说：「帮我生成一个模特人物图」
  → 必须 atomic_create，且 add_nodes_batch(stage=True)
  → 不触发 topo_revise / confirm_gen
```

### 3.5 与选中节点共存

- 有 `focusNodeId` 且句意是「生成这张」→ P3
- 句意是「帮我生成一个新的…」→ atomic_create（**新建**，忽略 focus）

---

## 四、验收标准

| 编号 | 标准 | 验证 |
|------|------|------|
| **A1** | 5 种模态各至少 1 条生产 E2E PASS | `deploy/prod-atomic-studio-verify.py` |
| **A2** | image/text/prompt 不触发 Campaign 三门 | thread-state |
| **A2b** | video/audio 仅触发 **`await_atomic_confirm`**，不触发 await_topo | thread-state + interrupt SSE |
| **A3** | 画布新节点含 generationRecordId 或 content/url | GET session |
| **A4** | 「天猫详情页营销方案」仍走 Campaign | 回归 Phase A |
| **A5** | P3 单节点再生仍 PASS | 回归 prod-single-node-gen |
| **A6** | 积分不足可理解失败 | 模拟或 staging |
| **A7** | 意图误判率 <10%（30 句评测集；分镜句 gold=`text`） | 评测集 |
| **A8** | video/audio 未确认时不调用 Studio | 集成测试 + 生产脚本 |

---

## 五、迭代计划（P4 Backlog）

### 5.1 总览

| 优先级 | PR | 主题 | 依赖 |
|--------|-----|------|------|
| **P4-01** | ADR + 意图 taxonomy + 评测集 30 句 | — |
| **P4-02** | Harness：text/audio/prompt internal API + 契约 CI | P4-01 |
| **P4-03** | Graph：`atomic_create_gate` + **`await_atomic_confirm`**（video/audio）+ intake 路由 | P4-01 |
| **P4-04** | Prompt：parse template + few-shot YAML | P4-03 |
| **P4-05** | Context：canvas summary 注入 parse | P4-03 |
| **P4-06** | Web：atomic_created 聚焦 + 侧栏示例 chip | P4-03 |
| **P4-07** | 生产验证脚本 + Phase A/B/C 回归 | P4-02~06 |

### 5.2 建议 Sprint 顺序

```
Week 1: P4-01 ADR + P4-02 Harness（image 已有，先 text/prompt）
Week 2: P4-03 Graph MVP（image + text）+ P4-04 Prompt
Week 3: P4-02 补齐 audio/video + P4-05 Context + P4-06 Web
Week 4: P4-07 生产复测 + 误判集迭代
```

### 5.3 关键文件（预期）

| 层 | 文件 |
|----|------|
| Graph | `app/graph/intent.py`, `app/graph/subgraphs/atomic_create_gate.py`, `app/graph/builder.py` |
| Harness | `agent-canvas-tools.service.ts`, `nest_client.py`, `contract.py`, `agentContract.ts` |
| Prompt | `skills/atomic-create/few-shots.yaml`, `app/graph/nodes/atomic_parse.py` |
| 验证 | `deploy/prod-atomic-studio-verify.py` |

---

## 六、方案对比（ADR 摘要）

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **A（推荐）** | 新 `atomic_create_gate` 子图，与 P3 对称 | 可测、可 checkpoint、符合 G-P3 | 每模态要接 Harness | **采用** |
| B | 扩展 chat 为 ReAct tool loop | 灵活 | 难 HITL/恢复，与 Graph 栈重复 | 否 |
| C | 每模态独立 Skill 包 | 隔离 | 5 套重复 boilerplate | 否（V2 可抽 shared skill） |

---

## 七、Observability（简要）

- Span：`atomic_create.parse` → `create_node` → `run_generation`
- Metrics：`atomic_create_total{modality,status}`
- 日志：记录 `atomic_spec`（脱敏 prompt 前 80 字）

---

## 八、风险与剩余开放问题

| 项 | 说明 | 状态 |
|----|------|------|
| text vs prompt | 分镜/脚本 → **text**；显式扩写 → prompt | ✅ D1 已锁定 |
| 高成本确认 | video/audio 生成前确认 | ✅ D2 已锁定 |
| 连边 | 「接到主图后」 | P4.2 可选 `connect_to` |
| chat 边界 | 「帮我写一句 slogan」 | 短文案 → atomic text；纯闲聊 → chat |

---

## 九、文档衔接

```
本文档 (Atomic Studio Intent)
    ├─→ 2026-07-26-graph-engineering-design.md （G 层原则、State 预算）
    ├─→ 2026-08-04-loop-engineering-design.md （L1 ✅：重试/终止/regenerate）
    ├─→ context-engineering-product-spec.md （待建 C1：summary 注入）
    ├─→ prompt-engineering-product-spec.md （待建 P1：parse few-shot）
    └─→ harness-engineering-product-spec.md （待建 H1：internal API 矩阵）
```

---

## 十、下一步

1. ~~评审模态边界与确认门~~（D1/D2 已确认）
2. **启动 P4-01**：ADR + 30 句评测集（分镜句 label=`text`；含 5 句 video/audio 确认路径）
3. **P4-02 + P4-03 并行**：Harness text API + Graph（含 `await_atomic_confirm`）
4. MVP 交付顺序：**text + image** → **audio + video（带确认门）** → prompt 节点
