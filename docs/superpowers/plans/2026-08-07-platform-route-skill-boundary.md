# 平台路由减肥 + 原子化优先 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 Agent 平台做「减肥 + 结构重组」——废止隐式 Skill 绑定与 campaign 默认 fallback，抽出 `route_decide`，**优先把 atomic（含侧栏 img2img）路由建稳**；编排链路仅在用户**显式选 Skill** 时进入。

**Architecture:** R0 在现有 `intake` 内止血（删隐式 skill、preserve 豁免、禁止 atomic 被 planning  silent 覆盖）；R1 新增 `route_context.py` + `route_decide.py`，`intake` 瘦身为 dispatcher；无 `requested_skill_id` 的营销/编排 utterance → `clarify_route`，不进 14 节点。R2+（orchestration 泛化、Skill 市场）**不在本计划**。

**Tech Stack:** LangGraph (Python 3.11+), pytest, YAML eval sets, Nest `RunRequest.sidebar_attachments` / `sidebar_mentioned_keys`（已贯通）。

**Spec:** [2026-08-07-platform-route-skill-boundary-design.md](../specs/2026-08-07-platform-route-skill-boundary-design.md)

---

## Global Constraints

- Branch: `feat/platform-route-atomic-first` from `main` — **never push to main directly**.
- Pre-PR: `cd services/agent-runtime && python -m pytest tests/test_route_decide.py tests/test_intake_gate.py tests/test_planning_guard_eval.py tests/test_atomic_orchestration.py tests/test_atomic_sidebar_refs.py -v` 全绿。
- **本计划非目标：** Skill 市场 UI、`flow_mode=orchestration` 重命名、platform generic manifest、route_decide LLM shadow（属 R2 spec §11）。
- eval gold **只增不删**；改 gold 须同步 spec §13 验收说明。
- `flow_mode=campaign` **读路径保留**至 R2；新代码写 `campaign` 仅当 `requested_skill_id` 有效且 route_decide 判 orchestration。
- Commit per task；R0、R1 可分两个 PR（R0 可先合并止血）。

---

## 实施策略（原子优先）

```text
优先级（高 → 低）
  P1  atomic_create + sidebar img2img + preserve 短语
  P2  atomic_regenerate / single_node（现有逻辑迁入 route_decide，行为不变）
  P3  chat / clarify_route（替代 silent campaign）
  P4  campaign（= 显式 skill + 编排 utterance，无 skill 则 clarify）
```

**减肥清单（intake 删除/禁止）：**

| 删除项 | 原因 |
|--------|------|
| `marketing_intent → skill_id` | Skill 仅显式调用 |
| `flow_mode = "campaign"` 默认值 | 原子平台不应默认最重链路 |
| `single_node` 分支自动绑 `enterprise-marketing-campaign` | 与 atomic 正交 |
| `orchestration_complexity_intent == campaign` silent 覆盖 `atomic_create` | 侧栏 P1 / preserve P5 优先 |
| 无 skill 时 `resolved_flow else "campaign"` | 改为 chat 或 clarify |

---

## File Map

| File | Action | Role |
| --- | --- | --- |
| `app/graph/l0_action.py` | **Create** | `detect_l0_action`, `has_preserve_intent` |
| `app/graph/route_context.py` | **Create** | `RouteContext` TypedDict, `assemble_route_context(state)` |
| `app/graph/route_decide.py` | **Create** | `decide_route(ctx) -> RouteDecision` |
| `app/graph/planning_guard.py` | Modify | preserve 豁免 `has_planning_image_conflict` |
| `app/graph/atomic_intent.py` | Modify | `resolve_intake_route` /consult route_decide；弱化 campaign override |
| `app/graph/nodes/intake.py` | Modify | thin dispatcher：读 `route_decision` + 显式 skill |
| `app/graph/nodes/clarify_route.py` | **Create** | 路由层 clarify（SSE 文案 + END） |
| `app/graph/state.py` | Modify | `route_context`, `route_decision` 可选字段 |
| `app/graph/builder.py` | Modify | `route_after_intake` 识别 `clarify_route` |
| `skills/atomic-create/eval-route-set.yaml` | **Create** | atomic-first gold（≥20 cases MVP） |
| `skills/atomic-create/eval-planning-guard-set.yaml` | Modify | + `pg-sidebar-01` |
| `skills/atomic-create/eval-intent-regression.yaml` | Modify | + 生产 §1.1 case |
| `tests/test_l0_action.py` | **Create** | preserve / plan 单测 |
| `tests/test_route_decide.py` | **Create** | P1 sidebar img2img + 显式 skill 边界 |
| `tests/test_eval_route_set.py` | **Create** | YAML gold runner |
| `tests/test_intake_gate.py` | Modify | marketing 不再隐式绑 skill |
| `tests/test_atomic_orchestration.py` | Modify | 无 skill → clarify；有 skill → campaign |
| `deploy/prod-route-context-verify.py` | **Create** | 生产 §1.1 + sidebar fixture |
| `docs/adr/p5-atomic-orchestration-boundary-adr.md` | Modify | 注记 R0/R1 override 修订（可选 R1 末 task） |

