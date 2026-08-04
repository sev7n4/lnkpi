# Atomic Intent Hybrid — Phase 1–4 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 atomic Studio 意图识别从关键词子串升级为 Hybrid 四层模型（路由 / 结构 / 模态 / 抽取），分四阶段交付可测增量。

**Architecture:** Phase 1 纯规则+评测闭环；Phase 2 在 `parse_atomic_intent` 引入 LLM JSON fallback + clarify；Phase 3 注入 context/指代/adjust regenerate；Phase 4 编排复杂度分流 + Loop multi 上限与部分失败 compose。L1 路由始终由 Graph intake 决定，LLM 不直接改 flow_mode。

**Tech Stack:** LangGraph (Python 3.11+), pytest, YAML eval sets, Nest Harness (`add_nodes_batch`, `run_*_generation`), optional LLM via existing agent-runtime LLM client.

**Spec:** [2026-08-04-atomic-intent-hybrid-design.md](../specs/2026-08-04-atomic-intent-hybrid-design.md)

## Global Constraints

- Branch per phase from `main`: `feature/atomic-intent-p{N}-...` — **never push to main directly**.
- Pre-PR: `cd services/agent-runtime && python -m pytest tests/test_atomic*.py -v` 全绿；涉及 TS 时 `pnpm build`。
- Squash merge；合并后 `deploy-agent-runtime.yml` 自动部署 CVM。
- L1 路由：`atomic_regenerate` 需 checkpoint（`atomic_node_id` + `atomic_spec`）；无 checkpoint 的 regenerate 短语 → chat/clarify，不建节点。
- LLM 仅允许在 `parse_atomic_intent` 节点调用（Phase 2+）；temperature ≤ 0.2；失败回退规则 parse。
- eval 集只增不删 gold；生产 bug 先入 `eval-intent-regression.yaml` 再修代码。
- Commit per task；每 Phase 独立 PR。

## File map（跨 Phase）

| File | Phase | Role |
| --- | --- | --- |
| `app/graph/atomic_intent.py` | 1–3 | L1 路由、hint 互斥、复杂度分类（4） |
| `app/graph/atomic_parse_util.py` | 1–3 | L2–L4 规则 parse、multi split、context |
| `app/graph/atomic_parse_llm.py` | 2 | **NEW** LLM structured parse + validator |
| `app/graph/nodes/intake.py` | 1 | checkpoint 优先 regenerate |
| `app/graph/nodes/atomic_parse.py` | 1–2 | hybrid parse 编排 |
| `app/graph/nodes/atomic_create_node.py` | 1 | multi `add_nodes_batch` |
| `app/graph/nodes/run_atomic_gen.py` | 1, 4 | multi gen + 部分失败 compose |
| `app/graph/nodes/clarify_atomic_intent.py` | 2 | **NEW** 低置信追问 |
| `app/graph/nodes/adjust_atomic_regenerate.py` | 3 | **NEW** regenerate + prompt 微调 |
| `app/graph/subgraphs/atomic_create_gate.py` | 2–3 | 注册 clarify/adjust 边 |
| `app/graph/state.py` | 1–2 | `atomic_items`, `parse_confidence` |
| `skills/atomic-create/intent-taxonomy.yaml` | 1–4 | hints、priority、multi cap |
| `skills/atomic-create/eval-intent-set.yaml` | 1–4 | gold 集 |
| `skills/atomic-create/eval-intent-regression.yaml` | 1 | **NEW** 生产 bug 集 |
| `skills/atomic-create/assets/few-shots.yaml` | 2 | parse LLM few-shots |
| `tests/test_atomic_*` | 1–4 | 单测 + eval |
| `deploy/prod-atomic-intent-verify.py` | 1, 4 | 生产 smoke |

---

# Phase 1 — 规则层加固与评测闭环

**PR 标题建议:** `fix(agent): atomic intent phase1 — hint mutual exclusion, multi-image, eval`

**预计：** 2–3 天 | **依赖：** 无

---

### Task P1-1: Hint 互斥与 regenerate 路由

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_intent.py`
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/skills/atomic-create/intent-taxonomy.yaml`
- Create: `services/agent-runtime/tests/test_atomic_regenerate_intent.py`（若不存在则扩写）

**Interfaces:**
- Produces: `_matches_regenerate_hints(text) -> bool`
- Produces: `atomic_create_intent` 遇 regenerate 短语返回 False
- Produces: intake `has_atomic_checkpoint and atomic_regenerate_intent` **先于** `is_atomic`

- [ ] **Step 1: 写失败测试**

