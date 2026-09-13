# Explore `import_workflow` + Tool Placement Invariants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Agent conversation call `import_workflow` via explore (routing + bind), and enforce tool `placement` / orphan invariants so registered tools cannot hang unused again.

**Architecture:** Extend Hybrid A registry with explicit `ToolPlacement` (`explore` | `graph_node` | `ui_command`). Move `import_workflow` into `EXPLORE_TOOL_NAMES` with workflow routing verbs and narrow-bind rules. CI tests assert specs ↔ placement ↔ explore whitelist ↔ graph call sites (or an explicit deferred allowlist).

**Tech Stack:** Python 3.11+, pytest, existing `services/agent-runtime` explore graph (`explore_route`, `explore_dispatch`, `tool_registry`, `definitions`).

**Spec:** [docs/superpowers/specs/2026-09-13-explore-import-workflow-placement-design.md](../specs/2026-09-13-explore-import-workflow-placement-design.md)

## Global Constraints

- Do **not** change Nest `POST /agent/internal/import-workflow` contract.
- Do **not** add `add_nodes_batch` / gen / destructive tools to explore.
- Do **not** bind canvas tools on the `chat` node this round.
- Keep explore narrow-bind ≤5 tools for `node_write`.
- Prefer TDD: failing test → minimal code → pass → commit per task.
- Work on branch `feature/explore-import-workflow-placement`.

## File map

| File | Responsibility |
|------|----------------|
| `services/agent-runtime/app/tools/tool_registry.py` | `ToolPlacement`, `TOOL_PLACEMENTS`, derive `EXPLORE_TOOL_NAMES`, deferred/graph invocation sets |
| `services/agent-runtime/app/tools/definitions.py` | `EXPLORE_READ_TOOLS` / write sets if needed; tool stays in `_all_tool_specs` |
| `services/agent-runtime/app/graph/explore_route.py` | Route verbs/nouns for 导入 / 工作流 / workflow |
| `services/agent-runtime/app/graph/explore_dispatch.py` | Mutate verbs + narrow bind for import |
| `services/agent-runtime/tests/test_explore_tools.py` | Explore includes `import_workflow` |
| `services/agent-runtime/tests/test_explore_route.py` | Import utterances → explore signal |
| `services/agent-runtime/tests/test_explore_narrow_bind.py` | Import keywords bind `import_workflow` |
| `services/agent-runtime/tests/test_tool_placement_invariants.py` | **Create** — I1–I4 orphan / placement tests |
| `docs/superpowers/specs/2026-09-12-agent-import-workflow-design.md` | Cross-link: conversation path via explore |
| `docs/superpowers/specs/2026-09-13-explore-import-workflow-placement-design.md` | Already written |

---

### Task 1: Registry placement SSOT + move `import_workflow` to explore

**Files:**
- Modify: `services/agent-runtime/app/tools/tool_registry.py`
- Modify: `services/agent-runtime/tests/test_explore_tools.py`
- Create: `services/agent-runtime/tests/test_tool_placement_invariants.py` (I1–I2 first; I3–I4 completed in Task 1 with deferred set)

**Interfaces:**
- Produces: `class ToolPlacement(str, Enum)` with `EXPLORE`, `GRAPH_NODE`, `UI_COMMAND`
- Produces: `TOOL_PLACEMENTS: dict[str, ToolPlacement]`
- Produces: `EXPLORE_TOOL_NAMES` derived as `{n for n,p in TOOL_PLACEMENTS.items() if p == ToolPlacement.EXPLORE}` **or** kept as frozenset but must stay in sync via test I2
- Produces: `GRAPH_NODE_CALL_SITES: frozenset[str]` — names expected to appear under `app/graph/`
- Produces: `DEFERRED_GRAPH_NODE_TOOLS: frozenset[str]` — graph_node tools not yet invoked from nodes (documented debt; import_workflow must **not** be here after this task)
- Consumes: existing `TOOL_TIERS`, `_all_tool_specs` names from definitions

