# 实物产品视觉出图（一期）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `ecommerce-product-visual` Skill 的一期四阶段闭环（图源 QA → 动态方案 → 并行 image gen → 按类型定稿），覆盖全行业实物 visual 出图；**不含 video**（二期）。

**Architecture:** 复用 Campaign flat graph + `interrupt_before` HITL + `gen_scheduler` Send fan-out。新增 `flow_mode: product_visual` 分支：`image_qa_gate` → `plan_product_visual` → `split_product_visual`（动态 manifest，非 Campaign 固定清单）→ 共享 `start_gen`/`gen_scheduler`/`gen_node`/`collect_gen` → `delivery_summary`。差异仅在 Phase 2 LLM 输出的 `product_visual_plan`（`visual_intent` + `image_types[]` + schemes）。

**Tech Stack:** LangGraph (Python 3.11+), pytest + YAML eval sets, Nest `agent-canvas-tools.service.ts`, Vue 3 (`AgentSideRail.vue`, `agentInterruptGate.ts`).

**Spec:** [2026-08-10-ecommerce-product-visual-design.md](../specs/2026-08-10-ecommerce-product-visual-design.md)（v1.8 · **一期仅出图**）

---

## Global Constraints

- Branch: `feat/ecommerce-product-visual-p1` from `main` — **禁止直推 main**
- **一期 scope：** Phase 1~4 **仅 image**；`target_type` 枚举含 `video` 但一期 **只实例化 `image`**（L12 / AC-14）
- **禁止 scope creep：** 不调用 `run_video_generation`、不加 `video_node`、不验收 video
- **单一 Skill：** `ecommerce-product-visual`；不按行业拆 flow；禁止 `if industry` 硬路由（L8）
- **修订 ≤3 轮** scheme；超限强制 Phase 3（L7）
- **每类型最终 1 张**；同类型多选 = 并行候选，**禁止 prompt 融合**（L3/L4）
- **模特双通道：** 无 @ref → AI 生成模特；有用户模特 @ref → attach（L11）
- Pre-PR: `cd services/agent-runtime && uv run pytest tests/test_product_visual*.py tests/test_eval_cvs_set.py -v` 全绿；`pnpm --filter @lnkpi/server test` 相关用例全绿
- 发版阻塞：**§十 CVS 三案例**（`eval-cvs-set.yaml`）+ AC-1~AC-14
- Commit per task；P1–P4 可分 PR 合并，CVS eval 与 deploy smoke 在 P4 后

---

## File Map

