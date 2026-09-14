# Agent Atomic Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bare-media / workflow utterances (e.g. 「生图生视频…提示词…dock」) from routing into `atomic_create` via `atomic_generate` / `media_create_high`, so they land on `canvas_agent`—without opening `run_*` to the model or deleting the atomic subgraph yet.

**Architecture:** Production defaults to `LNKPI_ROUTE_LLM_PRIMARY=0` and uses full `apply_route_precedence`. Therefore 2a must remove `atomic_generate` from **both** `HARD_SHORTCIRCUIT_RULE_IDS` and the live `PRECEDENCE_RULES` competition (not HARD alone). Keep `media_create_high` as a soft `RouteFeatures` bit if useful later; it must not set `flow_mode=atomic_create`. Audit sibling rules; fix only proven workflow false positives.

**Tech Stack:** Python 3.11+, pytest, `services/agent-runtime` routing (`route_hard`, `route_precedence`, `route_decide`, `route_features`).

**Spec:** [docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md](../specs/2026-09-14-agent-atomic-as-tools-design.md)（已批准；执行令仅 2a）

## Global Constraints

- **H1:** `run_*_generation` / destructive never enter `model_visible_specs` (unchanged this phase).
- **D9:** This plan is **Phase 2a only**. Do not implement `propose_generation`, HITL unify, or delete `atomic_create` subgraph.
- **§0.2:** `atomic_generate` exits HARD **and** precedence; **exception list is empty**.
- **§6.0.1 2a 硬表（A1–A10）：** 唯一合入门禁；禁止用「非 atomic / 迹象」模糊过关。摘要：
  - **A1** `atomic_generate` ∉ HARD
  - **A2** hard(WORKFLOW) is `None`
  - **A3/A5** precedence + `decide_route(primary=False)` on WORKFLOW → `flow_mode=canvas_agent`
  - **A6** 显式「帮我生成一张…」→ `canvas_agent`（不要求 propose）
  - **A7** `@T1 请基于文案生成视频` → `ref_backed_generate`
  - **A8** 「你好」→ `canvas_agent`
  - **A9** `run_*` ∉ visible（回归）
  - **A10** 生产冒烟：无原子确认卡
- Prefer TDD: failing test → minimal code → pass → commit per task.
- Branch: `feature/agent-atomic-phase-2a` from latest `main` (or current worktree main).
- Do **not** change Nest `/agent/internal/*` contracts.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-14-codex-style-tool-plan-harness-design.md` | Banner: V7 superseded; out-paint path → atomic-as-tools spec |
| `docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md` | Banner: run_* still forbidden; propose/摆盘 deferred to 2b+ |
| `services/agent-runtime/app/graph/route_hard.py` | Drop `atomic_generate` from `HARD_SHORTCIRCUIT_RULE_IDS` |
| `services/agent-runtime/app/graph/route_precedence.py` | Stop `_rule_atomic_generate` competing (unregister or always `None`) |
| `services/agent-runtime/app/graph/route_features.py` | Keep soft `media_create_high` if needed; document non-routing |
| `services/agent-runtime/tests/test_route_hard.py` | Update appendix-A expectations; workflow non-hit |
| `services/agent-runtime/tests/test_route_precedence.py` | atomic_generate no longer wins |
| `services/agent-runtime/tests/test_decide_lane.py` | Hard no longer short-circuits explicit gen when primary on |
| `services/agent-runtime/tests/test_route_decide_explore.py` or new `test_phase_2a_atomic_retire.py` | 2a gold utterance + sibling audit |
| `services/agent-runtime/skills/atomic-create/eval-route-set.yaml` | Align cases that expected atomic via bare keywords (if any) |

---

### Task 0: Branch + spec banners

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-codex-style-tool-plan-harness-design.md`
- Modify: `docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md`
- (Already approved) `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md`

- [ ] **Step 1: Create branch**

```bash
cd /Users/4seven/workspace/lnkpi/.worktrees/feature-canvas-workflow-exchange
git fetch origin main
git checkout -b feature/agent-atomic-phase-2a origin/main
```

- [ ] **Step 2: Harness banner (after title)**