```python
def test_regenerate_phrase_not_create():
    assert not atomic_create_intent("重新生成一张")
    assert atomic_regenerate_intent("重新生成一张")

@pytest.mark.asyncio
async def test_intake_regenerate_before_create_with_checkpoint():
    out = await intake({
        "messages": [HumanMessage(content="重新生成一张")],
        "atomic_node_id": "n1",
        "atomic_spec": {"target_type": "image", "prompt": "模特人物图", "title": "模特图"},
    })
    assert out["flow_mode"] == "atomic_regenerate"
```

- [ ] **Step 2:** 实现 `_matches_regenerate_hints`；更新 taxonomy `intake_priority` 增加 regenerate 条目
- [ ] **Step 3:** `pytest tests/test_atomic_regenerate_intent.py tests/test_atomic_create_intent.py -v`
- [ ] **Step 4:** Commit `fix(agent): mutual-exclude regenerate hints from atomic create`

---

### Task P1-2: Multi-image 结构解析（规则）

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_parse_util.py`
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`
- Modify: `services/agent-runtime/tests/test_atomic_parse_util.py`

**Interfaces:**
- Produces: `parse_atomic_multi_items(utterance) -> list[dict] | None`
- Produces: `build_atomic_items_enriched(...) -> list[dict] | None`
- Consumes: `parse_atomic_target_type` 必须为 image

- [ ] **Step 1: 写失败测试**

```python
def test_parse_three_images_enumerated():
    u = "帮我生成三张图，分别是蓝牙耳机主图、白底图、三视图。"
    items = parse_atomic_multi_items(u)
    assert items and len(items) == 3
    assert [i["prompt"] for i in items] == ["蓝牙耳机主图", "白底图", "三视图"]
```

- [ ] **Step 2:** 实现 N张图 + 分别是/分别为/包括/冒号列表 解析；count 与 items 长度校验
- [ ] **Step 3:** `atomic_parse` 有 multi 时写 `atomic_items` + 汇总 AIMessage
- [ ] **Step 4:** Commit `feat(agent): parse enumerated multi-image atomic requests`

---

### Task P1-3: Multi create + multi gen

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/atomic_create_node.py`
- Modify: `services/agent-runtime/app/graph/nodes/run_atomic_gen.py`
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/tests/test_atomic_create_subgraph.py`

- [ ] **Step 1: 写失败测试** — 3 items → `add_nodes_batch` len=3 → `run_image_generation` ×3
- [ ] **Step 2:** create 回填每项 `node_id`；gen 顺序执行并汇总 AIMessage
- [ ] **Step 3:** `pytest tests/test_atomic_create_subgraph.py -v`
- [ ] **Step 4:** Commit `feat(agent): batch atomic create and sequential gen`

---

### Task P1-4: 扩展 eval 集 + regression 文件

**Files:**
- Modify: `services/agent-runtime/skills/atomic-create/eval-intent-set.yaml`（50 句）
- Create: `services/agent-runtime/skills/atomic-create/eval-intent-regression.yaml`
- Modify: `services/agent-runtime/tests/test_atomic_create_intent_eval.py`

**新增 gold case 类别（至少各 3 句）：**
- regenerate（需 mock checkpoint 测 route _fn，或在 intake 集成测测）
- multi-image 枚举
- 子串陷阱（重新生成/确认生成/生成一张）
- campaign 边界

- [ ] **Step 1:** 添 case 先红
- [ ] **Step 2:** 代码通过后全绿
- [ ] **Step 3:** Commit `test(agent): expand atomic intent eval to 50 cases`

---

### Task P1-5: Prod smoke

**Files:**
- Create: `deploy/prod-atomic-intent-verify.py`（或扩展现有 regenerate verify）

- [ ] **Step 1:** Turn1 模特图 → Turn2「重新生成一张」→ 同 prompt
- [ ] **Step 2:** 三图枚举 → 侧栏含 3 节点完成文案
- [ ] **Step 3:** Commit + PR + CI + squash merge + 验证 deploy-agent-runtime

**Phase 1 完成标准：** 规格 P1-R1~R7 全部满足；prod smoke PASS。

---

# Phase 2 — LLM Structured Parse

**PR 标题建议:** `feat(agent): atomic intent phase2 — hybrid LLM parse and clarify`

**预计：** 4–5 天 | **依赖：** Phase 1 merged

---

### Task P2-1: Parse result schema 与 validator

**Files:**
- Create: `services/agent-runtime/app/graph/atomic_parse_schema.py`
- Create: `services/agent-runtime/tests/test_atomic_parse_schema.py`

