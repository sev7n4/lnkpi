# Intent Planning Guard Implementation Plan (Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Roadmap:** 本计划为 **Phase B**。Phase C（LLM 结构化 parse）见 [2026-08-05-intent-llm-structured-parse.md](./2026-08-05-intent-llm-structured-parse.md)，**B 过 Gate 后方可启动 C**。

**Goal:** 防止「主图/详情页/构图方案」等 planning 型 utterance 误走 image 直出；通过 Planning Guard + Clarify + Eval 系统性提升 Action 理解。

**Architecture:** 新增 `planning_guard.py` 提供 action/planning 检测与 confidence cap；扩展 `orchestration_complexity_intent` 将 planning+详情页路由至 campaign；`validate_parse_result` 与 `rule_parse_confidence` 在冲突时强制 clarify；新增 25 case eval gold set。

**Tech Stack:** Python 3.11, pytest, YAML eval sets, LangGraph agent-runtime

**Design spec:** [2026-08-05-intent-planning-guard-design.md](../specs/2026-08-05-intent-planning-guard-design.md)（含 B→C 总览）

## Global Constraints

- `CLARIFY_THRESHOLD = 0.70`（不变）
- `RULE_FAST_PATH_THRESHOLD = 0.95`（不变）
- planning conflict 时 confidence cap ≤ **0.65**
- 明确「生成一张/来一张」类 utterance 不得回归
- 中文 clarify 文案
- 本阶段不改 TS promptMode / Nest Studio 生产层

---

## File Map

| File | Responsibility |
|------|----------------|
| `services/agent-runtime/app/graph/planning_guard.py` | **Create** — action/planning detection, confidence cap, clarify templates |
| `services/agent-runtime/tests/test_planning_guard.py` | **Create** — unit tests |
| `services/agent-runtime/app/graph/atomic_intent.py` | **Modify** — extend orchestration campaign phrases |
| `services/agent-runtime/app/graph/atomic_parse_util.py` | **Modify** — cap rule confidence via planning_guard |
| `services/agent-runtime/app/graph/atomic_parse_schema.py` | **Modify** — planning conflict → clarify in validate |
| `services/agent-runtime/app/graph/atomic_parse_llm.py` | **Modify** — system prompt action/scope hints |
| `services/agent-runtime/skills/atomic-create/eval-planning-guard-set.yaml` | **Create** — 25 gold cases |
| `services/agent-runtime/tests/test_planning_guard_eval.py` | **Create** — eval runner |
| `services/agent-runtime/skills/atomic-create/eval-orchestration-set.yaml` | **Modify** — +5 cases |
| `services/agent-runtime/skills/atomic-create/eval-intent-set.yaml` | **Modify** — +3 cases |
| `deploy/prod-atomic-studio-verify.py` | **Modify** — optional planning smoke (Task 6) |

---

### Task 1: Planning Guard 核心模块

**Files:**
- Create: `services/agent-runtime/app/graph/planning_guard.py`
- Create: `services/agent-runtime/tests/test_planning_guard.py`

**Interfaces:**
- Produces: `detect_action`, `is_planning_intent`, `is_explicit_generation_intent`, `has_planning_image_conflict`, `planning_guard_confidence_cap`, `planning_clarify_question`

- [ ] **Step 1: Write failing tests**

```python
# services/agent-runtime/tests/test_planning_guard.py
from app.graph.planning_guard import (
    detect_action,
    has_planning_image_conflict,
    is_explicit_generation_intent,
    is_planning_intent,
    planning_clarify_question,
    planning_guard_confidence_cap,
)


def test_design_detail_page_planning_conflict():
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert is_planning_intent(u)
    assert has_planning_image_conflict(u)
    assert not is_explicit_generation_intent(u)


def test_generate_single_hero_not_planning_conflict():
    u = "生成一张蓝牙耳机主图"
    assert is_explicit_generation_intent(u)
    assert not has_planning_image_conflict(u)


def test_confidence_cap_on_conflict():
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert planning_guard_confidence_cap(u, 0.96) <= 0.65


def test_clarify_question_nonempty():
    q = planning_clarify_question("主图详情页构图方案")
    assert "1" in q and "2" in q and "Campaign" in q or "方案" in q
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python3 -m pytest tests/test_planning_guard.py -v`  
Expected: FAIL — module not found

- [ ] **Step 3: Implement planning_guard.py**