```markdown
> **出图路径修订（2026-09-14 Phase 2a）：** 「出图 / `media_create_high` → atomic 子图主路径」及本文件 **V7** 硬约束，由 [2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md) **废止并替换**：默认 `canvas_agent` 摆盘；计费 `run_*` 仍禁止 bind。`atomic_generate` 退出 hard/precedence 竞争。
```

- [ ] **Step 3: CS control-surface banner**

```markdown
> **CS-4 收窄说明（2026-09-14）：** 禁止 explore/agent **bind 计费** `run_*_generation` / destructive **仍然有效**。画布摆盘与 `propose_generation`（不扣积分）见 [agent-atomic-as-tools](./2026-09-14-agent-atomic-as-tools-design.md)（Phase 2b+）。
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-14-codex-style-tool-plan-harness-design.md \
  docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md \
  docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md \
  docs/superpowers/plans/2026-09-14-agent-atomic-phase-2a.md
git commit -m "$(cat <<'EOF'
docs: approve agent-atomic-as-tools; Phase 2a plan + banners

EOF
)"
```

---

### Task 1: Failing 2a gold + sibling audit tests

**Files:**
- Create: `services/agent-runtime/tests/test_phase_2a_atomic_retire.py`
- Modify (expect fail first): existing hard/precedence tests later in Task 2–3

**Interfaces:**
- Consumes: `assemble_route_context`, `decide_route`, `apply_hard_shortcircuit`, `apply_route_precedence`
- Produces: locked utterances for CI

- [ ] **Step 1: Write failing tests**

```python
"""Phase 2a: atomic_generate must not hijack workflow utterances."""

from __future__ import annotations

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route
from app.graph.route_features import extract_route_features
from app.graph.route_hard import HARD_SHORTCIRCUIT_RULE_IDS, apply_hard_shortcircuit
from app.graph.route_precedence import apply_route_precedence

WORKFLOW = (
    "我期望的工作流不是全都是提示词节点，"
    "我期望通过画布的各类节点骨架连接好直接生图生视频，"
    "提示词自动填入到dock"
)


def test_a1_atomic_generate_not_in_hard_ids():
    assert "atomic_generate" not in HARD_SHORTCIRCUIT_RULE_IDS


def test_a2_workflow_hard_is_none():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    intent = resolve_atomic_intent(WORKFLOW)
    features = extract_route_features(ctx, intent)
    assert apply_hard_shortcircuit(intent, features, ctx) is None


def test_a3_a4_workflow_precedence_is_canvas_agent():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    intent = resolve_atomic_intent(WORKFLOW)
    features = extract_route_features(ctx, intent)
    raw = apply_route_precedence(intent, features, ctx)
    assert raw["flow_mode"] == "canvas_agent"
    assert raw.get("precedence_rule_id") == "default_chat"


def test_a5_workflow_decide_route_default_is_canvas_agent():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"


def test_a6_explicit_gen_decide_route_is_canvas_agent():
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我生成一张蓝色天空主图"}]}
    )
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"


def test_a7_sibling_ref_backed_kept():
    utt = "@T1 请基于文案生成视频"
    ctx = assemble_route_context({"messages": [{"role": "user", "content": utt}]})
    ctx = {**ctx, "mentioned_keys": ["T1"], "utterance": utt}
    intent = resolve_atomic_intent(utt, mentioned_keys=["T1"])
    features = extract_route_features(ctx, intent)
    raw = apply_route_precedence(intent, features, ctx)
    assert raw.get("precedence_rule_id") == "ref_backed_generate"
    assert raw["flow_mode"] == "atomic_create"


def test_a8_greeting_is_canvas_agent():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_phase_2a_atomic_retire.py -v
```

Expected: FAIL (`atomic_generate` still in HARD / precedence hits workflow).

- [ ] **Step 3: Commit failing tests**

```bash
git add services/agent-runtime/tests/test_phase_2a_atomic_retire.py
git commit -m "$(cat <<'EOF'
test(agent-runtime): Phase 2a gold — workflow must not atomic_generate

EOF
)"
```

---

### Task 2: Remove `atomic_generate` from HARD + precedence

**Files:**
- Modify: `services/agent-runtime/app/graph/route_hard.py`
- Modify: `services/agent-runtime/app/graph/route_precedence.py` (`PRECEDENCE_RULES` tuple — remove `("atomic_generate", _rule_atomic_generate)` entry; keep function body with deprecation docstring for 2d cleanup)
- Modify: `services/agent-runtime/tests/test_route_hard.py`
- Modify: `services/agent-runtime/tests/test_route_precedence.py`
- Modify: `services/agent-runtime/tests/test_decide_lane.py`