**Interfaces:**
- Produces: `AtomicParseResult` TypedDict
- Produces: `validate_parse_result(data: dict) -> AtomicParseResult | ClarifyResult`
- Produces: `merge_rule_and_llm(rule_items, llm_items) -> AtomicParseResult`

- [ ] **Step 1:** JSON schema 单测（缺字段、非法 target_type、items 空）
- [ ] **Step 2:** marketing override post-check
- [ ] **Step 3:** Commit `feat(agent): atomic parse result schema and validator`

---

### Task P2-2: LLM parse 节点

**Files:**
- Create: `services/agent-runtime/app/graph/atomic_parse_llm.py`
- Modify: `services/agent-runtime/skills/atomic-create/assets/few-shots.yaml`（≥20 对）
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`

**Interfaces:**
- Produces: `async def llm_parse_atomic_intent(utterance, canvas_context, few_shots) -> dict`
- Consumes: 现有 LLM client（对齐 plan/revise 节点调用方式）

- [ ] **Step 1:** Mock LLM 测试 — 返回合法 JSON → items 正确
- [ ] **Step 2:** 实现 prompt 模板（system + schema + few-shots + user）
- [ ] **Step 3:** `parse_atomic_intent`：规则高置信 → 跳过 LLM；否则 fallback
- [ ] **Step 4:** LLM 异常 → 回退 `build_atomic_spec_enriched`
- [ ] **Step 5:** Commit `feat(agent): LLM fallback for atomic parse`

---

### Task P2-3: Clarify 路径

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/clarify_atomic_intent.py`
- Modify: `services/agent-runtime/app/graph/subgraphs/atomic_create_gate.py`

- [ ] **Step 1:** confidence < 0.70 → `clarify_atomic_intent` → AIMessage 追问 → `done`（无 add_nodes）
- [ ] **Step 2:** 集成测：歧义句「生成一下」→ 无 nest batch 调用
- [ ] **Step 3:** Commit `feat(agent): clarify on low-confidence atomic parse`

---

### Task P2-4: Eval 80 句 + 误判率脚本

**Files:**
- Modify: `eval-intent-set.yaml`（80 句）
- Create: `services/agent-runtime/scripts/eval_atomic_intent_report.py`

- [ ] **Step 1:** 报告输出 route/target_type 混淆矩阵
- [ ] **Step 2:** CI 门槛 ≥95%（LLM 测试用 recorded fixtures / mock）
- [ ] **Step 3:** Commit + PR

**Phase 2 完成标准：** P2-R1~R7；clarify E2E；eval ≥95%。

---

# Phase 3 — 上下文感知与指代消解

**PR 标题建议:** `feat(agent): atomic intent phase3 — context, deixis, adjust regenerate`

**预计：** 5 天 | **依赖：** Phase 2 merged

---

### Task P3-1: Context 组装

**Files:**
- Create: `services/agent-runtime/app/graph/atomic_context.py`
- Modify: `services/agent-runtime/app/graph/atomic_parse_llm.py`
- Modify: `services/agent-runtime/app/graph/atomic_parse_util.py`

**Interfaces:**
- Produces: `build_atomic_parse_context(state) -> str`（canvas 一行 + 最近 2 轮摘要）

- [ ] **Step 1:** 单测 context 格式与长度上限（≤500 字）
- [ ] **Step 2:** 注入 rule parse 与 LLM parse
- [ ] **Step 3:** Commit

---

### Task P3-2: 指代与 focus seed 增强

**Files:**
- Modify: `atomic_parse_util.py` — 扩展 `_DEICTIC_HINTS`、focus seed 逻辑
- Modify: `eval-intent-set.yaml` — +15 指代句

- [ ] **Step 1:** 「按刚才那个风格」+ history 摘要 → prompt 含风格继承（LLM 或规则 seed）
- [ ] **Step 2:** 「多模式扩写这个主图 prompt」+ focus → 已有用例保持 pass
- [ ] **Step 3:** Commit

---