- [ ] **Step 1: Write failing explore + placement tests**

Update `test_explore_tools.py`:

```python
def test_explore_tools_exclude_generation():
    tools = build_explore_tools(_FakeClient())  # type: ignore[arg-type]
    names = {t.name for t in tools}
    # ... keep existing asserts ...
    assert "import_workflow" in names  # CHANGED from "not in"
    assert "add_nodes_batch" not in names
    assert "run_image_generation" not in names
    assert names <= EXPLORE_TOOL_NAMES


def test_graph_only_includes_generation():
    tools = build_graph_only_tools(_FakeClient())  # type: ignore[arg-type]
    names = {t.name for t in tools}
    assert "run_image_generation" in names
    assert "add_nodes_batch" in names
    assert "import_workflow" not in names  # CHANGED — now explore
    assert names <= GRAPH_ONLY_TOOL_NAMES
```

Create `tests/test_tool_placement_invariants.py`:

```python
from pathlib import Path

from app.tools.definitions import build_canvas_tools
from app.tools.tool_registry import (
    DEFERRED_GRAPH_NODE_TOOLS,
    EXPLORE_TOOL_NAMES,
    GRAPH_NODE_CALL_SITES,
    TOOL_PLACEMENTS,
    ToolPlacement,
)


class _Fake:
    pass


def test_i1_every_spec_has_placement():
    names = {t.name for t in build_canvas_tools(_Fake())}  # type: ignore[arg-type]
    missing = names - set(TOOL_PLACEMENTS)
    extra = set(TOOL_PLACEMENTS) - names
    # ui_command-only names may exist only in EXPLORE_TOOL_NAMES; allow TOOL_PLACEMENTS ⊇ specs
    assert not missing, f"specs missing placement: {sorted(missing)}"
    # placements without specs are ok only for documentation — prefer none
    assert not (extra - names), f"placements without specs: {sorted(extra - names)}"


def test_i2_explore_placement_matches_whitelist():
    from_placement = {
        n for n, p in TOOL_PLACEMENTS.items() if p == ToolPlacement.EXPLORE
    }
    assert from_placement == set(EXPLORE_TOOL_NAMES)


def test_i3_graph_node_has_call_site_or_deferred():
    graph_root = Path(__file__).resolve().parents[1] / "app" / "graph"
    corpus = "\n".join(p.read_text(encoding="utf-8") for p in graph_root.rglob("*.py"))
    graph_nodes = {
        n for n, p in TOOL_PLACEMENTS.items() if p == ToolPlacement.GRAPH_NODE
    }
    for name in sorted(graph_nodes):
        if name in DEFERRED_GRAPH_NODE_TOOLS:
            continue
        assert name in GRAPH_NODE_CALL_SITES or name in corpus, (
            f"graph_node tool {name!r} has no app/graph reference; "
            f"add call site or GRAPH_NODE_CALL_SITES / DEFERRED_GRAPH_NODE_TOOLS"
        )
        if name in GRAPH_NODE_CALL_SITES:
            assert name in corpus, f"{name} listed in CALL_SITES but not found under app/graph"


def test_i4_no_orphan_explore_mismatch():
    """Orphan = StructuredTool with no viable placement path."""
    specs = {t.name for t in build_canvas_tools(_Fake())}  # type: ignore[arg-type]
    for name in specs:
        assert name in TOOL_PLACEMENTS
        p = TOOL_PLACEMENTS[name]
        if p == ToolPlacement.EXPLORE:
            assert name in EXPLORE_TOOL_NAMES
        elif p == ToolPlacement.GRAPH_NODE:
            assert name not in EXPLORE_TOOL_NAMES or name in DEFERRED_GRAPH_NODE_TOOLS
            # reachable: call site, deferred, or CALL_SITES verified in I3
        elif p == ToolPlacement.UI_COMMAND:
            assert name in EXPLORE_TOOL_NAMES  # current product: ui cmds exposed via explore
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_tools.py tests/test_tool_placement_invariants.py -v
```