**Interfaces:**
- Produces: `HARD_SHORTCIRCUIT_RULE_IDS` without `atomic_generate`
- Produces: `apply_route_precedence` never returns `precedence_rule_id=atomic_generate`

- [ ] **Step 1: Update `test_route_hard.py` expectations**

- Remove `atomic_generate` from `_APPENDIX_A_HARD_IDS`.
- Change `test_explore_not_in_hard_ids` → assert `"atomic_generate" not in HARD_SHORTCIRCUIT_RULE_IDS`.
- Replace `test_hard_hits_atomic_generate` with:

```python
def test_hard_skips_former_atomic_generate():
    d = _hard({"messages": [{"role": "user", "content": "帮我生成一张蓝牙耳机主图"}]})
    assert d is None
```

- [ ] **Step 2: Update precedence / decide_lane tests**

- `test_precedence_atomic_generate`: expect **not** `atomic_generate` (e.g. `default_chat` / `canvas_agent`).
- `test_hard_shortcircuit_skips_llm_when_media_create` (in `test_decide_lane.py`): with `primary_on`, explicit gen should **call LLM** or fall through to canvas_agent—not hard `atomic_generate`. Update assertion accordingly (LLM may return `atomic_create` until 2d—**2a allows** either `canvas_agent` or LLM-chosen lane, but **not** hard short-circuit with `llm.calls == 0` due to `atomic_generate`).

Recommended 2a assertion for former hard test:

```python
def test_explicit_gen_no_longer_hard_skips_llm(primary_on):
    llm = FakeLLM(json.dumps({
        "lane": "canvas_agent",
        "confidence": 0.9,
        "reason": "agent_will_place_nodes",
        "clarify_question": None,
    }))
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我生成一张蓝牙耳机主图"}]}
    )
    d = decide_route(ctx, llm=llm)
    assert d.get("precedence_rule_id") != "atomic_generate"
    assert llm.calls >= 1
    assert d["flow_mode"] == "canvas_agent"
```

- [ ] **Step 3: Implement — `route_hard.py`**

Remove `"atomic_generate"` from `HARD_SHORTCIRCUIT_RULE_IDS`.

- [ ] **Step 4: Implement — `route_precedence.py`**

Remove `("atomic_generate", _rule_atomic_generate)` from `PRECEDENCE_RULES`. Keep `_rule_atomic_generate` defined with:

```python
def _rule_atomic_generate(...):
    """Deprecated Phase 2a: no longer registered in PRECEDENCE_RULES / HARD."""
    return None
```

- [ ] **Step 5: Run tests**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_phase_2a_atomic_retire.py tests/test_route_hard.py tests/test_route_precedence.py tests/test_decide_lane.py tests/test_route_decide_explore.py -v
```

Expected: PASS for 2a gold; fix any collateral failures without reintroducing `atomic_generate`.

- [ ] **Step 6: Commit**

```bash
git add services/agent-runtime/app/graph/route_hard.py \
  services/agent-runtime/app/graph/route_precedence.py \
  services/agent-runtime/tests/test_route_hard.py \
  services/agent-runtime/tests/test_route_precedence.py \
  services/agent-runtime/tests/test_decide_lane.py \
  services/agent-runtime/tests/test_phase_2a_atomic_retire.py
git commit -m "$(cat <<'EOF'
fix(agent-runtime): retire atomic_generate hard/precedence (Phase 2a)