### Task P3-3: Adjust regenerate（L1-04）

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/adjust_atomic_regenerate.py`
- Modify: `atomic_intent.py` — `detect_regenerate_adjust(text) -> str | None`
- Modify: `builder.py` / `atomic_create_gate.py` — regenerate 含 adjust 时走 adjust 节点

- [ ] **Step 1:** 「重新生成一张，背景改成白色」→ 更新 spec.prompt 再 gen
- [ ] **Step 2:** 纯 regenerate 仍走 `prepare_atomic_regenerate`
- [ ] **Step 3:** Commit

---

### Task P3-4: Thread 污染防护

**Files:**
- Modify: `app/graph/nodes/intake.py` 或 checkpoint hydrate 逻辑
- Create: `tests/test_atomic_thread_isolation.py`

- [ ] **Step 1:** atomic_create/regenerate turn 不读取 `plan_draft`/`split_manifest` 做路由
- [ ] **Step 2:** Campaign 混合画布复测用例
- [ ] **Step 3:** Commit + PR

**Phase 3 完成标准：** P3-R1~R6；指代集 100% pass；thread 隔离 PASS。

---

# Phase 4 — Loop 扩展与编排分流

**PR 标题建议:** `feat(agent): atomic intent phase4 — orchestration routing and multi limits`

**预计：** 5–7 天 | **依赖：** Phase 3 merged

---

### Task P4-1: 编排复杂度分类

**Files:**
- Modify: `atomic_intent.py` — `orchestration_complexity_intent(text) -> Literal["atomic","campaign","clarify"]`
- Modify: `intake.py` — 高复杂度 → campaign 或 clarify suggest
- Modify: `intent-taxonomy.yaml`

- [ ] **Step 1:** 「12 个分镜镜头」→ campaign；「三张图分别是…」→ atomic
- [ ] **Step 2:** eval 分流集 20 句
- [ ] **Step 3:** Commit

---

### Task P4-2: Multi 上限与混合模态 confirm

**Files:**
- Modify: `atomic_parse_schema.py` — items > 5 → clarify
- Modify: `atomic_create_gate.py` — multi 含 video/audio → `await_atomic_confirm`

- [ ] **Step 1:** 6 图请求 → 侧栏 suggest 改用 Campaign
- [ ] **Step 2:** 2 图 + 1 视频 → 确认门
- [ ] **Step 3:** Commit

---

### Task P4-3: Loop LC-6 部分失败 compose

**Files:**
- Modify: `run_atomic_gen.py` — 部分成功/失败 AIMessage（已有雏形则扩展）
- Modify: `docs/superpowers/specs/2026-08-04-loop-engineering-design.md` — 标记 LC-6

- [ ] **Step 1:** 3 gen 中 1 fail → phase=error 但 messages 列明已完成项
- [ ] **Step 2:** Commit

---

### Task P4-4: ADR + 全量 prod smoke

**Files:**
- Create: `docs/adr/p5-atomic-orchestration-boundary-adr.md`
- Modify: `deploy/prod-atomic-intent-verify.py` — ≥12 case

- [ ] **Step 1:** 文档化 atomic vs campaign 边界
- [ ] **Step 2:** 生产 12 case 全 PASS
- [ ] **Step 3:** PR + merge

**Phase 4 完成标准：** P4-R1~R6 全部满足。

---

## 执行顺序与 PR 策略

| Phase | 分支示例 | 合并前提 |
|-------|----------|----------|
| 1 | `fix/atomic-intent-p1-rules` | eval 50 全绿 + smoke |
| 2 | `feature/atomic-intent-p2-llm` | eval 80 ≥95% + clarify E2E |
| 3 | `feature/atomic-intent-p3-context` | 指代集 100% + thread 隔离 |
| 4 | `feature/atomic-intent-p4-orchestration` | 分流集 100% + smoke 12 |

**不建议**把 Phase 1–4 挤在一个 PR：规则/LLM/上下文/分流耦合过高，review 与回滚成本大。

---

## 与当前本地分支的关系

`fix/atomic-regenerate-phrase` 上的改动 ≈ **Phase 1 的部分实现**（P1-1~P1-3）。建议：

1. 重命名/拆 PR 为 `fix/atomic-intent-p1-rules`
2. 补全 P1-4 eval + P1-5 smoke 后再合并
3. Phase 2 从 main 新分支开始

---

## Self-Review（规格覆盖）

| 规格需求 | 本计划 Task |
|----------|-------------|
| P1-R1~R7 | P1-1 ~ P1-5 |
| P2-R1~R7 | P2-1 ~ P2-4 |
| P3-R1~R6 | P3-1 ~ P3-4 |
| P4-R1~R6 | P4-1 ~ P4-4 |

无 TBD 占位；每 Phase 有独立验收与 PR 边界。

---

**Plan complete.** 规格：`docs/superpowers/specs/2026-08-04-atomic-intent-hybrid-design.md`  
**Two execution options:**

1. **Subagent-Driven（推荐）** — 按 Phase 派发子 agent，Phase 内按 Task 迭代  
2. **Inline Execution** — 本会话从 Phase 1 Task P1-4（补 eval）开始连续实施

如需我先 **补全 Phase 1 剩余 eval/smoke 并提 PR**，或 **开 Phase 2 分支写 LLM parse 骨架**，直接说即可。