| File | Action | Role |
| --- | --- | --- |
| `services/agent-runtime/skills/ecommerce-product-visual/SKILL.md` | **Create** | Skill 元数据 + 四阶段指令 |
| `services/agent-runtime/skills/ecommerce-product-visual/assets/canvas-manifest.yaml` | **Create** | Phase 1 seed 模板（`white_bg`, `product_turnaround`）+ 类型模板库 optional entries |
| `services/agent-runtime/skills/ecommerce-product-visual/assets/few-shots.yaml` | **Create** | plan few-shots（跨行业） |
| `services/agent-runtime/skills/ecommerce-product-visual/assets/prompts/1.0.0.md` | **Create** | `plan_product_visual` system prompt |
| `services/agent-runtime/skills/ecommerce-product-visual/eval-cvs-set.yaml` | **Create** | CVS-01/02/03 金标 |
| `services/agent-runtime/skills/ecommerce-product-visual/eval-route-set.yaml` | **Create** | product_visual 路由 gold |
| `services/agent-runtime/app/graph/state.py` | Modify | `product_visual_plan`, `image_qa_result`, `scheme_revision_count`, `phase1_asset_keys`, phase literals |
| `services/agent-runtime/app/graph/route_decide.py` | Modify | `RouteFlowMode.product_visual` |
| `services/agent-runtime/app/graph/route_precedence.py` | Modify | 实拍+visual 诉求 → `product_visual` |
| `services/agent-runtime/app/graph/nodes/intake.py` | Modify | 写入 `flow_mode=product_visual` + `skill_id` |
| `services/agent-runtime/app/graph/builder.py` | Modify | `route_after_intake` → product_visual gate region |
| `services/agent-runtime/app/graph/subgraphs/product_visual_gate.py` | **Create** | 注册 QA / plan / scheme / delivery 节点 |
| `services/agent-runtime/app/graph/nodes/image_qa_gate.py` | **Create** | Phase 1 质检 + HITL |
| `services/agent-runtime/app/graph/nodes/plan_product_visual.py` | **Create** | Phase 2 LLM plan |
| `services/agent-runtime/app/graph/nodes/scheme_select_gate.py` | **Create** | 类型×变体选择 HITL |
| `services/agent-runtime/app/graph/nodes/split_product_visual.py` | **Create** | 动态 split（plan → manifest items） |
| `services/agent-runtime/app/graph/nodes/delivery_summary.py` | **Create** | Phase 4 定稿汇总 |
| `services/agent-runtime/app/graph/product_visual_models.py` | **Create** | Pydantic/TypedDict：`ProductVisualPlan`, `ImageType`, `Scheme` |
| `services/agent-runtime/app/graph/product_visual_prompt.py` | **Create** | `build_scheme_prompt_hint()` |
| `services/agent-runtime/app/graph/hitl_resume.py` | Modify | 新 gate：`await_image_qa`, `await_scheme_select`, `await_delivery_confirm` |
| `services/agent-runtime/tests/test_product_visual_route.py` | **Create** | 路由 gold |
| `services/agent-runtime/tests/test_product_visual_qa.py` | **Create** | QA gate 单测 |
| `services/agent-runtime/tests/test_product_visual_plan.py` | **Create** | plan 解析 + revise 计数 |
| `services/agent-runtime/tests/test_split_product_visual.py` | **Create** | dynamic split + target_type=image |
| `services/agent-runtime/tests/test_eval_cvs_set.py` | **Create** | CVS YAML runner |
| `apps/web/src/components/agent/agentInterruptGate.ts` | Modify | 新 interrupt kinds |
| `apps/web/src/components/agent/AgentSideRail.vue` | Modify | QA 弹窗 + scheme 选择卡 |
| `apps/web/src/components/agent/ProductVisualDeliveryCard.vue` | **Create** | Phase 4 按类型定稿 UI |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | Modify | Phase 1 四视图 seed 链（复用 Campaign white_bg→turnaround） |
| `deploy/prod-product-visual-cvs-verify.py` | **Create** | 生产 CVS smoke（dry-run + live 可选） |

**复用（不 fork）：** `gen_scheduler.py`, `gen_node.py`, `collect_gen.py`, `start_gen.py`, `chain_refs.py`, `apply_sidebar_refs.py`

**二期占位（本计划只留接口，不实现）：** `VideoType`, `video_node`, `run_video_generation` in split

---

## 图编排（一期）

```text
intake
  └─ flow_mode=product_visual
       → image_qa_check
            ├─ pass → plan_product_visual
            └─ fail → await_image_qa (HITL) → image_qa_remedy → plan_product_visual
       → await_scheme_select (HITL, 若有多变体)
       → split_product_visual
       → await_topo (复用 topo_gate，用户「确认出图」)
       → start_gen → gen_scheduler ⇄ gen_node → collect_gen
       → delivery_summary → await_delivery_confirm (HITL) → done
```

---

# Phase 0 — Skill 脚手架 + 路由

### Task 0: Skill 目录与 state 字段

**Files:**
- Create: `services/agent-runtime/skills/ecommerce-product-visual/SKILL.md`
- Create: `services/agent-runtime/skills/ecommerce-product-visual/assets/canvas-manifest.yaml`
- Modify: `services/agent-runtime/app/graph/state.py`

**Interfaces:**
- Produces: `LoadedSkill` via `discover_skills()`；state keys: `product_visual_plan`, `image_qa_result`, `scheme_revision_count`, `phase1_asset_keys`

- [ ] **Step 1: Write failing test — skill discoverable**

```python
# tests/test_product_visual_route.py
from pathlib import Path
from app.skills.loader import discover_skills

SKILLS = Path(__file__).resolve().parents[1] / "skills"

def test_ecommerce_product_visual_skill_discovered():
    ids = {s.id for s in discover_skills(SKILLS)}
    assert "ecommerce-product-visual" in ids
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd services/agent-runtime && uv run pytest tests/test_product_visual_route.py::test_ecommerce_product_visual_skill_discovered -v`

- [ ] **Step 3: Create SKILL.md + minimal manifest**

`SKILL.md` frontmatter 至少含：