**不修改（本计划）：** `apps/web` Dock UI（已传 `skillId`）；`enterprise-marketing-campaign` 包内容；`parse_atomic_intent` LLM 路径。

---

# Phase R0 — 止血 + 评测（1 PR）

**PR 标题建议:** `fix(agent): slim intake — no implicit skill, preserve guard, atomic-first`

---

### Task 1: L0 preserve 检测

**Files:**
- Create: `services/agent-runtime/app/graph/l0_action.py`
- Create: `services/agent-runtime/tests/test_l0_action.py`

**Interfaces:**
- Produces: `has_preserve_intent(text: str) -> bool`, `detect_l0_action(text: str) -> ActionKind`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_l0_action.py
from app.graph.l0_action import detect_l0_action, has_preserve_intent

PROD_CASE = (
    "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。"
    "保持主图风格，背景，构图不变。"
)

def test_preserve_prod_case():
    assert has_preserve_intent(PROD_CASE)

def test_preserve_blocks_planning_read():
    assert detect_l0_action(PROD_CASE) in ("generate", "preserve")

def test_plan_without_preserve():
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert detect_l0_action(u) == "plan"
    assert not has_preserve_intent(u)
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd services/agent-runtime && python -m pytest tests/test_l0_action.py -v`

- [ ] **Step 3: Implement**

```python
# app/graph/l0_action.py
PRESERVE_MARKERS = ("不变", "保持", "维持", "沿用")
TRANSFORM_VERBS = ("穿上", "换装", "替换", "融合", "上身")

def has_preserve_intent(text: str) -> bool:
    t = (text or "").strip()
    return any(m in t for m in PRESERVE_MARKERS)

def detect_l0_action(text: str) -> ActionKind:
    from app.graph.planning_guard import detect_action, is_planning_intent
    t = (text or "").strip()
    if has_preserve_intent(t):
        return "preserve"
    return detect_action(t)  # plan | write | generate | ...
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/l0_action.py services/agent-runtime/tests/test_l0_action.py
git commit -m "feat(agent): L0 preserve intent detection"
```

---

### Task 2: planning_guard preserve 豁免

**Files:**
- Modify: `services/agent-runtime/app/graph/planning_guard.py`
- Modify: `services/agent-runtime/skills/atomic-create/eval-planning-guard-set.yaml`
- Modify: `services/agent-runtime/tests/test_planning_guard_eval.py`（若需新 gold 字段）

**Interfaces:**
- Consumes: `has_preserve_intent` from `l0_action`
- Produces: `has_planning_image_conflict` returns `False` when preserve + generate 语境

- [ ] **Step 1: Add gold case `pg-sidebar-01`**

```yaml
  - id: pg-sidebar-01
    utterance: "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。保持主图风格，背景，构图不变。"
    gold: { route: atomic_create, complexity: atomic, planning_conflict: false }
```

- [ ] **Step 2: Extend eval runner for `planning_conflict: false`**

在 `test_planning_guard_eval.py` 增加：

```python
from app.graph.planning_guard import has_planning_image_conflict

if gold.get("planning_conflict") is False:
    if has_planning_image_conflict(utterance):
        mismatches.append(f"{case_id}: unexpected planning conflict")
```

- [ ] **Step 3: Patch `has_planning_image_conflict`**

```python
def has_planning_image_conflict(text: str) -> bool:
    from app.graph.l0_action import has_preserve_intent
    t = (text or "").strip()
    if has_preserve_intent(t):
        return False
    # ... existing logic unchanged ...
```

- [ ] **Step 4: Run eval**

Run: `cd services/agent-runtime && python -m pytest tests/test_planning_guard_eval.py tests/test_l0_action.py -v`

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(agent): planning guard skips preserve phrases"
```

---