Expected: FAIL — `import_workflow` still not in explore; `TOOL_PLACEMENTS` missing.

- [ ] **Step 3: Implement registry**

In `tool_registry.py`, add (keep existing `ToolTier`; change `import_workflow` tier to a workflow-io friendly tier — use new `ToolTier.WORKFLOW_IO = "workflow_io"` **or** keep `EXPORT`-adjacent; preferred: add `WORKFLOW_IO`):

```python
class ToolPlacement(str, Enum):
    EXPLORE = "explore"
    GRAPH_NODE = "graph_node"
    UI_COMMAND = "ui_command"


class ToolTier(str, Enum):
    # ... existing ...
    WORKFLOW_IO = "workflow_io"  # export/import style canvas IO


# Build TOOL_PLACEMENTS covering every name in build_canvas_tools + explore ui cmds.
# import_workflow -> ToolPlacement.EXPLORE
# export_media_package -> EXPLORE
# add_nodes_batch, connect_nodes, gen/destructive/layout batch -> GRAPH_NODE
# focus_node, focus_nodes, undo, redo, open_image_editor -> UI_COMMAND (and remain in EXPLORE_TOOL_NAMES)

# EXPLORE_TOOL_NAMES: include all EXPLORE + UI_COMMAND placements (ui cmds are explore-bound today)
EXPLORE_TOOL_NAMES = frozenset(
    n for n, p in TOOL_PLACEMENTS.items()
    if p in (ToolPlacement.EXPLORE, ToolPlacement.UI_COMMAND)
)

TOOL_TIERS["import_workflow"] = ToolTier.WORKFLOW_IO
TOOL_TIERS["export_media_package"] = ToolTier.EXPORT  # unchanged or also WORKFLOW_IO — keep EXPORT

GRAPH_ONLY_TOOL_NAMES = frozenset(
    n for n, p in TOOL_PLACEMENTS.items() if p == ToolPlacement.GRAPH_NODE
)

# Seeds for I3 — adjust to match real app/graph corpus after a quick rg:
GRAPH_NODE_CALL_SITES = frozenset({
    "add_nodes_batch",
    "run_image_generation",
    "remove_nodes",
    # add others found by: rg "await nest\\.|getattr\\(nest" app/graph
})

# Tools that are graph_node specs but not yet called from nodes (pre-existing debt).
# Do NOT put import_workflow here.
DEFERRED_GRAPH_NODE_TOOLS = frozenset({
    # populate from TOOL_PLACEMENTS GRAPH_NODE minus those found in corpus on first green run
})
```

Practical approach for Step 3:

1. List all `build_canvas_tools` names.  
2. Assign placement.  
3. Run I3 once; any GRAPH_NODE missing from corpus → add to `DEFERRED_GRAPH_NODE_TOOLS` with a one-line comment in registry.  
4. Ensure `import_workflow` is EXPLORE, not deferred.

Also update `is_explore_tool` to use `EXPLORE_TOOL_NAMES` as derived.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_tools.py tests/test_tool_placement_invariants.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/tools/tool_registry.py \
  services/agent-runtime/tests/test_explore_tools.py \
  services/agent-runtime/tests/test_tool_placement_invariants.py
git commit -m "feat(agent-runtime): place import_workflow in explore + placement invariants"
```

---

### Task 2: Route import utterances into `explore_canvas`

**Files:**
- Modify: `services/agent-runtime/app/graph/explore_route.py`
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py` (mutate verb lists used by classify)
- Modify: `services/agent-runtime/tests/test_explore_route.py`
- Test: `services/agent-runtime/tests/test_route_decide_explore.py` if signals feed precedence (run full file if present)

**Interfaces:**
- Consumes: unchanged `explore_canvas_signal(utterance, *, blocked_by_atomic: bool) -> bool`
- Produces: same function returns True for import/workflow utterances

- [ ] **Step 1: Write failing route tests**

Append to `test_explore_route.py`:

