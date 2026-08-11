# Product Visual Scheme v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现规格 v1.1（prose SSOT + L1/L2/L3 + lazy seed + per-shot orchestrate），在 `product_visual_scheme_v2=true` 时替换 legacy JSON plan 主路径。

**Architecture:** 新增 `app/graph/product_visual_v2/` 纯函数 + `nodes/*_v2.py` LangGraph 节点；`product_visual_gate.py` 按 flag 分支 v1/v2；Phase 3c/4 复用 `gen_scheduler`/`delivery_summary`（delivery 键改为 shot_id）。前端新增 macro/shot 门控 chipSet。

**Tech Stack:** LangGraph, pytest, Vue 3 (`AgentSideRail.vue`, `agentInterruptGate.ts`), Nest canvas tools.

**Spec:** [2026-08-11-product-visual-phase2-scheme-ssot-design.md](../specs/2026-08-11-product-visual-phase2-scheme-ssot-design.md)  
**TDD:** [test-cases.md](../specs/2026-08-11-product-visual-phase2-scheme-ssot-test-cases.md)  
**UAT:** [uat.md](../specs/2026-08-11-product-visual-phase2-scheme-ssot-uat.md)

## Global Constraints

- `product_visual_scheme_v2` 默认 `true`；`false` 保留 legacy `plan_product_visual` 路径
- `max_downstream = 12`；`max_macro_schemes_selected = 2`；`max_shots_per_macro_scheme = 8`
- shot_id 格式 `{type_id}__{seq}`；禁止 prompt 融合；每 shot 定稿 exactly 1 张
- 2c 前 **禁止** `upsert_prompt_node`；SSOT = 画布 prose 唯一真相
- lazy seed 默认：SSOT 早于 white_bg gen
- Pre-PR: `cd services/agent-runtime && uv run pytest tests/test_product_visual*.py tests/test_eval_cvs_set*.py -v`

---

## File Map

| File | Action |
|------|--------|
| `app/graph/product_visual_v2/*` | Exists — limits, models, macro, ssot, routing, vision, synthesize |
| `app/graph/nodes/dialog_draft.py` | Create |
| `app/graph/nodes/macro_scheme_select_gate.py` | Create |
| `app/graph/nodes/canvas_ssot_commit.py` | Create |
| `app/graph/nodes/decompose_from_ssot.py` | Create |
| `app/graph/nodes/orchestrate_shots_v2.py` | Create |
| `app/graph/subgraphs/product_visual_gate.py` | Modify — v2 edges |
| `app/graph/hitl_resume.py` | Modify — macro/shot gates |
| `skills/.../assets/prompts/dialog-draft/1.0.0.md` | Create |
| `skills/.../assets/prompts/decompose-shots/1.0.0.md` | Create |
| `tests/test_product_visual_v2_core.py` | Create |
| `tests/test_product_visual_v2_nodes.py` | Create |
| `eval-cvs-set-v2.yaml` + `test_eval_cvs_set_v2.py` | Create |
| `deploy/prod-product-visual-cvs-v2-live.py` | Create |
| `apps/web/.../agentInterruptGate.ts` | Modify |
| `apps/web/.../AgentSideRail.vue` | Modify |

---

### Task 1: L1 纯函数测试 + 绿

**Files:** `tests/test_product_visual_v2_core.py`, `app/graph/product_visual_v2/*`

- [ ] 覆盖 P3-DEC-004, P2-MACRO-003/004, P1-VQA-001, P3-SYN-001, P2-SSOT A+B

---

### Task 2: dialog_draft + macro_scheme_select 节点

**Files:** `nodes/dialog_draft.py`, `nodes/macro_scheme_select_gate.py`, prompts

- [ ] FakeLLM 双输出测试；单方案跳过 HITL

---

### Task 3: canvas_ssot_commit + decompose_from_ssot

**Files:** `nodes/canvas_ssot_commit.py`, `nodes/decompose_from_ssot.py`

- [ ] 2c 前 zero upsert；CVS-02 ≥3 shots

---

### Task 4: orchestrate_shots_v2 + lazy seed + graph 接线

**Files:** `orchestrate_shots_v2.py`, `product_visual_gate.py`

- [ ] v2 全链至 `await_topo`；legacy flag 回归

---

### Task 5: delivery shot_id + hitl_resume + 前端 macro 卡片

**Files:** `delivery_summary.py`, `hitl_resume.py`, web components

---

### Task 6: eval-cvs-set-v2 + prod smoke

**Files:** `eval-cvs-set-v2.yaml`, `deploy/prod-product-visual-cvs-v2-live.py`

---