```yaml
---
name: ecommerce-product-visual
description: >-
  Product photo QA → dynamic visual plan → parallel image gen → per-type delivery.
  Use when user uploads product photos and asks for listing, packaging, or multi-type visuals.
metadata:
  author: lnkpi
  lnkpi.canvas_manifest: assets/canvas-manifest.yaml
  lnkpi.max_downstream: "12"
  lnkpi.prompt_version: "1.0.0"
  lnkpi.topology_mode_default: trimmed
allowed-tools: upsert_prompt_node add_nodes_batch connect_nodes set_node_prompt attach_refs run_image_generation get_generation_status
---
```

`canvas-manifest.yaml` Phase 1 seed 段：

```yaml
items:
  - key: white_bg
    title: 白底主图
    target_type: image
    chain: product
    role: seed
    auto_generate: true
  - key: product_turnaround
    title: 产品四视图
    target_type: image
    chain: product
    role: turnaround
    depends_on: [white_bg]
    gen_mode: i2i
```

- [ ] **Step 4: Extend state.py**

在 `AgentRuntimeState.phase` Literal 追加：`"image_qa"`, `"await_image_qa"`, `"plan_product_visual"`, `"await_scheme_select"`, `"delivery_confirm"`。

新增字段：

```python
product_visual_plan: dict | None
image_qa_result: Literal["pass", "fail", "remediated"] | None
scheme_revision_count: int | None
phase1_asset_keys: list[str] | None
delivery_selections: dict[str, str] | None  # type_id -> scheme_id
```

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add services/agent-runtime/skills/ecommerce-product-visual/ \
  services/agent-runtime/app/graph/state.py \
  services/agent-runtime/tests/test_product_visual_route.py
git commit -m "feat(agent): scaffold ecommerce-product-visual skill and state"
```

---

### Task 1: 路由 — 实拍 + visual 诉求 → product_visual

**Files:**
- Modify: `services/agent-runtime/app/graph/route_decide.py`
- Modify: `services/agent-runtime/app/graph/route_precedence.py`
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Modify: `services/agent-runtime/tests/test_product_visual_route.py`

**Interfaces:**
- Produces: `decide_route()` 返回 `flow_mode="product_visual"`, `skill_id="ecommerce-product-visual"`
- Consumes: `route_context` 含 `has_product_photo_attachment`, `utterance`

- [ ] **Step 1: Write failing route tests**

```python
def test_explicit_skill_routes_product_visual():
    from app.graph.route_decide import decide_route
    ctx = {
        "utterance": "帮我出主图和场景图",
        "requested_skill_id": "ecommerce-product-visual",
        "has_product_photo_attachment": True,
        "sidebar_attachments": [{"kind": "image", "role": "product"}],
    }
    d = decide_route(ctx, valid_skill_ids={"ecommerce-product-visual"})
    assert d["flow_mode"] == "product_visual"
    assert d["skill_id"] == "ecommerce-product-visual"

def test_single_image_atomic_not_product_visual():
    ctx = {
        "utterance": "把背景换成白色",
        "has_product_photo_attachment": True,
        "sidebar_attachments": [{"kind": "image"}],
    }
    d = decide_route(ctx, valid_skill_ids=set())
    assert d["flow_mode"] != "product_visual"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement route_precedence rule**

新增规则 `product_visual_intent`（优先级高于 campaign clarify，低于 atomic preserve）：

- `requested_skill_id == ecommerce-product-visual` → product_visual
- 或：有产品实拍附件 + utterance 含多类型/visual/plan 语义（LLM 或 taxonomy 轻量检测，**禁止**行业关键词 if-else）

`builder.py` `route_after_intake`：

```python
if state.get("flow_mode") == "product_visual":
    return "image_qa_check"
```

- [ ] **Step 4: Create eval-route-set.yaml**（≥8 cases：显式 skill、混合 utterance、单图 atomic 负例、campaign 负例）

- [ ] **Step 5: Run tests — expect PASS**

Run: `uv run pytest tests/test_product_visual_route.py -v`

- [ ] **Step 6: Commit**

---

# Phase P1 — 图源准入（image_qa_gate）