### Task 3: 废止 intake 隐式 Skill 绑定

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/tests/test_intake_gate.py`
- Modify: `services/agent-runtime/tests/test_atomic_orchestration.py`

**Interfaces:**
- Produces: `skill_id` 仅当 `requested_skill_id in discover_skills()`

- [ ] **Step 1: Update failing tests**

```python
# test_intake_gate.py — replace test_intake_marketing_sets_enterprise_skill
@pytest.mark.asyncio
async def test_intake_marketing_without_explicit_skill_sets_no_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node({
        "messages": [HumanMessage(content="帮我设计一套卫生洁具的电商详情页营销方案")]
    })
    assert out.get("skill_id") is None

@pytest.mark.asyncio
async def test_intake_marketing_with_explicit_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node({
        "messages": [HumanMessage(content="帮我设计一套卫生洁具的电商详情页营销方案")],
        "requested_skill_id": "enterprise-marketing-campaign",
    })
    assert out.get("skill_id") == "enterprise-marketing-campaign"
```

```python
# test_atomic_orchestration.py — revise campaign redirect tests
@pytest.mark.asyncio
async def test_intake_planning_without_skill_clarifies_or_chat():
    intake = make_intake_node(skills)
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    out = await intake({"messages": [HumanMessage(content=u)]})
    assert out.get("skill_id") is None
    assert out["flow_mode"] in ("atomic_create", "chat") or out.get("phase") == "clarify"
    assert out["flow_mode"] != "campaign" or out.get("skill_id")

@pytest.mark.asyncio
async def test_intake_planning_with_explicit_skill_enters_campaign():
    intake = make_intake_node(skills)
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    out = await intake({
        "messages": [HumanMessage(content=u)],
        "requested_skill_id": "enterprise-marketing-campaign",
    })
    assert out["flow_mode"] == "campaign"
    assert out.get("skill_id") == "enterprise-marketing-campaign"
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `python -m pytest tests/test_intake_gate.py tests/test_atomic_orchestration.py -v`

- [ ] **Step 3: Slim `intake.py` skill block**

删除 lines 43–48（`elif marketing_intent` 绑 skill）、lines 75–76（single_node 自动 skill）、lines 97–98（marketing 分支补 skill）。

保留：

```python
skill_id: str | None = None
if requested and requested in by_id:
    skill_id = requested
```

- [ ] **Step 4: 禁止无 skill 时 resolved_flow 默认 campaign（临时，R1 由 route_decide 接管）**

将 `flow_mode = "campaign"` 初值改为 `None`；`resolved_flow` 末尾：

```python
else:
    resolved_flow = flow_mode or "chat"  # 非 atomic/single/regen 且无 skill → chat
```

营销分支 `elif marketing_intent(text) or ...` 改为 **仅当 `skill_id` 已设** 才写 `user_brief` 并 `flow_mode=campaign`；否则 `phase=clarify` + `ROUTE_CLARIFY_ORCHESTRATION` 文案（见 Task 4 常量）。

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(agent): remove implicit marketing skill binding"
```

---

### Task 4: 禁止 orchestration silent 覆盖 atomic（临时规则）

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/app/graph/atomic_intent.py`（可选：文档注释）

**Interfaces:**
- Consumes: `has_preserve_intent`, sidebar keys（R0 仅 utterance 内 `@I` 计数）

- [ ] **Step 1: Add helper in intake or l0_action**

```python
def _utterance_has_multi_image_refs(text: str) -> bool:
    import re
    keys = set(re.findall(r"@([ITVA]\d+)", text, flags=re.I))
    image_keys = {k.upper() for k in keys if k.upper().startswith("I")}
    return len(image_keys) >= 2
```

- [ ] **Step 2: Patch intake override block**

```python
from app.graph.l0_action import TRANSFORM_VERBS, has_preserve_intent

# before: if orch == "campaign" and (is_atomic or is_variant_create):
if orch == "campaign" and (is_atomic or is_variant_create):
    t = text
    img2img = _utterance_has_multi_image_refs(t) and any(v in t for v in TRANSFORM_VERBS)
    if not (has_preserve_intent(t) or img2img):
        is_atomic = False
        ...
```

- [ ] **Step 3: Regression test for prod case**

```python
# tests/test_intake_gate.py
@pytest.mark.asyncio
async def test_intake_prod_img2img_case_atomic():
    node = make_intake_node(SKILLS_DIR)
    u = "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。保持主图风格，背景，构图不变。"
    out = await node({"messages": [HumanMessage(content=u)]})
    assert out["flow_mode"] == "atomic_create"
    assert out.get("skill_id") is None
```

- [ ] **Step 4: Run full R0 pytest slice**