```python
def test_import_workflow_phrase_routes_explore():
    u = "请调用 import_workflow 工具，把 lnkpi.workflow JSON 合并进当前画布"
    assert explore_canvas_signal(u, blocked_by_atomic=False) is True


def test_import_chinese_workflow_routes_explore():
    u = "把这份工作流导入到画布"
    assert explore_canvas_signal(u, blocked_by_atomic=False) is True


def test_export_still_routes_explore():
    u = "请调用 export_media_package 导出当前画布工作流"
    assert explore_canvas_signal(u, blocked_by_atomic=False) is True
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_route.py::test_import_workflow_phrase_routes_explore tests/test_explore_route.py::test_import_chinese_workflow_routes_explore -v
```

Expected: FAIL (signal False)

- [ ] **Step 3: Minimal routing changes**

In `explore_route.py`:

1. Add to `_EXPLORE_MUTATE_VERBS`: `"导入"`, and ensure workflow nouns work.  
2. Extend `explore_canvas_signal` nouns **or** add an early return:

```python
_WORKFLOW_IO_MARKERS = (
    "导入",
    "工作流",
    "workflow",
    "lnkpi.workflow",
    "import_workflow",
    "export_media_package",
)

def explore_canvas_signal(...):
    u = (utterance or "").strip()
    ...
    if any(m in u for m in _WORKFLOW_IO_MARKERS) and any(
        x in u for x in ("画布", "canvas", "节点", "工作流", "workflow", "lnkpi.workflow", "导出", "导入", "import_workflow", "export_media_package")
    ):
        return True
    # existing logic...
```

Keep it tight: prefer markers that imply workflow IO without stealing pure「生成一张图」.

Mirror `"导入"` into `explore_dispatch.py` `_MUTATE_VERBS` / `_WRITE_VERBS` if classify uses them for intent (optional for routing; required for bind in Task 3).

- [ ] **Step 4: Run route tests — expect PASS**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_route.py tests/test_route_decide_explore.py -v
```

Expected: PASS (fix any collateral failures without widening atomic create)

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/explore_route.py \
  services/agent-runtime/app/graph/explore_dispatch.py \
  services/agent-runtime/tests/test_explore_route.py
git commit -m "feat(agent-runtime): route workflow import utterances to explore"
```

---

### Task 3: Narrow-bind `import_workflow` on import intents

**Files:**
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py`
- Modify: `services/agent-runtime/app/tools/definitions.py` — optionally add `import_workflow` to a write-related frozenset used only for documentation; **not** required in `EXPLORE_READ_TOOLS`
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`

**Interfaces:**
- Consumes: `select_narrow_write_tools(user_text: str) -> frozenset[str]`
- Consumes: `select_explore_tool_names(intent, user_text) -> frozenset[str]`
- Produces: import keywords → frozenset including `import_workflow` (≤5)

- [ ] **Step 1: Write failing bind tests**

```python
def test_import_keywords_narrow_bind_import_workflow():
    names = select_narrow_write_tools(
        "请调用 import_workflow 把 lnkpi.workflow 导入画布"
    )
    assert "import_workflow" in names
    assert len(names) <= 5


def test_import_chinese_narrow_bind():
    names = select_narrow_write_tools("把工作流导入当前画布")
    assert "import_workflow" in names
    assert len(names) <= 5


def test_open_query_still_includes_import_after_whitelist():
    names = select_explore_tool_names("open_query", "查询画布上有哪些节点")
    assert "import_workflow" in names  # full whitelist includes it after Task 1
    assert names == EXPLORE_TOOL_NAMES
```

For `node_write` path: `select_explore_tool_names("node_write", text)` must use narrow bind — add:

```python
def test_node_write_import_utterance_binds_import_tool():
    names = select_explore_tool_names(
        "node_write",
        "请用 import_workflow 导入工作流到画布",
    )
    assert "import_workflow" in names
```

