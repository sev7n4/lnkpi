# Atomic Intent Hybrid — 分阶段需求规格（Phase 1–4）

> 状态：**Draft**（2026-08-04）  
> 日期：2026-08-04  
> 前置：[2026-08-03-atomic-studio-intent-design.md](./2026-08-03-atomic-studio-intent-design.md)（P4）、[2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md)（L1）  
> 实施计划：[2026-08-04-atomic-intent-hybrid-phases.md](../plans/2026-08-04-atomic-intent-hybrid-phases.md)

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.0 |
| 创建日期 | 2026-08-04 |
| 文档定位 | 原子 Studio 意图识别从「关键词子串」升级为「Hybrid 分层识别」的产品与技术规格 |
| 动机 | 生产复测暴露：regenerate/create 子串冲突、多图请求单节点、变体句式覆盖不足 |

---

## 一、问题陈述

### 1.1 现状（P4 + L1-03 已交付）

| 组件 | 实现方式 | 局限 |
|------|----------|------|
| **intake 路由** | `marketing_intent` / `single_node_gen_intent` / `atomic_create_intent` / `atomic_regenerate_intent` 关键词 | 子串互斥（如「生成一张」⊂「重新生成一张」）；`resolve_intake_route` 不感知 checkpoint |
| **parse** | `build_atomic_spec_enriched` 规则 + prefix strip | 无 LLM；多 item 仅靠硬编码正则；整句作 prompt |
| **create/gen** | 单 `atomic_spec` + 单 `atomic_node_id` | 一次请求只能 1 节点 1 次生成（除非临时 patch `atomic_items`） |
| **评测** | `eval-intent-set.yaml` 30 句 | 无 regenerate / multi-image / 子串陷阱 gold case |

### 1.2 用户期望

用户在 Agent 侧栏用**自然语言变体**描述需求时，系统应：

1. **正确选路**：Campaign / P3 单节点 / atomic 新建 / atomic 重生成 / chat
2. **正确结构**：单条 vs 多条资产（如 3 张不同用途的图）
3. **正确模态**：image / text / video / audio / prompt（含 D1/D2）
4. **正确 payload**：每条资产有独立 `title` + `prompt`，而非整句原文
5. **低置信澄清**：歧义时追问，不擅自建节点或走错链路

### 1.3 非目标（四阶段整体）

- 替代 Campaign 14 节点营销全链路
- 在 atomic_create 内实现 12+ 节点分镜编排（属 Phase 4 Loop/Campaign 扩展）
- ReAct 无限工具循环
- 前端 Studio 大改

---

## 二、目标架构：四层意图模型

将「意图识别」拆为四个**正交维度**，每层独立评测、独立演进：

```
用户输入 + checkpoint + 画布摘要 + 近期 history
        │
        ▼
┌───────────────────────────────────────────────────┐
│ L1 路由层 (flow_mode)                              │
│ campaign | single_node | atomic_regenerate         │
│          | atomic_create | chat                    │
└───────────────────────────────────────────────────┘
        │ atomic_create / regenerate
        ▼
┌───────────────────────────────────────────────────┐
│ L2 结构层 (structure)                              │
│ single | multi (items[])                           │
└───────────────────────────────────────────────────┘
        ▼
┌───────────────────────────────────────────────────┐
│ L3 模态层 (target_type)                            │
│ image | text | video | audio | prompt              │
└───────────────────────────────────────────────────┘
        ▼
┌───────────────────────────────────────────────────┐
│ L4 抽取层 (title, prompt per item)                 │
└───────────────────────────────────────────────────┘
```

### 2.1 L1 路由优先级（有 checkpoint 时 regenerate 优先）

| 优先级 | 条件 | `flow_mode` |
|--------|------|-------------|
| 1 | `marketing_intent` 且非纯原子句 | `campaign` |
| 2 | `focus_node_id` + `single_node_gen_intent` + 非 modify | `single_node` |
| 3 | **有** `atomic_node_id` + `atomic_spec` + regenerate 意图 | `atomic_regenerate` |
| 4 | atomic 新建意图 | `atomic_create` |
| 5 | else | `chat` |

> **决策 I-1**：L1 以**规则高置信 fast path + checkpoint 门控**为主；Phase 2 起 LLM 仅辅助 L2–L4，不直接决定 flow_mode（避免 Graph 双栈）。

### 2.2 数据契约增量

```python
# Phase 1 起：multi 为一等公民
atomic_items: list[AtomicCreateSpec] | None  # 每项含 target_type, title, prompt, confirm_gate
# create 后每项附加 node_id

class AtomicParseResult(TypedDict):
    flow_mode: Literal["atomic_create", "atomic_regenerate", "clarify"]
    structure: Literal["single", "multi"]
    items: list[AtomicCreateSpec]
    confidence: float  # Phase 2+
    reason: str        # Phase 2+，日志/调试
    clarify_question: str | None  # Phase 2+，confidence < 阈值时
```

### 2.3 Hybrid 执行策略