```python
# services/agent-runtime/app/graph/planning_guard.py
"""Planning Guard — distinguish plan/design vs generate/create utterances."""

from __future__ import annotations

import re
from typing import Literal

ActionKind = Literal["plan", "write", "generate", "expand", "unknown"]

PLANNING_VERBS = (
    "视觉方案",
    "视觉策划",
    "构图方案",
    "构图",
    "策划",
    "规划",
    "结构",
    "框架",
    "思路",
    "布局",
    "模块",
    "方案",
    "设计",
)

GENERATION_PATTERNS = (
    r"生成一张",
    r"生成一个",
    r"来一张",
    r"做一张",
    r"出一张",
    r"直接生成",
    r"帮我生成一张",
    r"帮我做一张",
    r"帮我生成一个",
)

WRITE_VERBS = ("写", "撰写", "起草", "输出文案")

EXPAND_MARKERS = ("提示词", "prompt", "扩写")

PLANNING_CONFIDENCE_CAP = 0.65


def detect_action(text: str) -> ActionKind:
    t = (text or "").strip()
    if not t:
        return "unknown"
    if any(m in t for m in EXPAND_MARKERS):
        return "expand"
    if is_explicit_generation_intent(t):
        return "generate"
    if any(v in t for v in WRITE_VERBS):
        return "write"
    if is_planning_intent(t):
        return "plan"
    return "unknown"


def is_planning_intent(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if any(v in t for v in PLANNING_VERBS):
        return True
    if "详情页" in t and any(x in t for x in ("构图", "方案", "结构", "布局", "模块")):
        return True
    return False


def is_explicit_generation_intent(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    for pat in GENERATION_PATTERNS:
        if re.search(pat, t):
            return True
    # 「设计一张海报」→ generate
    if re.search(r"设计一[张个]", t):
        return True
    return False


def has_planning_image_conflict(text: str) -> bool:
    """True when planning semantics + ecommerce asset nouns without explicit generation."""
    t = (text or "").strip()
    if not t or is_explicit_generation_intent(t):
        return False
    if not is_planning_intent(t):
        return False
    asset_hit = any(k in t for k in ("主图", "详情页", "白底", "场景图", "banner", "Banner"))
    return asset_hit


def planning_guard_confidence_cap(text: str, base_conf: float) -> float:
    if has_planning_image_conflict(text):
        return min(base_conf, PLANNING_CONFIDENCE_CAP)
    if is_planning_intent(text) and not is_explicit_generation_intent(text):
        return min(base_conf, PLANNING_CONFIDENCE_CAP)
    return base_conf


def planning_clarify_question(utterance: str) -> str:
    snippet = (utterance or "").strip()[:32]
    return (
        f"您提到「{snippet}…」涉及主图/详情页与构图方案。请确认：\n"
        "1）单张主图直接出图；\n"
        "2）完整详情页 Campaign 方案（多节点：主图/白底/场景等）；\n"
        "3）只要文字版构图策划（不出图）。\n"
        "回复 1 / 2 / 3，或补充具体需求。"
    )
```

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && python3 -m pytest tests/test_planning_guard.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/planning_guard.py services/agent-runtime/tests/test_planning_guard.py
git commit -m "feat(agent): add planning_guard for plan vs generate intent"
```

---

### Task 2: Orchestration — planning → campaign

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_intent.py`
- Modify: `services/agent-runtime/tests/test_atomic_create_intent.py` (or existing orchestration tests)

**Interfaces:**
- Consumes: `planning_guard.is_planning_intent`, `has_planning_image_conflict`, `is_explicit_generation_intent`
- Produces: extended `orchestration_complexity_intent` returning `campaign` for planning+详情页 patterns

- [ ] **Step 1: Write failing test**

```python
def test_orchestration_design_detail_page_is_campaign():
    from app.graph.atomic_intent import orchestration_complexity_intent
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert orchestration_complexity_intent(u) == "campaign"
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Extend atomic_intent.py**

In `orchestration_complexity_intent`, after existing campaign phrase checks, add:

```python
from app.graph.planning_guard import has_planning_image_conflict, is_planning_intent

# inside orchestration_complexity_intent, early in function:
if has_planning_image_conflict(t):
    return "campaign"
if "详情页" in t and is_planning_intent(t):
    return "campaign"
```

Also extend `CAMPAIGN_COMPLEXITY_PHRASES`:

```python
CAMPAIGN_COMPLEXITY_PHRASES = (
    ...
    "详情页构图",
    "详情页的构图",
    "构图方案",
    "视觉方案",
)
```

- [ ] **Step 4: Run orchestration + planning tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): route planning+详情页 utterances to campaign orchestration"
```

---

### Task 3: Rule confidence cap + validate clarify

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_parse_util.py` (`rule_parse_confidence`)
- Modify: `services/agent-runtime/app/graph/atomic_parse_schema.py` (`validate_parse_result`)
- Test: `services/agent-runtime/tests/test_atomic_parse_schema.py` (create if missing)

- [ ] **Step 1: Write failing test**

```python
def test_rule_confidence_capped_for_planning_conflict():
    from app.graph.atomic_parse_util import rule_parse_confidence
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    spec = {"target_type": "image", "prompt": u}
    assert rule_parse_confidence(u, spec, None) <= 0.65


def test_validate_parse_planning_conflict_clarifies():
    from app.graph.atomic_parse_schema import validate_parse_result
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    out = validate_parse_result(
        {"items": [{"target_type": "image", "prompt": u, "title": "x"}], "confidence": 0.96},
        utterance=u,
    )
    assert out["kind"] == "clarify"
    assert "1" in out["clarify_question"]
```

- [ ] **Step 2: Implement cap in rule_parse_confidence**

```python
from app.graph.planning_guard import planning_guard_confidence_cap