### Task 2: image_qa_check + await_image_qa HITL

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/image_qa_gate.py`
- Create: `services/agent-runtime/app/graph/subgraphs/product_visual_gate.py`（先注册 QA 段）
- Modify: `services/agent-runtime/app/graph/hitl_resume.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Create: `services/agent-runtime/tests/test_product_visual_qa.py`
- Modify: `apps/web/src/components/agent/agentInterruptGate.ts`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Produces: `make_image_qa_check_node()`, `make_await_image_qa_node()`, `make_image_qa_remedy_node()`
- State: `image_qa_result: pass|fail|remediated`, `phase1_asset_keys: [white_bg, product_turnaround]`

- [ ] **Step 1: Write failing QA tests**

```python
# tests/test_product_visual_qa.py
import pytest
from app.graph.nodes.image_qa_gate import evaluate_image_qa, clear_product_visual_abort_state

def test_qa_pass_clears_popup():
    r = evaluate_image_qa({"sharpness": 0.9, "has_white_bg": True})
    assert r["image_qa_result"] == "pass"

def test_qa_fail_triggers_hitl():
    r = evaluate_image_qa({"sharpness": 0.2, "has_white_bg": False})
    assert r["image_qa_result"] == "fail"
    assert r["phase"] == "await_image_qa"

def test_abort_clears_state():
    dirty = {
        "product_visual_plan": {"image_types": []},
        "image_qa_result": "fail",
        "phase1_asset_keys": ["white_bg"],
    }
    clean = clear_product_visual_abort_state(dirty)
    assert clean.get("product_visual_plan") is None
    assert clean.get("image_qa_result") is None
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement image_qa_gate.py**

核心逻辑：

```python
def evaluate_image_qa(metrics: dict) -> dict:
    """AC-1/AC-2/AC-3: sharpness + white_bg; interior 场景放宽白底（CVS-03）。"""
    is_interior = metrics.get("scene_kind") == "interior"
    white_ok = metrics.get("has_white_bg") or is_interior
    sharp_ok = metrics.get("sharpness", 0) >= 0.5
    if sharp_ok and white_ok:
        return {"image_qa_result": "pass", "phase": "plan_product_visual"}
    return {"image_qa_result": "fail", "phase": "await_image_qa"}
```

`image_qa_remedy` 分支：
- 用户选 `retake` → `clear_product_visual_abort_state` + END（AC-2）
- 用户选 `ai_white_bg` → 触发 seed gen → `image_qa_result=remediated` → plan（AC-3）

`builder.py` 追加 `interrupt_before`：`await_image_qa`

- [ ] **Step 4: Frontend — agentInterruptGate**

新增 kind `image_qa`，选项：`retake` | `ai_white_bg`；文案泛化「成图效果」，不写死「包装图」。

- [ ] **Step 5: Server — Phase 1 四视图**

`agent-canvas-tools.service.ts`：QA pass/remediated 后确保 `white_bg` → `product_turnaround` 链与 Campaign 一致（refs: white_bg）。

- [ ] **Step 6: Run tests — expect PASS**

- [ ] **Step 7: Commit**

---

# Phase P2 — 方案策划（plan + scheme select）

### Task 3: product_visual_models + plan_product_visual LLM

**Files:**
- Create: `services/agent-runtime/app/graph/product_visual_models.py`
- Create: `services/agent-runtime/app/graph/product_visual_prompt.py`
- Create: `services/agent-runtime/skills/ecommerce-product-visual/assets/prompts/1.0.0.md`
- Create: `services/agent-runtime/skills/ecommerce-product-visual/assets/few-shots.yaml`
- Create: `services/agent-runtime/app/graph/nodes/plan_product_visual.py`
- Create: `services/agent-runtime/tests/test_product_visual_plan.py`

**Interfaces:**
- Produces: `parse_product_visual_plan(raw: str) -> ProductVisualPlan`
- Produces: `make_plan_product_visual_node(llm, skills_dir)`
- State output: `product_visual_plan`（含 `visual_intent`, `image_types[]`）

- [ ] **Step 1: Write failing plan parse tests**

```python
from app.graph.product_visual_models import parse_product_visual_plan

CVS01_MINIMAL = '''
{"visual_intent":{"primary_goal":"mixed_ecommerce","confidence":0.9},
 "image_types":[
   {"type_id":"hero_main","type_label":"主图","schemes":[{"scheme_id":"c1","recommended":true,"prompt":"..."}]},
   {"type_id":"model_display","type_label":"模特展示","schemes":[{"scheme_id":"c1","recommended":true,
     "key_elements":{"human_presence":true,"model_source":"generated"},"prompt":"..."}]}
 ]}
'''