| 置信度 | 行为 |
|--------|------|
| 规则 ≥ 0.95 | 跳过 LLM，直接输出 |
| 0.70 ≤ 规则 < 0.95 | LLM 校验/补全（Phase 2） |
| LLM ≥ 0.70 | 采纳 LLM 结构化结果 |
| < 0.70 | `clarify` — 侧栏追问，**不**建节点（Phase 2） |

---

## 三、Phase 1 — 规则层加固与评测闭环

### 3.1 目标

在不引入 LLM 的前提下，消除**已知生产 bug 类**，建立可回归的 gold 评测集，为多图提供**有限但可靠**的结构解析。

### 3.2 需求

| ID | 需求 | 验收 |
|----|------|------|
| P1-R1 | regenerate hint 与 create hint **互斥表**；create 遇 regenerate 短语提前 false | 「重新生成一张」→ regenerate，非 create |
| P1-R2 | intake：**有 checkpoint 时 regenerate 优先于 create** | 同上 + 「再试一次」 |
| P1-R3 | `atomic_regenerate_intent` 不再被 create 子串误杀 | 子串陷阱用例全 pass |
| P1-R4 | multi-image：**N张图 + 枚举**（分别是/分别为/包括/冒号列表）→ `atomic_items` | 三图用例 → 3 节点 3 次 gen |
| P1-R5 | `create_atomic_node` / `run_atomic_gen` 支持 `atomic_items` 批量 | batch add + 顺序 gen |
| P1-R6 | 扩展 `eval-intent-set.yaml` 至 **≥50 句**，含 regenerate/multi/陷阱 | CI 100% gold pass |
| P1-R7 | 更新 `intent-taxonomy.yaml` intake_priority 含 regenerate 路由 | taxonomy 与代码一致 |

### 3.3 明确不做（Phase 1）

- LLM parse
- 「主图、白底、三视图各一张」无数量词句式
- 跨模态 multi（如 1 图 + 1 文案同句）

### 3.4 验收门槛

- `pytest tests/test_atomic*.py` 全绿
- eval 集新增 case **100% pass**
- prod smoke：regenerate 两回合 + 三图枚举各 PASS

---

## 四、Phase 2 — LLM Structured Parse（Hybrid 兜底）

### 4.1 目标

规则无法覆盖的自然语言变体，由**轻量 LLM + JSON Schema + few-shot** 结构化解析；低置信时**澄清**而非误判。

### 4.2 需求

| ID | 需求 | 验收 |
|----|------|------|
| P2-R1 | `parse_atomic_intent` 节点：**规则 fast path → LLM fallback** | 规则命中零 LLM 调用（可测 mock） |
| P2-R2 | LLM 输出强制 schema：`structure`, `items[]`, `confidence`, `reason` | schema 校验失败 → clarify |
| P2-R3 | few-shots 扩至 **≥20 对**（含 multi/regenerate 负例/变体） | few-shot 加载测试 pass |
| P2-R4 | `confidence < 0.70` → `phase=clarify`，AIMessage 追问，**interrupt 或 done 无副作用** | 歧义句不建节点 |
| P2-R5 | post-validator：marketing 词 override → 拒绝 atomic；items 数量与数量词一致性检查 | 营销方案句不走 atomic |
| P2-R6 | eval 集扩至 **≥80 句** + **变体生成脚本**（同义改写 smoke） | CI 误判率 < 5% |
| P2-R7 | 可观测：日志记录 `confidence` + `reason`（prompt 脱敏前 80 字） | 结构化 log 字段 |

### 4.3 LLM 调用约束（G-NEW-2）

- **仅** `parse_atomic_intent` 节点可调用 LLM
- 输入：`user utterance` + `canvas_context` 一行摘要 + 模态枚举
- 输出：JSON only，temperature ≤ 0.2
- 超时/失败：**回退**规则 parse，不 crash graph

### 4.4 明确不做（Phase 2）

- 多轮 Critic-Refiner
- LLM 决定 intake flow_mode
- 自动连边/拓扑

### 4.5 验收门槛

- 80 句 eval **≥95%** route + target_type 正确
- LLM fallback 延迟 P95 < 3s（生产 agent-runtime）
- clarify 路径 E2E：用户收到追问且无 canvas 副作用

---

## 五、Phase 3 — 上下文感知与指代消解

### 5.1 目标

利用 **checkpoint、画布摘要、focus 节点、近期对话**，解析指代与风格继承，减少「重复建同名节点」和「丢失上文语义」。

### 5.2 需求

| ID | 需求 | 验收 |
|----|------|------|
| P3-R1 | parse context 块：`canvas_summary`（已有）+ **最近 2 轮 human/ai 摘要** | context 注入单测 |
| P3-R2 | 指代词（这个/这张/该/刚才/同样风格）+ `focus_node_id` → seed prompt/title | 「扩写这个主图 prompt」用例 |
| P3-R3 | regenerate 时可带 **adjust 短语**（「换个风格」「背景改成白色」）→ 更新 `atomic_spec.prompt` 再 gen | L1-04 adjust 扩展 |
| P3-R4 | dedupe：`atomic_items` 每项独立 dedupe title（已有 P4-05 逻辑扩展） | 画布已有「主图」→ 「主图 (2)」 |
| P3-R5 | multi-image **无「分别是」**变体由 LLM 解析（依赖 P2） | 「主图、白底和三视图各来一张」→ 3 items |
| P3-R6 | thread 污染防护：atomic turn 不加载 Campaign `plan_draft` / `split_manifest` | Campaign 混合画布复测 PASS |