Run: `python -m pytest tests/test_intake_gate.py tests/test_l0_action.py tests/test_planning_guard_eval.py -v`

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(agent): do not override atomic for img2img preserve utterances"
```

---

### Task 5: eval-intent-regression + prod smoke stub

**Files:**
- Modify: `services/agent-runtime/skills/atomic-create/eval-intent-regression.yaml`
- Create: `deploy/prod-route-context-verify.py`

- [ ] **Step 1: Add regression entry**

```yaml
  - id: reg-2026-08-07-img2img-sidebar
    utterance: "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。保持主图风格，背景，构图不变。"
    gold: { flow_mode: atomic_create, skill_id: null }
```

- [ ] **Step 2: Create prod smoke（最小）**

脚本断言：登录 → POST conversation（无 skillId）→ `thread-state.flowMode != campaign` 或 assistant 不含「拟定拆解约 14 个」。

- [ ] **Step 3: Run locally against staging/prod if available**

- [ ] **Step 4: Commit**

```bash
git add deploy/prod-route-context-verify.py services/agent-runtime/skills/atomic-create/eval-intent-regression.yaml
git commit -m "test(agent): regression gold + prod route smoke for img2img case"
```

**R0 验收：** §1.1 生产 utterance 无 skill → `atomic_create`；隐式 `enterprise-marketing-campaign` 不再出现。

---

# Phase R1 — route_decide 结构 + 侧栏 Context（1 PR）

**PR 标题建议:** `feat(agent): route_decide atomic-first with sidebar RouteContext`

---

### Task 6: RouteContext 组装

**Files:**
- Create: `services/agent-runtime/app/graph/route_context.py`
- Modify: `services/agent-runtime/app/graph/state.py`

**Interfaces:**
- Produces: `assemble_route_context(state: dict) -> RouteContext`

- [ ] **Step 1: Write failing test**

```python
# tests/test_route_decide.py (start file)
from app.graph.route_context import assemble_route_context

def test_assemble_includes_sidebar_fields():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "@I1 @I2 穿上"}],
        "sidebar_attachments": [{"kind": "image", "url": "https://x/a.jpg", "key": "I1"}],
        "sidebar_mentioned_keys": ["I1", "I2"],
        "requested_skill_id": "",
    })
    assert ctx["mentioned_keys"] == ["I1", "I2"]
    assert len(ctx["sidebar_attachments"]) == 1
```

- [ ] **Step 2: Implement `route_context.py`**

字段：`utterance`, `mentioned_keys`, `sidebar_attachments`, `focus_node_id`, `requested_skill_id`, `checkpoint`（atomic_node_id, user_brief, plan_draft）。

- [ ] **Step 3: Add optional fields to `AgentRuntimeState` TypedDict**

- [ ] **Step 4: Commit**

---

### Task 7: route_decide 核心（atomic-first 信号表）

**Files:**
- Create: `services/agent-runtime/app/graph/route_decide.py`
- Modify: `services/agent-runtime/tests/test_route_decide.py`

**Interfaces:**
- Produces: `decide_route(ctx: RouteContext) -> RouteDecision`

- [ ] **Step 1: Write failing tests（P1–P6 MVP）**

```python
from app.graph.route_decide import decide_route
from app.graph.route_context import assemble_route_context

PROD = "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。保持主图风格，背景，构图不变。"

def test_p1_sidebar_img2img_atomic():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": PROD}],
        "sidebar_mentioned_keys": ["I1", "I2"],
        "sidebar_attachments": [
            {"kind": "image", "url": "https://a/1.jpg"},
            {"kind": "image", "url": "https://a/2.jpg"},
        ],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "atomic_create"
    assert d["reason"] == "sidebar_img2img_p1"
    assert d["confidence"] >= 0.9

def test_no_skill_marketing_clarify():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "天猫蓝牙耳机详情页营销方案"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "clarify_route"
    assert "skill" in (d.get("clarify_question") or "").lower() or "出图" in d["clarify_question"]

def test_explicit_skill_orchestration():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "详情页构图方案"}],
        "requested_skill_id": "enterprise-marketing-campaign",
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "campaign"
```

- [ ] **Step 2: Implement `decide_route` 优先级链**

顺序：checkpoint regenerate → P1 sidebar img2img → P2 single_node → P4 atomic_create_intent → P5 preserve+generate → P3 plan（**仅 skill_id** → campaign，否则 clarify_route）→ P6 chat/clarify。

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

### Task 8: intake 瘦身为 dispatcher

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/tests/test_intake_gate.py`

**Interfaces:**
- Consumes: `assemble_route_context`, `decide_route`
- Produces: intake 输出 `route_decision`, `flow_mode`, `skill_id`, `phase`, `clarify_question`

- [ ] **Step 1: Refactor intake body**