Note: `classify_explore_intent` may return `open_query` without node ids — then full whitelist already has import (Task 1). Narrow bind still needed when intent is `node_write`.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_narrow_bind.py -v
```

- [ ] **Step 3: Implement narrow bind**

In `select_narrow_write_tools`:

```python
def select_narrow_write_tools(user_text: str) -> frozenset[str]:
    u = user_text or ""
    low = u.lower()
    if any(
        k in u or k in low
        for k in (
            "import_workflow",
            "lnkpi.workflow",
            "导入工作流",
            "导入",
        )
    ) and any(
        k in u or k in low
        for k in ("工作流", "workflow", "lnkpi.workflow", "import_workflow", "画布")
    ):
        return frozenset({"import_workflow", "get_canvas_summary"})
    # existing branches...
```

Tune so bare「导入」alone without workflow/canvas does not steal unrelated uploads.

Optionally extend `classify_explore_intent`: if workflow import markers present → `node_write` (so narrow bind applies). Example early in classify:

```python
if any(k in u for k in ("import_workflow", "lnkpi.workflow", "导入工作流")) or (
    "导入" in u and any(k in u for k in ("工作流", "workflow"))
):
    return "node_write"
```

- [ ] **Step 4: Run narrow bind + explore dispatch tests — PASS**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_narrow_bind.py tests/test_explore_dispatch.py tests/test_explore_tools_subset.py -v
```

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/explore_dispatch.py \
  services/agent-runtime/app/tools/definitions.py \
  services/agent-runtime/tests/test_explore_narrow_bind.py
git commit -m "feat(agent-runtime): narrow-bind import_workflow for import intents"
```

---

### Task 4: Docs cross-link + full test gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-agent-import-workflow-design.md` — short note under runtime section: conversation path is explore-bound per 2026-09-13 placement spec
- Modify: `docs/superpowers/plans/2026-09-13-explore-import-workflow-placement.md` — checkboxes (this file) as you complete; or leave for closer
- Optional: Status footer on `2026-09-13-explore-import-workflow-placement-design.md`

- [ ] **Step 1: Add cross-link paragraph**

In agent-import design §4.2 (Agent runtime), append:

```markdown
**对话路径（2026-09-13）：** `import_workflow` 已列入 explore 白名单与路由/窄绑定；见 [2026-09-13-explore-import-workflow-placement-design.md](./2026-09-13-explore-import-workflow-placement-design.md)。
```

- [ ] **Step 2: Run full relevant pytest suite**

```bash
cd services/agent-runtime
python -m pytest tests/test_explore_tools.py tests/test_tool_placement_invariants.py \
  tests/test_explore_route.py tests/test_explore_narrow_bind.py \
  tests/test_explore_dispatch.py tests/test_explore_tools_subset.py \
  tests/test_nest_client.py tests/test_route_decide_explore.py -v
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-12-agent-import-workflow-design.md \
  docs/superpowers/specs/2026-09-13-explore-import-workflow-placement-design.md
git commit -m "docs: cross-link explore import_workflow conversation path"
```

- [ ] **Step 4: Production smoke (manual / script)**

With user `defaultTextModel` (not env Agnes default):

1. Chat: import minimal `lnkpi.workflow` JSON via `import_workflow` → expect `canvas_action` / `focus_nodes`.  
2. Chat: `export_media_package` with `node_ids=[]` → expect `export_pack` + `full_package`.

Record results in PR body.

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Route 导入/工作流/workflow into explore | T2 |
| `import_workflow` in `EXPLORE_TOOL_NAMES` | T1 |
| Narrow bind on import utterances | T3 |
| Keep `add_nodes_batch`/gen out of explore | T1 tests |
| Placement + I1–I4 | T1 |
| Nest contract unchanged | Global / no Nest files |
| Docs cross-link | T4 |
| Prod dialogue verify | T4 Step 4 |

## Placeholder scan

None intentional. `DEFERRED_GRAPH_NODE_TOOLS` members are filled during Task 1 Step 3 from first I3 failure list (concrete names, not TBD).

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-13-explore-import-workflow-placement.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