EOF
)"
```

---

### Task 3: Sibling-rule audit writeup + eval-route-set align

**Files:**
- Modify: `services/agent-runtime/tests/test_phase_2a_atomic_retire.py` (audit cases)
- Modify: `services/agent-runtime/skills/atomic-create/eval-route-set.yaml` (only if cases assert bare-keyword → atomic)
- Optional note in `.superpowers/sdd/` only if repo already uses it—prefer comment block in the test file

- [ ] **Step 1: Add audit matrix tests**

Lock §6.0.1 A1–A8 in `test_phase_2a_atomic_retire.py` (no alternate rule ids). Optional extra audit (not required for merge): focus-node → `focus_gen` if fixture is cheap.

If any sibling (other than A7 KEEP) maps WORKFLOW → `atomic_create`, fix that rule in the same PR with a dedicated failing-then-passing test.

- [ ] **Step 2: Align eval-route-set**

```bash
rg -n "atomic_create|生成视频|生图" skills/atomic-create/eval-route-set.yaml
```

Update expectations for bare-keyword rows that assumed atomic via `atomic_generate`. Do **not** weaken `@ref` / focus cases without audit note.

- [ ] **Step 3: Full routing regression slice**

```bash
cd services/agent-runtime
python3.11 -m pytest tests/test_route_hard.py tests/test_route_precedence.py tests/test_route_decide_explore.py tests/test_decide_lane.py tests/test_phase_2a_atomic_retire.py tests/test_graph_routes.py -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/agent-runtime/tests/test_phase_2a_atomic_retire.py \
  services/agent-runtime/skills/atomic-create/eval-route-set.yaml
git commit -m "$(cat <<'EOF'
test(agent-runtime): Phase 2a sibling audit + eval-route-set align

EOF
)"
```

---

### Task 4: Verify soft feature still non-routing + smoke

**Files:**
- Modify only if needed: `services/agent-runtime/app/graph/route_features.py` (comment that `media_create_high` is soft-only post-2a)
- Test: `services/agent-runtime/tests/test_route_features.py`

- [ ] **Step 1: Assert soft bit can remain True without atomic flow**

```python
def test_media_create_high_soft_does_not_imply_route():
    # WORKFLOW may still set media_create_high True; decide_route must be canvas_agent
    ...
```

If `media_create_high` staying True confuses future code, optionally narrow `VIDEO_KEYWORDS` out of `utterance_suggests_atomic_create` **only if** tests prove soft bit causes other rules to fire. Prefer **not** rewriting the whole hint table in 2a.

- [ ] **Step 2: Run features + decide tests**

```bash
python3.11 -m pytest tests/test_route_features.py tests/test_phase_2a_atomic_retire.py -v
```

- [ ] **Step 3: Commit if code/comments changed**

```bash
git commit -m "$(cat <<'EOF'
docs(agent-runtime): note media_create_high is soft-only after Phase 2a

EOF
)"
```

---

### Task 5: PR checklist (stop — no 2b)

- [ ] **Step 1: Confirm out of scope**

No `propose_generation`, no Nest confirm unify, no deleting `await_atomic_confirm` node, no Phase 3.

- [ ] **Step 2: Open PR**

Title: `fix(agent-runtime): Phase 2a retire atomic_generate routing hijack`

Body must cite:

- Spec §0.2 / §6.0 2a gold
- Plan `2026-09-14-agent-atomic-phase-2a.md`
- Explicit: **2b not included**

- [ ] **Step 3: After merge — production smoke (manual)**

With user `defaultTextModel` passed as `model` (UI behavior):

1. WORKFLOW utterance → `flow_mode=canvas_agent`, no 「基于引用内容生成视频」 atomic card.  
2. 「你好」 → canvas_agent.  
3. Optional: 「帮我生成一张…」 → canvas_agent (may not create node yet—2b).

Do **not** start 2b until this PR is green and smoke noted.

---

## Rollback

- Emergency only: re-register `("atomic_generate", _rule_atomic_generate)` in `PRECEDENCE_RULES` and restore HARD id behind env flag (if added).  
- **Never** restore zero-tool `chat`.

## Done when（= §6.0.1 A1–A10 全绿）

- [x] Spec approved with D9 / §0.2 / §6.0.1  
- [ ] **A1** `atomic_generate` ∉ HARD；且已从 `PRECEDENCE_RULES` 注销竞争  
- [ ] **A2–A5** WORKFLOW → hard `None`；precedence + `decide_route(primary=False)` → `canvas_agent`（A4：`default_chat`）  
- [ ] **A6** 显式出图 → `canvas_agent`（无 propose 要求）  
- [ ] **A7** `@T1…生成视频` → `ref_backed_generate`  
- [ ] **A8** 「你好」→ `canvas_agent`  
- [ ] **A9** `run_*` ∉ visible 回归通过  
- [ ] **A10** 生产冒烟通过（合入后可记在 PR）  
- [ ] Harness + CS banners landed  
- [ ] PR 范围仅 2a；**不**开 2b