def test_parse_cvs01_types():
    plan = parse_product_visual_plan(CVS01_MINIMAL)
    ids = {t.type_id for t in plan.image_types}
    assert "hero_main" in ids
    assert "model_display" in ids

def test_no_video_target_type_in_plan():
    plan = parse_product_visual_plan(CVS01_MINIMAL)
    for t in plan.image_types:
        assert getattr(t, "target_type", "image") == "image"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement models + plan node**

`ProductVisualPlan` 字段对齐 spec §2.1 / 附录 A；`target_type` 默认 `"image"`。

`plan_product_visual` 节点：
1. 读 `user_brief` + `visual_intent` 上下文
2. LLM structured output → validate → 写入 `product_visual_plan`
3. 若所有类型仅 1 scheme → 静默选中，`selected_scheme_ids` 预填
4. 否则 → `phase=await_scheme_select`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 4: await_scheme_select HITL + revise ≤3

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/scheme_select_gate.py`
- Modify: `services/agent-runtime/app/graph/subgraphs/product_visual_gate.py`
- Modify: `services/agent-runtime/tests/test_product_visual_plan.py`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Produces: `make_await_scheme_select_node()`, `classify_scheme_decision()`
- Consumes: `product_visual_plan`, `scheme_revision_count`

- [ ] **Step 1: Write failing revise limit test**

```python
def test_revise_limit_forces_gen():
    from app.graph.nodes.scheme_select_gate import apply_scheme_decision
    state = {"scheme_revision_count": 3, "product_visual_plan": {"image_types": []}}
    out = apply_scheme_decision(state, decision={"action": "revise", "feedback": "加包装"})
    assert out["phase"] == "split_product_visual"  # 强制 Phase 3，AC-9
    assert "超限" in (out.get("assistant_note") or "")
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement scheme select gate**

UI：按 **类型分组** 卡片；同类型 checkbox 多选（AC-6）；展示「系统理解：…」（`visual_intent` 摘要）。

决策：
- `confirm_schemes` → 写 `selected_scheme_ids` → `split_product_visual`
- `revise` → `scheme_revision_count += 1`；若 `<3` → `plan_product_visual`；若 `≥3` → 强制 split

- [ ] **Step 4: Frontend scheme 选择卡**（跨行业统一组件，不按 domain 分叉布局）

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

---

# Phase P3 — 动态 split + 并行 image gen

### Task 5: split_product_visual

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/split_product_visual.py`
- Create: `services/agent-runtime/tests/test_split_product_visual.py`
- Modify: `services/agent-runtime/app/graph/product_visual_prompt.py`

**Interfaces:**
- Produces: `make_split_product_visual_node(nest, skills_dir)`
- Output state: `split_manifest[]`, `gen_ordered_keys`, `phase="await_topo"`

- [ ] **Step 1: Write failing split tests**

```python
from app.graph.nodes.split_product_visual import build_manifest_from_plan

PLAN = {
    "image_types": [
        {"type_id": "hero_main", "type_label": "主图",
         "selected_scheme_ids": ["c1"],
         "schemes": [{"scheme_id": "c1", "recommended": True, "prompt": "白底主图"}]},
        {"type_id": "packaging_hero", "type_label": "包装",
         "selected_scheme_ids": ["c1", "c2"],
         "schemes": [
           {"scheme_id": "c1", "prompt": "A"},
           {"scheme_id": "c2", "prompt": "B"},
         ]},
    ]
}

def test_manifest_keys_are_type_scheme():
    items = build_manifest_from_plan(PLAN)
    keys = {i["key"] for i in items}
    assert keys == {"hero_main__c1", "packaging_hero__c1", "packaging_hero__c2"}

def test_all_items_target_type_image():
    items = build_manifest_from_plan(PLAN)
    assert all(i["target_type"] == "image" for i in items)

def test_depends_on_phase1_assets():
    items = build_manifest_from_plan(PLAN)
    for i in items:
        assert "white_bg" in i["depends_on"]
        assert "product_turnaround" in i["depends_on"]
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement split_product_visual**

