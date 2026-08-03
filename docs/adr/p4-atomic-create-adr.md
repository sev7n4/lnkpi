# ADR-003: P4 Atomic Studio Intent — Subgraph vs ReAct, Modality Defaults, Confirm Gate

| 字段 | 值 |
|------|-----|
| 状态 | Accepted |
| 日期 | 2026-08-03 |
| 决策人 | Graph Engineering（P4-01） |
| 关联 | [atomic-studio-intent-product-spec.md](../../.trae/documents/atomic-studio-intent-product-spec.md)、ADR-002（W6 flat gate） |

---

## 背景

用户期望 Agent 从自然语言驱动「新建画布节点 → 填入 prompt/content → Studio 生产 → 结果反馈」，覆盖 image/text/video/audio/prompt 五模态。现有能力：

- **Campaign**：多 HITL 门，不适合单句原子创作
- **P3 single_node**：依赖已有节点 + `focusNodeId`，不新建节点
- **chat**：无副作用
- **Harness**：Agent internal 仅 image/video；text/audio/prompt 仅在 Studio/Web

需在 P4 启动前锁定架构与产品默认值（D1/D2）。

---

## 决策

### 1. 控制流：独立 `atomic_create_gate` 子图（flat register，对齐 ADR-002）

**采用方案 A**：`intake` 路由 `flow_mode=atomic_create` → `register_atomic_create_gate` → `done`。

**不采用** chat ReAct tool loop 或每模态独立 Skill 包。

### 2. 模态默认值 D1 — 「分镜提示词」→ `text` 节点

| 用户表述 | `target_type` | 节点写入字段 |
|----------|---------------|--------------|
| 分镜提示词、分镜脚本、脚本、广告词、文案 | **`text`** | `data.content` |
| 显式「prompt 扩写 / 提示词模式 / 多模式扩写」 | `prompt` | `data.prompt` + Studio prompt 模式 |

「提示词」三字** alone** 不触发 `prompt` 节点（避免与分镜文案混淆）。

### 3. 高成本确认 D2 — video / audio 生成前 HITL

| 模态 | HITL |
|------|------|
| image, text, prompt | 无（单轮直达） |
| **video, audio** | **`await_atomic_confirm`**（`interrupt_before`） |

流程：`parse → create_canvas_node(draft) → await_atomic_confirm → run_atomic_generation`。

未确认 **不得** 调用 Studio（验收 A8）。

### 4. Intake 路由优先级

```
1. marketing_intent 且非纯原子句     → campaign (decide_plan_mode)
2. focus_node_id + single_node_gen   → single_node (P3)
3. atomic_create_intent              → atomic_create
4. else                              → chat
```

### 5. Harness 扩展（P4-02 执行，本 ADR 锁定契约）

新增 Nest internal：`run-text-generation`、`run-prompt-generation`、`run-audio-generation`；对齐 `run-image-generation` 返回 `{ status, url?, generationRecordId?, actions[] }`。

### 6. Stage 策略（继承 #114）

`await_topo` 期间若存在 pending stage，atomic 画布 mutation 使用 `stage=True`；独立会话默认 persist。

---

## 理由

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A atomic_create_gate** | 可 checkpoint、可测、与 P3 对称 | 需扩 Harness | **采用** |
| B ReAct in chat | 灵活 | 无统一 HITL/恢复，双栈 | 否 |
| C 每模态 Skill | 隔离 | 5× boilerplate | 否 |

D1/D2 来自产品确认：分镜产出是**可读正文**而非 prompt 模板；video/audio 积分高需确认。

---

## 实现约定

1. **模块**：`app/graph/subgraphs/atomic_create_gate.py` + `app/graph/nodes/atomic_*.py`
2. **State 字段**：`atomic_spec`, `atomic_node_id`, `atomic_record_id`, `phase=await_atomic_confirm`
3. **评测集**：`skills/atomic-create/eval-intent-set.yaml`（30 句，CI 校验 schema）
4. **Taxonomy**：`skills/atomic-create/intent-taxonomy.yaml`（路由与模态枚举）
5. **Flat 主图**：atomic gate 与 P3 `single_node_gate` 相同，仅 `register_*`，不 nested compile

---

## 后果

### 正面

- 用户侧栏单句即可建节点并生产
- video/audio 成本可控
- 与 Campaign/P3 路径正交，回归面清晰

### 负面 / 风险

- intake 路由复杂度上升 → 30 句评测集 + A7 误判率门槛
- text/audio Harness 需与 Studio 扣费/record 对齐
- `await_atomic_confirm` 为第四类 interrupt，Web 恢复 UI 需识别 `phase`

---

## 验收挂钩

| ADR 条目 | 规格验收 |
|----------|----------|
| D1 text 默认 | A7 评测集分镜句 gold=text |
| D2 confirm | A2b, A8 |
| 方案 A 子图 | A1, A2 |

---

## 后续 PR

| PR | 内容 |
|----|------|
| **P4-01** | 本 ADR + taxonomy + eval set（当前） |
| P4-02 | Harness text/audio/prompt |
| P4-03 | Graph atomic_create_gate + await_atomic_confirm |
| P4-04 | Prompt parse few-shot |
| P4-07 | prod-atomic-studio-verify.py |
