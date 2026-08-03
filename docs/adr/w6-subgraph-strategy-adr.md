# ADR-002: W6 Subgraph Strategy — Flat Gate Registration vs Nested LangGraph Subgraphs

| 字段 | 值 |
|------|-----|
| 状态 | Accepted |
| 日期 | 2026-08-03 |
| 决策人 | Graph Engineering（P1-03） |
| 关联 | graph-engineering-product-spec §3.7、§6；PR-P0-04 ~ P0-08 |

---

## 背景

产品规格 §3.7 描述「主图 6 高层节点 + 三个嵌套子图」的目标拓扑，并设 V2 验收为「主图边 ≤6」。当前实现（`app/graph/builder.py`）采用 **flat registration**：

- `register_confirm_gate` / `register_copy_gate` / `register_topo_gate` 将门区节点与边直接注册到**同一** `StateGraph(AgentRuntimeState)`
- 主图 `compile(interrupt_before=[await_confirm, await_copy_confirm, await_topo])`
- 各 gate 提供 `build_*_subgraph()` 仅用于**隔离 pytest**（`tests/test_subgraph_gates.py`），不参与生产 compile

规格与实现的差异导致 V2/V8 验收标准无法字面通过，需在架构层做显式决策。

---

## 决策

**维持 flat `register_*_gate` 模式（6A.2 折中），不升级为 LangGraph 嵌套子图 compile。**

---

## 理由

| 维度 | Flat（选定） | Nested 子图 |
|------|-------------|-------------|
| Checkpoint | 单一 `AgentRuntimeState`，Send-API gen 环与 HITL 共享 reducer | 需主/子 state 拆分与 merge，P0 state 瘦身后仍高成本 |
| W3 出图 | `gen_scheduler ⇄ gen_node → collect_gen` 已在主图 flat 边；V5 recovery 依赖 `gen_completed_keys` reducer | 嵌套 compile 对 Send 环 checkpoint 边界行为需重新验证 |
| 测试 | `build_topo_gate_subgraph()` 等已满足 V8「子图独立 pytest」 | 真嵌套也可测，但迁移面大 |
| 边数 | 物理边 >6，但**逻辑高层路径**仍为 6 段 | 物理边可减少，但 state 契约重写 |

**结论**：nested 子图收益（边计数、封装）不足以抵消 state 拆分与 gen/HITL 迁移风险；flat + 模块边界（`subgraphs/*.py`）为当前最优。

---

## 逻辑高层边（V2 验收对齐）

按用户可见控制流，主路径 **6 个高层段**（≤6）：

```
intake → confirm_gate* → split → copy_gate* → topo_gate* → done
```

\* gate 区内部多节点，但不改变用户感知的「阶段」数量。

**物理 LangGraph 边**（实现）远大于 6，包含 gate 内条件边与 gen 环；**不以物理边数作为 V2 阻塞项**。

---

## 实现约定（维持现状）

1. **注册**：仅 `builder.py` 调用 `register_*_gate`；禁止在主图重复 add 同名节点。
2. **Interrupt**：三门统一在主图 `interrupt_before` 列表配置。
3. **Isolation test**：各 `build_*_subgraph(checkpointer=MemorySaver())` 保留，作为 V8 验收载体。
4. **Gen 子图**：不采用 LangGraph Subgraph 包裹；`topo_gate` 内 `start_gen → gen_scheduler ⇄ gen_node → collect_gen` 保持 flat（与 spec §3.6 plan 节点「不嵌套子图」一致）。

---

## 后果

### 正面

- P0 state slimming / HITL / stage-commit 无需因 nested 迁移而重做
- V5 checkpoint recovery 测试（`test_gen_subgraph.py`）继续有效
- 新门区仍可通过新增 `register_*_gate` 文件扩展

### 负面

- Spec §3.7 嵌套 ASCII 图为**逻辑**而非 compile 结构，需在 spec errata 标注
- 主图物理边数无法用于静态「≤6」lint

---

## Spec errata（graph-engineering-product-spec）

| 原验收 | 修订 |
|--------|------|
| V2 主图边 ≤6 | **逻辑高层段 ≤6**（intake → confirm → split → copy → topo → done）；物理边允许 >6 |
| V8 三个子图独立 pytest | **`build_*_subgraph()` 编译体**独立 pytest 通过即可，不要求主图 nested compile |
| §3.7 嵌套子图图 | 标注为**逻辑分层**；实现见 `app/graph/subgraphs/` flat registration |

---

## 后续（不在本 ADR 范围）

- 若未来 state 稳定至 Tier A ≤18 且需 visual graph 边 ≤6 lint，再开 ADR-003 评估 nested + 主/子 state 拆分
- P3 单节点快速生成（S7）可走独立 `single_node_subgraph`，不强制改造 campaign 主图

---

## 参考

- `services/agent-runtime/app/graph/builder.py`
- `services/agent-runtime/app/graph/subgraphs/confirm_gate.py`
- `services/agent-runtime/app/graph/subgraphs/copy_gate.py`
- `services/agent-runtime/app/graph/subgraphs/topo_gate.py`
- `services/agent-runtime/tests/test_subgraph_gates.py`