逻辑：
1. 合并 Phase 1 seed items（manifest template）+ plan 动态 downstream items
2. key = `{type_id}__{scheme_id}`（spec §Phase 3）
3. `prompt_hint = build_scheme_prompt_hint(scheme, visual_intent)` — **禁止** merge 多 scheme
4. `precompute_gen_order()` 拓扑排序（防 dynamic split 环）
5. Nest：`add_nodes_batch` / `connect_nodes` / `set_node_prompt` / `attach_refs`（复用 `build_chain_ref_order`）
6. 人感类型：若 sidebar 有模特 @ref → `attach_refs` 追加模特 key

- [ ] **Step 4: Wire topo_gate** — split 后进入现有 `await_topo`（用户「确认出图」）

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

---

### Task 6: Gen 路径验证（复用 gen_scheduler）

**Files:**
- Modify: `services/agent-runtime/tests/test_gen_scheduler.py`（或新建 `test_product_visual_gen.py`）
- Modify: `services/agent-runtime/app/graph/nodes/gen_node.py`（仅当需识别 product_visual prompt_hint）

**Interfaces:**
- Consumes: `split_manifest` from Task 5
- Produces: `gen_by_key` populated; **no video keys**

- [ ] **Step 1: Write integration test with mocked nest**

```python
@pytest.mark.asyncio
async def test_product_visual_parallel_gen_keys(mock_nest, product_visual_manifest):
    """AC-6: 同类型两 scheme 并行，prompt_hint 不同。"""
    state = {
        "flow_mode": "product_visual",
        "split_manifest": product_visual_manifest,
        "gen_ordered_keys": ["packaging_hero__c1", "packaging_hero__c2"],
    }
    # invoke start_gen → gen_scheduler dry-run
    hints = {i["key"]: i["prompt_hint"] for i in state["split_manifest"]}
    assert hints["packaging_hero__c1"] != hints["packaging_hero__c2"]
```

- [ ] **Step 2: Run — expect FAIL then PASS after wiring**

- [ ] **Step 3: Confirm AC-14** — manifest 中无 `target_type: video`

- [ ] **Step 4: Commit**

---

# Phase P4 — 定稿交付

### Task 7: delivery_summary + ProductVisualDeliveryCard

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/delivery_summary.py`
- Create: `apps/web/src/components/agent/ProductVisualDeliveryCard.vue`
- Modify: `services/agent-runtime/app/graph/subgraphs/product_visual_gate.py`
- Modify: `apps/web/src/components/agent/agentInterruptGate.ts`

**Interfaces:**
- Produces: `delivery_selections: dict[type_id, scheme_id]`；默认 `recommended` scheme（AC-7）
- Phase: `await_delivery_confirm` → `done`

- [ ] **Step 1: Write failing delivery default test**

```python
def test_delivery_defaults_to_recommended():
    from app.graph.nodes.delivery_summary import build_delivery_selections
    plan = {
        "image_types": [{
            "type_id": "hero_main",
            "schemes": [
                {"scheme_id": "c1", "recommended": False},
                {"scheme_id": "c2", "recommended": True},
            ],
            "selected_scheme_ids": ["c1", "c2"],
        }]
    }
    gen_by_key = {"hero_main__c1": {"url": "u1"}, "hero_main__c2": {"url": "u2"}}
    sel = build_delivery_selections(plan, gen_by_key)
    assert sel["hero_main"] == "c2"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement delivery_summary + Vue 卡片**

UI 要求（spec §Phase 4）：
- 按 **类型分组**（非写死图片布局 — 为二期 video 预留）
- 每类型展示候选缩略图；默认 recommended；切换不 regen
- 「微调重绘」仅当前类型定稿 scheme
- 「确认全部定稿」→ `done`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

# Phase CVS — 经典验证 + 生产 smoke

### Task 8: eval-cvs-set.yaml + test runner

**Files:**
- Create: `services/agent-runtime/skills/ecommerce-product-visual/eval-cvs-set.yaml`
- Create: `services/agent-runtime/tests/test_eval_cvs_set.py`
- Create: `deploy/prod-product-visual-cvs-verify.py`

**Interfaces:**
- YAML schema 对齐 spec §10.6
- Runner 断言：`assert_plan_types_include/exclude`, `assert_human_presence_in_delivery`, `flow_mode=product_visual`