### 5.3 明确不做（Phase 3）

- 完整 canvas JSON 进 context
- 跨 session 长期记忆

### 5.4 验收门槛

- 指代用例集 **≥15 句，100% pass**
- Campaign + atomic 同 thread 两回合无 plan 泄漏
- prod：「按刚才那个风格再生成一张」PASS

---

## 六、Phase 4 — Loop 扩展与复杂编排分流

### 6.1 目标

**大于 atomic 能力边界**的请求（多分镜批量、拓扑依赖、营销全案）**显式分流**到 Campaign 或专用 Loop Skill，而非在 atomic_create 内堆逻辑。

### 6.2 需求

| ID | 需求 | 验收 |
|----|------|------|
| P4-R1 | **编排复杂度分类器**（规则+LLM）：节点数 ≥4 或含「分镜 N 个镜头」「全链路」「详情页方案」→ suggest Campaign | 12 张分镜句 → campaign 或 clarify |
| P4-R2 | atomic multi 上限：**≤5 个同模态 item**；超出 → clarify 或 suggest Campaign | 6 图请求不 silent 截断 |
| P4-R3 | Loop LC-6：**atomic_multi_gen** — items 顺序 gen + 部分失败 compose（继承 L-P3 retry 语义） | 3 图 1 失败 → 部分成功文案 |
| P4-R4 | 可选 **atomic_batch_confirm**：multi + video/audio 混合时统一确认门 | 混合模态 HITL |
| P4-R5 | 与 Campaign split 边界文档化 + eval case | ADR 更新 |
| P4-R6 | prod smoke：`deploy/prod-atomic-intent-verify.py` 覆盖 Phase 1–3 回归 + Phase 4 分流 | 脚本 ≥12 case |

### 6.3 分流决策表

| 用户表达 | 推荐路径 |
|----------|----------|
| 1–5 张明确枚举图 | `atomic_create` multi |
| 6+ 张 / 分镜 12 镜头 / 详情页 14 节点 | `campaign` |
| 选中节点 +「快速生成这张」 | `single_node` (P3) |
| 同 thread 再试 | `atomic_regenerate` |
| 意图不明 | `clarify` → chat |

### 6.4 验收门槛

- 编排分流 eval **≥20 句，100%** 正确 route
- multi 部分失败 E2E 有明确侧栏反馈
- 无「atomic 路径 silent 建 1 节点糊弄 multi 请求」回归

---

## 七、评测与 CI 策略（跨 Phase）

### 7.1 资产

| 资产 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|
| `eval-intent-set.yaml` | 50 | 80 | 95 | 110+ |
| `eval-intent-regression.yaml` | 生产 bug 反哺 | +LLM 变体 | +指代 | +分流 |
| `deploy/prod-atomic-intent-verify.py` | 基础 smoke | +clarify | +指代 | +分流 |

### 7.2 CI 门槛演进

| Phase | pytest | eval gold | 误判率 |
|-------|--------|-----------|--------|
| 1 | atomic* 全绿 | 100% | — |
| 2 | + parse LLM mock | ≥95% | <5% |
| 3 | + context | ≥95% | <3% |
| 4 | + orchestration | ≥95% | <3% |

### 7.3 生产 bug 反哺流程

1. 用户反馈 utterance + 期望行为
2. 加入 `eval-intent-regression.yaml`（先红后绿）
3. 修复 + PR + prod smoke
4. 关闭跟踪项

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| 规则与 LLM 结论冲突 | post-validator；冲突 → clarify |
| LLM 延迟 | fast path 覆盖高频 30 句；异步不阻塞 intake |
| thread 污染 | atomic 路径不 hydrate campaign state |
| multi 部分失败 UX | compose 汇总；节点级 error 态 |
| 范围蔓延 | Phase 4 强制分流，atomic multi cap=5 |

---

## 九、阶段依赖

```
Phase 1（规则+评测+multi 基础）
    ↓
Phase 2（LLM hybrid + clarify）
    ↓
Phase 3（context + 指代 + adjust regenerate）
    ↓
Phase 4（编排分流 + Loop multi + 上限）
```

每 Phase **独立可交付**：完成后生产可测，不依赖下一 Phase 上线。

---

## 十、关联文档更新清单

| Phase | 需更新 |
|-------|--------|
| 1 | `intent-taxonomy.yaml`, `eval-intent-set.yaml`, P4 spec §1.3 非目标脚注 |
| 2 | P4 spec §2.4 parse LLM, few-shots.yaml, ADR-003 |
| 3 | Loop spec LC-4 adjust, P4 spec §2.3 context |
| 4 | Loop spec LC-6, ADR 编排边界, deploy smoke |