```python
ctx = assemble_route_context(state)
decision = decide_route(ctx)
flow_mode = decision["flow_mode"]
# skill_id: only explicit requested
skill_id = ctx["requested_skill_id"] if ctx["requested_skill_id"] in by_id else None
if flow_mode == "clarify_route":
    return {"phase": "clarify", "clarify_question": decision["clarify_question"], "flow_mode": "chat", ...}
if flow_mode == "campaign":
    assert skill_id  # invariant
...
```

- [ ] **Step 2: Delete duplicated route logic**（`resolve_intake_route` 调用、`orch` override 块移入 `route_decide`）

- [ ] **Step 3: Run full intake + route tests**

- [ ] **Step 4: Commit**

---

### Task 9: clarify_route 节点 + builder 接线

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/clarify_route.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Modify: `services/agent-runtime/tests/test_graph_routes.py`

**Interfaces:**
- Produces: `make_clarify_route_node()` → AIMessage + `phase=clarify` + END

- [ ] **Step 1: Implement clarify_route node**（参考 `clarify_atomic_intent.py`，仅 SSE 文案，不写 brief）

- [ ] **Step 2: Update `route_after_intake`**

```python
if state.get("phase") == "clarify" and state.get("route_clarify"):
    return "clarify_route"
```

- [ ] **Step 3: Register node + edge to END**

- [ ] **Step 4: Graph route unit test**

- [ ] **Step 5: Commit**

---

### Task 10: eval-route-set.yaml + CI runner

**Files:**
- Create: `services/agent-runtime/skills/atomic-create/eval-route-set.yaml`
- Create: `services/agent-runtime/tests/test_eval_route_set.py`

- [ ] **Step 1: Author ≥20 gold cases**（类别：sidebar-img2img×5, preserve×3, atomic-generate×5, no-skill-marketing→clarify×3, explicit-skill-campaign×2, hello→chat×2）

- [ ] **Step 2: Runner 调用 `decide_route(assemble_route_context(fixture))`**

- [ ] **Step 3: CI green**

Run: `python -m pytest tests/test_eval_route_set.py tests/test_route_decide.py -v`

- [ ] **Step 4: Commit**

---

### Task 11: prod-route-context-verify 完整版

**Files:**
- Modify: `deploy/prod-route-context-verify.py`

- [ ] **Step 1: Case A** — §1.1 utterance，无 skillId → `flowMode=atomic_create` 或 assistant 含「原子创作」

- [ ] **Step 2: Case B** — 同 utterance + mock attachments（若 API 支持）→ atomic 节点创建

- [ ] **Step 3: Case C** — 「详情页营销方案」无 skill → 不含 14 节点；含 clarify 或 chat

- [ ] **Step 4: Case D** — 显式 skillId=canvas → campaign 可接受

- [ ] **Step 5: Commit + 生产跑一遍记录 PASS**

---

### Task 12: ADR 注记 + spec 状态

**Files:**
- Modify: `docs/adr/p5-atomic-orchestration-boundary-adr.md`
- Modify: `docs/superpowers/specs/2026-08-07-platform-route-skill-boundary-design.md`（状态 → Implemented R0/R1）

- [ ] **Step 1: ADR 增加 Superseded部分**：规则 1 需 skill + 高置信 plan；无 skill 禁止 silent campaign

- [ ] **Step 2: Spec §11 勾选 R0/R1 完成项**

- [ ] **Step 3: Commit**

---

## Deferred（显式不在本计划）

| 项 | Spec 阶段 | 原因 |
|----|-----------|------|
| `orchestration_gate` + generic manifest | R2 | 先 atomic 平台化 |
| `campaign` → `orchestration` rename | R2 | 避免 checkpoint 震荡 |
| route_decide LLM shadow | R2–R3 | 规则 + eval 先达标 |
| Skill 市场 / 安装器 | R3 | 独立 spec |
| 电商 Skill 产品包 | R4 | 样例 skill 仅显式调用 |

---

## Self-Review（plan ↔ spec）

| Spec § | Task |
|--------|------|
| R-S1 路由与 Skill 正交 | Task 3, 7, 8 |
| R-S2 废止隐式 skill | Task 3 |
| R-S4 route_decide | Task 6–8 |
| R-S5 clarify 非 campaign | Task 3, 7, 9 |
| R-S6 侧栏 P1 | Task 7, 10, 11 |
| R-S7 preserve | Task 1–2, 4, 7 |
| §13 验收 1–5 | Task 4–5, 10–11 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-platform-route-skill-boundary.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 按 Task 1→12 分派 subagent，R0 PR 可先合并
2. **Inline Execution** — 本会话用 executing-plans 连续执行 R0

**Which approach?**