- [ ] **Step 1: Create eval-cvs-set.yaml**（三案例 + 模特双通道子用例）

```yaml
schema_version: 1
cases:
  - id: CVS-01-ecommerce-listing
    utterance: "这是我们要上架的保温杯，帮我出一套电商推广图：天猫主图、详情图、模特展示图、模特手持使用的效果图、卖点图、推广海报。风格简约高级，强调316不锈钢和12小时保温。"
    requested_skill_id: ecommerce-product-visual
    assert_flow_mode: product_visual
    assert_plan_types_include: [hero_main, model_display, model_holding_product]
    assert_plan_types_exclude: [packaging_hero]
    assert_all_target_type: image
    assert_human_presence_in_delivery: true
  - id: CVS-02-product-packaging-crab
    utterance: "这是我们中秋要卖的大闸蟹，帮我设计礼盒和快递运输包装视觉，要保鲜防损。出包装效果图、冷链/缓冲结构示意，再加一张模特手持礼盒的送礼效果图，要有中秋节日氛围。"
    assert_plan_types_include: [packaging_hero, model_holding_pack]
    assert_plan_types_exclude: [promo_poster]
    assert_human_presence_in_delivery: true
  - id: CVS-03-interior-design
    utterance: "这是待装修客厅，出有人在里面的现代简约空间效果图、材质软装搭配板，沙发置入效果，最好有一位女性在客厅使用沙发的真实生活感。暖白原木色调。"
    assert_plan_types_include: [space_with_people, material_board, product_in_space]
    assert_plan_types_exclude: [packaging_hero, promo_poster]
    assert_qa_white_bg_relaxed: true
```

- [ ] **Step 2: Write test_eval_cvs_set.py**（plan 阶段 dry-run + manifest 断言；live gen 可选 `@pytest.mark.live`）

- [ ] **Step 3: Run eval — expect PASS on dry-run**

Run: `uv run pytest tests/test_eval_cvs_set.py -v`

- [ ] **Step 4: deploy smoke skeleton**

`deploy/prod-product-visual-cvs-verify.py`：至少跑 CVS-01 plan dry-run + route 断言。

- [ ] **Step 5: Commit**

---

### Task 9: 端到端 wiring + PR

**Files:**
- Modify: `services/agent-runtime/app/graph/builder.py`（完整 product_visual_gate 注册）
- Modify: `services/agent-runtime/app/graph/hitl_resume.py`（FRESH_TURN 清 product_visual 字段）

- [ ] **Step 1: Full graph compile smoke**

Run: `uv run python scripts/e2e_marketing_smoke.py --flow product_visual --dry-run`（若无脚本则 `tests/test_subgraph_gates.py` 增 case）

- [ ] **Step 2: Full pytest suite**

Run: `uv run pytest tests/test_product_visual*.py tests/test_eval_cvs_set.py tests/test_subgraph_gates.py -v`

- [ ] **Step 3: Frontend build**

Run: `pnpm --filter @lnkpi/web build`

- [ ] **Step 4: Update spec 元数据**

`2026-08-10-ecommerce-product-visual-design.md` 实现计划行 → 链接本文件。

- [ ] **Step 5: PR**

PR body 映射 AC-1~AC-14 + CVS 三案例；注明 **一期不含 video**。

---

## AC → Task 映射（自检）

| AC | Task |
|----|------|
| AC-1~AC-3 | Task 2 |
| AC-4a~AC-4f | Task 3 + Task 8 |
| AC-5~AC-7 | Task 4 + Task 7 |
| AC-8 | Task 5 + Task 7 |
| AC-9 | Task 4 |
| AC-10~AC-13 | Task 8 |
| AC-14 | Task 5 + Task 6 + Task 8 |

## 二期边界（本计划不实现）

- P5-Video：`VideoType[]`, `video_node`, 视频定稿 UI → 见 spec 附录 B
- 不在本 plan 创建 `…-product-visual-video-design.md`（一期 CVS 通过后另起）

---

## Self-Review Checklist

- [x] Spec §Phase 1~4 均有对应 Task
- [x] L12 / AC-14 video 排除在 Task 5/6/8 断言中
- [x] 无 TBD/TODO 占位步骤
- [x] `target_type` / `flow_mode` / state key 命名与 spec 一致
- [x] CVS 三案例覆盖电商 / 包装 / 室内装修 + 人感基线