# at end of rule_parse_confidence, before return:
return planning_guard_confidence_cap(t, computed_conf)
```

- [ ] **Step 3: Implement validate_parse_result guard**

At top of `validate_parse_result`, after invalid payload check:

```python
from app.graph.planning_guard import has_planning_image_conflict, planning_clarify_question

if has_planning_image_conflict(utterance):
    return {
        "kind": "clarify",
        "confidence": 0.0,
        "reason": "planning_image_conflict",
        "clarify_question": planning_clarify_question(utterance),
    }
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): planning guard caps rule confidence and triggers clarify"
```

---

### Task 4: LLM parse prompt + parse_atomic_target_type 微调

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_parse_llm.py`
- Modify: `services/agent-runtime/app/graph/atomic_intent.py` (`parse_atomic_target_type`)

- [ ] **Step 1: Add to `_PARSE_SYSTEM` in atomic_parse_llm.py**

```
- 「设计/构图方案/详情页策划」且无「生成一张/来一张」→ needs_clarify 或 target_type=text，confidence<0.7
- 「主图+详情页+方案」→ 建议 Campaign，勿直接 image
- 明确「生成一张主图」→ image，confidence≥0.9
```

- [ ] **Step 2: In parse_atomic_target_type, before IMAGE_KEYWORDS check**

```python
from app.graph.planning_guard import is_planning_intent, is_explicit_generation_intent

if is_planning_intent(t) and not is_explicit_generation_intent(t):
    if any(k in t for k in TEXT_DEFAULT_KEYWORDS) or "构图" in t or "方案" in t:
        return "text"
```

- [ ] **Step 3: Run full atomic intent tests — PASS, no regression on img-01..06**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent): LLM parse and target_type respect planning intent"
```

---

### Task 5: Eval gold sets

**Files:**
- Create: `services/agent-runtime/skills/atomic-create/eval-planning-guard-set.yaml`
- Create: `services/agent-runtime/tests/test_planning_guard_eval.py`
- Modify: `eval-orchestration-set.yaml`, `eval-intent-set.yaml`

- [ ] **Step 1: Create eval-planning-guard-set.yaml** (25 cases per spec §5.1)

Minimum required cases:

```yaml
- id: pg-01
  utterance: 请你帮我设计一个蓝牙耳机主图，详情页的构图方案
  gold: { route: campaign, allow_clarify: true, forbid_target: image }

- id: pg-ctrl-01
  utterance: 生成一张蓝牙耳机主图
  gold: { route: atomic_create, target_type: image, min_confidence: 0.90 }
```

- [ ] **Step 2: Implement test_planning_guard_eval.py**

Mirror `test_orchestration_intent_eval.py` pattern: for each case assert `resolve_intake_route`, `orchestration_complexity_intent`, and/or `validate_parse_result` outcome.

- [ ] **Step 3: Add to eval-intent-set.yaml**

```yaml
- id: plan-01
  utterance: 请你帮我设计一个蓝牙耳机主图，详情页的构图方案
  focus_node_id: null
  gold: { route: campaign, target_type: null }
  notes: planning guard — must not image fast path
```

- [ ] **Step 4: Run all eval tests — 100% pass, zero regression**

Run:
```bash
cd services/agent-runtime && python3 -m pytest tests/test_planning_guard_eval.py tests/test_atomic_create_intent_eval.py tests/test_orchestration_intent_eval.py -v
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test(agent): add planning guard eval gold set (25 cases)"
```

---

### Task 6: Production smoke (optional)

**Files:**
- Modify: `deploy/prod-atomic-studio-verify.py`

- [ ] **Step 1: Add verify_planning_guard function**

```python
PLANNING_UTTERANCE = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"

def verify_planning_guard(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"P4-planning-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, types, exit_reason = sse_collect(tok, sid, PLANNING_UTTERANCE, tid, timeout=SSE_TIMEOUT_SEC)
    not_image_atomic = "image 节点（直达）" not in text or "确认" in text or "方案" in text
    record("planning guard not image direct", not_image_atomic, text[:160])
```

- [ ] **Step 2: Run locally against prod after deploy**

- [ ] **Step 3: Commit**

```bash
git commit -m "test(deploy): prod smoke for planning guard utterance"
```

---

## Self-Review (spec coverage)

| Spec § | Task |
|--------|------|
| Planning Guard 模块 | Task 1 |
| orchestration → campaign | Task 2 |
| confidence cap + clarify | Task 3 |
| LLM parse hints | Task 4 |
| Eval 25 cases | Task 5 |
| prod smoke | Task 6 |
| 「生成一张主图」不回归 | Task 5 control cases + existing eval |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-05-intent-planning-guard.md`.

**Phase C**（后续）：[2026-08-05-intent-llm-structured-parse-design.md](../specs/2026-08-05-intent-llm-structured-parse-design.md) + [plan](../plans/2026-08-05-intent-llm-structured-parse.md)

**Two execution options (Phase B only):**

1. **Subagent-Driven (recommended)** — 按 Task 1→6 分派 subagent，每 task 后 review  
2. **Inline Execution** — 本会话内用 executing-plans 批量实现，checkpoint Review

你选哪种？确认后我即可开始 Task 1。
