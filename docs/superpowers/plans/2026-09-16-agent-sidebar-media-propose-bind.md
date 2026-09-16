# Sidebar-media propose bind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the gold try-on utterance with sidebar chips `@I1/@I2`, explore binds `upsert_media_node` + `apply_sidebar_attachments` + `propose_generation` (no `attach_refs`), without expanding `MEDIA_CREATE_HINTS`.

**Architecture:** After planner/import exclusive sets, add a sidebar media narrow-write set gated by `resolve_sidebar_image_ref_keys` + `utterance_binds_sidebar_media_propose`. Implicit hang only when this-turn uncached image URLs equal the current image chips (SM-D7). Parse node records those URLs before the cache fills. `apply_sidebar_attachments` may omit `attachments` and fill from `nest.sidebar_attachments`. Parse context block does not interrogate commerce fields unless listing phrases.

**Tech Stack:** Python agent-runtime; pytest; existing Nest `apply-sidebar-attachments`.

**Spec:** [docs/superpowers/specs/2026-09-16-agent-sidebar-media-propose-bind-design.md](../specs/2026-09-16-agent-sidebar-media-propose-bind-design.md)

## Global Constraints

- Gold utterance (verbatim): `@I1 模特 @I2 产品，让模特穿上，保持构图不变`
- Sidebar media set (exactly these 4): `upsert_media_node`, `apply_sidebar_attachments`, `set_node_prompt`, `propose_generation`
- Bare-gen set unchanged: `upsert_media_node`, `propose_generation`, `set_node_prompt`, `attach_refs`
- Do **not** add 穿上/换装 to `MEDIA_CREATE_HINTS` or use `TRANSFORM_VERBS` as a bind predicate
- Planner/import branches in `select_narrow_write_tools` unchanged (still first)
- Do **not** modify `deploy/prod-phase-2d3-h8-verify.py` or `deploy/prod-phase-v2-bare-gen-verify.py`
- No `run_*` in `build_tool_plan().visible_names`; no mandatory explore dispatch for gen
- No 2d.4 shim delete; no Phase 3; no same-session regen propose; no real billed generation
- Implicit hang: `set(image_keys) == set(this_turn_new_image_keys)` and length 1 or 2; leftover/↺ chips require `@`
- Branch: `feature/agent-sidebar-media-propose-bind` from latest `origin/main`

---

## File map

| File | Responsibility |
|------|----------------|
| Spec + this plan | Authorize S1–S10; H8/V2 scripts untouched |
| `app/graph/explore_dispatch.py` | `resolve_sidebar_image_ref_keys`, `utterance_binds_sidebar_media_propose`, sidebar branch, key helpers |
| `app/graph/nodes/parse_sidebar_media.py` | Stamp `this_turn_uncached_image_urls` on parse dict |
| `app/graph/nodes/explore.py` | Pass sidebar kwargs into `_bind_plan_tools`; prompt; `ask_unknown` |
| `app/graph/sidebar_media_parse.py` | `format_parse_context_block(..., ask_unknown=)` |
| `app/tools/definitions.py` | Optional `attachments`; default `mode=localRefs`; fill from nest |
| `app/tools/nest_client.py` | Same fill-if-omitted |
| `app/runs.py` | `NestEventProxy.apply_sidebar_attachments` attachments optional |
| `tests/test_explore_narrow_bind.py` | S1–S7 + S3b |
| `tests/test_explore_tools.py` | S8 omit attachments |
| `tests/test_sidebar_media_parse.py` | S9 parse block |
| `tests/test_sidebar_media_parse_ac.py` | this-turn URLs; AC-02 still asks; AC-01 does not |
| `tests/test_chat_system_prompt.py` / `test_phase_2b_propose_tools.py` | Prompt identity sentences |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-agent-sidebar-media-propose-bind-design.md` (header status + plan link; may already match)
- Create: this plan file

**Interfaces:**
- Consumes: spec SM-D1–SM-D7
- Produces: spec header links here

- [ ] **Step 1:** Confirm spec header `状态` is **已批准** and `实现 plan` links to this file.

- [ ] **Step 2: Commit** (docs only; skip if already in the same commit)

```bash
git add docs/superpowers/specs/2026-09-16-agent-sidebar-media-propose-bind-design.md \
  docs/superpowers/plans/2026-09-16-agent-sidebar-media-propose-bind.md
git commit -m "$(cat <<'EOF'
docs(agent): plan sidebar-media propose bind for explore

EOF
)"
```

---

### Task 1: Failing tests S1–S7 / S3b

**Files:**
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`

**Interfaces:**
- Consumes: `select_narrow_write_tools`, `_bind_plan_tools` (existing 4-arg form must stay valid)
- Produces: RED gates; constants `GOLD_TRYON` and `SIDEBAR_MEDIA_WRITE` later tasks reuse verbatim

- [ ] **Step 1: Append RED tests** (keep all existing planner/import/P1–P5 tests)

After `MEDIA_WRITE`, add:

```python
GOLD_TRYON = "@I1 模特 @I2 产品，让模特穿上，保持构图不变"
SIDEBAR_MEDIA_WRITE = frozenset({
    "upsert_media_node",
    "apply_sidebar_attachments",
    "set_node_prompt",
    "propose_generation",
})
```

Append:

```python
def test_s1_tryon_gold_with_chips_binds_sidebar_set():
    tools = select_narrow_write_tools(
        GOLD_TRYON,
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
    )
    assert tools == SIDEBAR_MEDIA_WRITE
    assert "attach_refs" not in tools
    assert "connect_nodes" not in tools
    assert len(tools) <= 5


def test_s2_tryon_gold_without_chips_does_not_bind_via_chuanshang():
    tools = select_narrow_write_tools(GOLD_TRYON)
    assert tools != SIDEBAR_MEDIA_WRITE
    assert tools != MEDIA_WRITE
    assert "propose_generation" not in tools


def test_s3_implicit_two_new_images_binds_sidebar_set():
    tools = select_narrow_write_tools(
        "让模特穿上这件衣服",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=("I1", "I2"),
    )
    assert tools == SIDEBAR_MEDIA_WRITE


def test_s3b_reused_images_without_at_do_not_bind():
    tools = select_narrow_write_tools(
        "让模特穿上这件衣服",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
    )
    assert "propose_generation" not in tools
    assert tools != SIDEBAR_MEDIA_WRITE


def test_s3b_thanks_with_old_chips_does_not_bind():
    tools = select_narrow_write_tools(
        "谢谢",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
    )
    assert "propose_generation" not in tools


def test_s4_three_new_images_without_at_do_not_bind():
    tools = select_narrow_write_tools(
        "让模特穿上这件衣服",
        sidebar_image_keys=("I1", "I2", "I3"),
        this_turn_new_image_keys=("I1", "I2", "I3"),
    )
    assert "propose_generation" not in tools


def test_s5_what_is_i1_does_not_bind_propose():
    for text in ("@I1 是什么衣服", "I1是什么衣服"):
        tools = select_narrow_write_tools(
            text,
            sidebar_image_keys=("I1", "I2"),
            mentioned_keys=("I1",),
        )
        assert "propose_generation" not in tools
        assert "upsert_media_node" not in tools


def test_s6_planner_plus_chips_stays_planner():
    tools = select_narrow_write_tools(
        "帮我规划一个电商套图工作流，接到角色三视图",
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
        this_turn_new_image_keys=("I1", "I2"),
    )
    assert tools == _PLANNER_TOOLS
    assert "propose_generation" not in tools


def test_s1_bare_gen_plus_chips_uses_sidebar_set_not_attach_refs():
    tools = select_narrow_write_tools(
        GOLD_BARE_GEN,
        sidebar_image_keys=("I1",),
        mentioned_keys=("I1",),
    )
    assert tools == SIDEBAR_MEDIA_WRITE
    assert "attach_refs" not in tools


def test_s7_bare_gen_without_chips_still_media_write():
    assert select_narrow_write_tools(GOLD_BARE_GEN) == MEDIA_WRITE


def test_resolve_sidebar_image_ref_keys_mention_wins_over_empty_new():
    from app.graph.explore_dispatch import resolve_sidebar_image_ref_keys

    assert resolve_sidebar_image_ref_keys(
        image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
        mentioned_keys=("I2", "I1"),
    ) == ["I2", "I1"]


def test_utterance_binds_sidebar_media_propose_gate():
    from app.graph.explore_dispatch import utterance_binds_sidebar_media_propose

    assert utterance_binds_sidebar_media_propose(GOLD_TRYON, ["I1", "I2"]) is True
    assert utterance_binds_sidebar_media_propose("@I1 是什么衣服", ["I1"]) is False
    assert utterance_binds_sidebar_media_propose("看看这张图", ["I1"]) is False
    assert utterance_binds_sidebar_media_propose(GOLD_TRYON + "，做个营销方案", ["I1", "I2"]) is False
    assert utterance_binds_sidebar_media_propose(GOLD_TRYON, None) is False
```

- [ ] **Step 2:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_narrow_bind.py -v
```

Expected: new tests FAIL (`TypeError` unexpected kwargs and/or missing `resolve_sidebar_image_ref_keys`). Existing P1–P5 / planner / import PASS.

- [ ] **Step 3: Commit**

```bash
git add services/agent-runtime/tests/test_explore_narrow_bind.py
git commit -m "$(cat <<'EOF'
test(agent): add sidebar-media narrow-bind failing gates

EOF
)"
```

---

### Task 2: Predicates + sidebar branch (GREEN bind tests)

**Files:**
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py`

**Interfaces:**
- Produces: `resolve_sidebar_image_ref_keys(image_keys, this_turn_new_image_keys, mentioned_keys) -> list[str] | None`
- Produces: `utterance_binds_sidebar_media_propose(text: str, ref_keys: list[str] | None) -> bool`
- Produces: `select_narrow_write_tools(utterance, *, sidebar_image_keys=(), this_turn_new_image_keys=(), mentioned_keys=()) -> frozenset[str]`
- Consumes: existing `utterance_binds_media_propose`; `CAMPAIGN_OVERRIDE_PHRASES`; `regen_intent`; `regenerate_phrase_intent`; `suspected_vision_qa`; `media_directed_question`; `suspected_media_create`

- [ ] **Step 1:** Near `_MEDIA_PROPOSE_WRITE` add:

```python
_SIDEBAR_MEDIA_WRITE = frozenset({
    "upsert_media_node",
    "apply_sidebar_attachments",
    "set_node_prompt",
    "propose_generation",
})
```

- [ ] **Step 2:** Add helpers (same file; do not touch `atomic_intent.py`; do not import `TRANSFORM_VERBS`):

```python
def resolve_sidebar_image_ref_keys(
    *,
    image_keys: Sequence[str] = (),
    this_turn_new_image_keys: Sequence[str] = (),
    mentioned_keys: Sequence[str] = (),
) -> list[str] | None:
    images = [str(k).strip().upper() for k in image_keys if str(k).strip()]
    image_set = set(images)
    if not images:
        return None
    mentioned_i = [
        str(k).strip().upper()
        for k in mentioned_keys
        if str(k).strip().upper().startswith("I") and str(k).strip().upper() in image_set
    ]
    # de-dupe mention order
    seen: set[str] = set()
    mentioned_i = [k for k in mentioned_i if not (k in seen or seen.add(k))]
    if mentioned_i:
        return mentioned_i
    new_keys = {str(k).strip().upper() for k in this_turn_new_image_keys if str(k).strip()}
    if new_keys == image_set and len(images) in (1, 2):
        return list(images)
    return None


def utterance_binds_sidebar_media_propose(
    text: str, ref_keys: list[str] | None
) -> bool:
    from app.graph.atomic_intent import (
        CAMPAIGN_OVERRIDE_PHRASES,
        regen_intent,
        regenerate_phrase_intent,
    )
    from app.graph.media_utterance import (
        media_directed_question,
        suspected_media_create,
        suspected_vision_qa,
    )

    if not ref_keys:
        return False
    t = text or ""
    if regen_intent(t) or regenerate_phrase_intent(t):
        return False
    if any(p in t for p in CAMPAIGN_OVERRIDE_PHRASES):
        return False
    if suspected_vision_qa(t) or media_directed_question(t):
        return False
    if not suspected_media_create(t) and ("是什么" in t or "是啥" in t):
        return False
    return True
```

Add `from collections.abc import Sequence` to the module imports.

- [ ] **Step 3:** Change `select_narrow_write_tools` signature and insert the sidebar branch **after** import/planner, **before** `utterance_binds_media_propose`:

```python
def select_narrow_write_tools(
    utterance: str,
    *,
    sidebar_image_keys: Sequence[str] = (),
    this_turn_new_image_keys: Sequence[str] = (),
    mentioned_keys: Sequence[str] = (),
) -> frozenset[str]:
    text = utterance or ""
    low = text.lower()
    if "import_workflow" in low or "导入工作流" in text:
        return _IMPORT_WRITE_TOOLS
    if _PLANNER_CONFIRM in text:
        return _PLANNER_INSTANTIATE_TOOLS
    if _is_planner_utterance(text):
        return _PLANNER_WRITE_TOOLS
    if _is_workflow_import_utterance(text):
        return _IMPORT_WRITE_TOOLS
    ref_keys = resolve_sidebar_image_ref_keys(
        image_keys=sidebar_image_keys,
        this_turn_new_image_keys=this_turn_new_image_keys,
        mentioned_keys=mentioned_keys,
    )
    if utterance_binds_sidebar_media_propose(text, ref_keys):
        return _SIDEBAR_MEDIA_WRITE
    if utterance_binds_media_propose(text):
        return _MEDIA_PROPOSE_WRITE
    return _DEFAULT_NARROW_WRITE
```

Do **not** edit the planner/import `if` bodies.

- [ ] **Step 4:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_narrow_bind.py -v
```

Expected: all PASS except `_bind_plan_tools` try-on test if you added it in Task 1 (that test is Task 3). If Task 1 did not include `_bind_plan_tools` try-on, entire file PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/explore_dispatch.py
git commit -m "$(cat <<'EOF'
feat(agent): bind sidebar media writes from chip identity not verbs

EOF
)"
```

---

### Task 3: Parse this-turn URLs + explore / `_bind_plan_tools` wiring

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/parse_sidebar_media.py`
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py` (helpers `sidebar_image_keys_from_attachments`, `this_turn_new_image_keys_from_parse`, `mentioned_keys_for_sidebar_bind`)
- Modify: `services/agent-runtime/app/graph/nodes/explore.py` (`_bind_plan_tools` kwargs + call site)
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py` (P5-style bind_plan_tools try-on)
- Modify: `services/agent-runtime/tests/test_sidebar_media_parse_ac.py` (AC-03 stamps empty this-turn list)

**Interfaces:**
- Consumes: Task 2 `select_narrow_write_tools` kwargs
- Produces: `sidebar_media_parse["this_turn_uncached_image_urls"]` is `list(need)` on a fetch turn and `[]` on full cache hit
- Produces: `_bind_plan_tools(llm, tools, loaded, utterance, *, sidebar_image_keys=(), this_turn_new_image_keys=(), mentioned_keys=())`

- [ ] **Step 1: RED tests**

Append to `test_explore_narrow_bind.py`:

```python
def test_s1_bind_plan_tools_tryon_includes_sidebar_writes():
    from unittest.mock import MagicMock
    from app.graph.nodes.explore import _bind_plan_tools
    from app.tools.definitions import EXPLORE_WRITE_TOOLS

    captured: list[list[str]] = []

    class FakeLlm:
        def bind_tools(self, tools):
            captured.append([getattr(t, "name", "") for t in tools])
            return self

    tools_by_name = {name: MagicMock(name=name) for name in EXPLORE_WRITE_TOOLS}
    for name, tool in tools_by_name.items():
        tool.name = name
    _bind_plan_tools(
        FakeLlm(),
        tools_by_name,
        [],
        GOLD_TRYON,
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
    )
    bound = set(captured[0])
    assert "upsert_media_node" in bound
    assert "apply_sidebar_attachments" in bound
    assert "propose_generation" in bound
    assert "attach_refs" not in bound
```

In `test_ac03_same_url_second_vision_qa_count_is_zero`, after the existing asserts add:

```python
    assert first["sidebar_media_parse"].get("this_turn_uncached_image_urls") == [URL_A]
    assert second["sidebar_media_parse"].get("this_turn_uncached_image_urls") == []
```

- [ ] **Step 2:** Run those tests — expect FAIL (`this_turn_uncached_image_urls` missing; `_bind_plan_tools` unexpected kwargs).

- [ ] **Step 3: Parse stamp**

In `parse_sidebar_media`, every dict that sets `sidebar_media_parse` must include `this_turn_uncached_image_urls`:

- `if not urls`: unchanged (`None` parse)
- `if not need:` copy `_parse_from_cache(...)` then `parse["this_turn_uncached_image_urls"] = []`
- fetch / gate-error paths: after `_parse_from_cache`, `parse_out["this_turn_uncached_image_urls"] = list(need)`

Do **not** reuse cached records' `image_urls` as this-turn new (those are from the first fetch).

- [ ] **Step 4: Helpers** in `explore_dispatch.py`:

```python
def sidebar_image_keys_from_attachments(attachments: list | None) -> tuple[str, ...]:
    from app.graph.sidebar_attachments import REF_PREFIX

    counters = {k: 0 for k in REF_PREFIX}
    keys: list[str] = []
    for item in attachments or []:
        if not isinstance(item, dict):
            continue
        media_type = str(item.get("mediaType") or item.get("media_type") or "").strip()
        prefix = REF_PREFIX.get(media_type)
        if not prefix:
            continue
        counters[media_type] += 1
        key = f"{prefix}{counters[media_type]}"
        url = str(item.get("url") or "").strip()
        if prefix == "I" and url:
            keys.append(key)
    return tuple(keys)


def this_turn_new_image_keys_from_parse(
    attachments: list | None, parse: dict | None
) -> tuple[str, ...]:
    raw = (parse or {}).get("this_turn_uncached_image_urls") if isinstance(parse, dict) else None
    urls = {str(u).strip() for u in (raw or []) if str(u).strip()}
    if not urls:
        return ()
    from app.graph.sidebar_attachments import REF_PREFIX

    counters = {k: 0 for k in REF_PREFIX}
    keys: list[str] = []
    for item in attachments or []:
        if not isinstance(item, dict):
            continue
        media_type = str(item.get("mediaType") or item.get("media_type") or "").strip()
        prefix = REF_PREFIX.get(media_type)
        if not prefix:
            continue
        counters[media_type] += 1
        key = f"{prefix}{counters[media_type]}"
        url = str(item.get("url") or "").strip()
        if prefix == "I" and url in urls:
            keys.append(key)
    return tuple(keys)


def mentioned_keys_for_sidebar_bind(
    user_text: str, request_keys: list | None
) -> tuple[str, ...]:
    from app.graph.sidebar_attachments import (
        normalize_mentioned_keys,
        parse_mentioned_keys_from_text,
    )

    from_text = parse_mentioned_keys_from_text(user_text)
    if from_text:
        return tuple(from_text)
    return tuple(normalize_mentioned_keys(request_keys))
```

Do **not** call `resolve_sidebar_mentioned_keys` (state-first).

- [ ] **Step 5: `_bind_plan_tools` + explore call site**

```python
def _bind_plan_tools(
    llm: Any,
    tools_by_name: dict[str, Any],
    loaded: list[str],
    utterance: str,
    *,
    sidebar_image_keys: tuple[str, ...] = (),
    this_turn_new_image_keys: tuple[str, ...] = (),
    mentioned_keys: tuple[str, ...] = (),
) -> tuple[Any, frozenset[str]]:
    plan = build_tool_plan(loaded=loaded)
    narrow_writes = select_narrow_write_tools(
        utterance,
        sidebar_image_keys=sidebar_image_keys,
        this_turn_new_image_keys=this_turn_new_image_keys,
        mentioned_keys=mentioned_keys,
    )
    # existing visible loop unchanged
```

At the existing call after `nest.sidebar_attachments = list(attachments)`:

```python
from app.graph.explore_dispatch import (
    mentioned_keys_for_sidebar_bind,
    select_narrow_write_tools,
    sidebar_image_keys_from_attachments,
    this_turn_new_image_keys_from_parse,
)

image_keys = sidebar_image_keys_from_attachments(attachments)
new_keys = this_turn_new_image_keys_from_parse(attachments, parse)
mention_keys = mentioned_keys_for_sidebar_bind(
    user_text, state.get("sidebar_mentioned_keys")
)
llm_bound, visible = _bind_plan_tools(
    llm,
    tools_by_name,
    loaded,
    user_text,
    sidebar_image_keys=image_keys,
    this_turn_new_image_keys=new_keys,
    mentioned_keys=mention_keys,
)
```

Existing `_bind_plan_tools(..., GOLD_BARE_GEN)` tests must still pass (kwargs default empty).

- [ ] **Step 6:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest \
  tests/test_explore_narrow_bind.py tests/test_sidebar_media_parse_ac.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/agent-runtime/app/graph/explore_dispatch.py \
  services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/app/graph/nodes/parse_sidebar_media.py \
  services/agent-runtime/tests/test_explore_narrow_bind.py \
  services/agent-runtime/tests/test_sidebar_media_parse_ac.py
git commit -m "$(cat <<'EOF'
feat(agent): wire this-turn sidebar chips into explore bind

EOF
)"
```

---

### Task 4: `apply_sidebar_attachments` omit payload (S8)

**Files:**
- Modify: `services/agent-runtime/app/tools/definitions.py` (`ApplySidebarAttachmentsInput` + wrapper)
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: `services/agent-runtime/app/runs.py` (`NestEventProxy.apply_sidebar_attachments`)
- Modify: `services/agent-runtime/tests/test_explore_tools.py`
- Modify: `services/agent-runtime/tests/test_nest_event_proxy.py` (existing call still passes attachments)

**Interfaces:**
- Consumes: `client.sidebar_attachments` already set by explore
- Produces: omitted `attachments` → nest list; empty list → `{"ok": False, "error": ...}` dict, no raise

- [ ] **Step 1: RED test** in `test_explore_tools.py`:

```python
import pytest


class _FakeSidebarClient:
    def __init__(self) -> None:
        self.sidebar_attachments = [
            {"mediaType": "image", "url": "https://cdn.example/a.jpg"}
        ]
        self.calls: list[dict] = []

    async def apply_sidebar_attachments(self, **kwargs):
        self.calls.append(kwargs)
        return {"ok": True, "nodeIds": kwargs.get("node_ids")}


@pytest.mark.asyncio
async def test_s8_apply_sidebar_omits_attachments_uses_nest():
    nest = _FakeSidebarClient()
    tools = build_explore_tools(nest)  # type: ignore[arg-type]
    by_name = {t.name: t for t in tools}
    raw = await by_name["apply_sidebar_attachments"].ainvoke(
        {"node_ids": ["image-1"], "mode": "localRefs", "mentioned_keys": ["I1"]}
    )
    assert nest.calls
    sent = nest.calls[0]
    assert sent["attachments"] == nest.sidebar_attachments
    assert sent["node_ids"] == ["image-1"]
    assert sent.get("mode") == "localRefs"


@pytest.mark.asyncio
async def test_s8_apply_sidebar_empty_returns_error_dict():
    nest = _FakeSidebarClient()
    nest.sidebar_attachments = []
    tools = build_explore_tools(nest)  # type: ignore[arg-type]
    by_name = {t.name: t for t in tools}
    raw = await by_name["apply_sidebar_attachments"].ainvoke(
        {"node_ids": ["image-1"]}
    )
    payload = raw if isinstance(raw, dict) else {}
    if not payload and isinstance(raw, str):
        import json
        payload = json.loads(raw)
    assert payload.get("ok") is False
    assert "侧栏" in str(payload.get("error") or "")
    assert nest.calls == []
```

- [ ] **Step 2:** Run `pytest tests/test_explore_tools.py -v` — new tests FAIL (attachments required).

- [ ] **Step 3: Schema + fill**

`ApplySidebarAttachmentsInput`:

```python
class ApplySidebarAttachmentsInput(BaseModel):
    node_ids: list[str] = Field(description="Target canvas node ids")
    attachments: list[dict[str, Any]] | None = Field(
        default=None,
        description="Sidebar attachment payloads; omit to use this-turn nest sidebar_attachments",
    )
    ref_order: list[str] | None = Field(default=None, description="Attachment id order")
    mode: str = Field(default="localRefs", description="localRefs or attach_edges")
    mentioned_keys: list[str] | None = Field(
        default=None,
        description="Sidebar chip keys such as I1/I2, never canvas image-* ids",
    )
```

Wrapper (keep JSON-string coercion for `ref_order` / `mentioned_keys`):

```python
    async def apply_sidebar_attachments(
        node_ids: list[str],
        attachments: list[dict[str, Any]] | None = None,
        mode: str = "localRefs",
        ref_order: list[str] | None = None,
        mentioned_keys: list[str] | None = None,
    ) -> dict:
        # existing str-to-list coercion for ref_order / mentioned_keys
        atts = attachments if attachments else list(getattr(client, "sidebar_attachments", None) or [])
        if not atts:
            return {"ok": False, "error": "没有侧栏附件"}
        return await client.apply_sidebar_attachments(
            node_ids=node_ids,
            attachments=atts,
            ref_order=ref_order,
            mode=mode or "localRefs",
            mentioned_keys=mentioned_keys,
        )
```

Tool description (replace the one-liner):

```
Write sidebar chip attachments onto canvas nodes as localRefs (default).
mentioned_keys are I1/I2 chip keys, not canvas image-* ids.
attachments may be omitted; the server uses this-turn sidebar attachments.
```

`NestCanvasClient.apply_sidebar_attachments`: `attachments: list[dict] | None = None`; if omitted, `atts = list(self.sidebar_attachments or [])`; if empty return `{"ok": False, "error": "没有侧栏附件"}` (do not POST). POST body still sends the filled list.

`NestEventProxy.apply_sidebar_attachments` in `runs.py`: same optional `attachments`; forward filled list. Existing campaign callers that pass `attachments=` stay valid.

- [ ] **Step 4:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest \
  tests/test_explore_tools.py tests/test_nest_event_proxy.py tests/test_campaign_sidebar_refs.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/tools/definitions.py \
  services/agent-runtime/app/tools/nest_client.py \
  services/agent-runtime/app/runs.py \
  services/agent-runtime/tests/test_explore_tools.py
git commit -m "$(cat <<'EOF'
feat(agent): fill apply_sidebar_attachments from nest when omitted

EOF
)"
```

---

### Task 5: Parse block + system prompt (S9 / §2.6)

**Files:**
- Modify: `services/agent-runtime/app/graph/sidebar_media_parse.py`
- Modify: `services/agent-runtime/app/graph/nodes/explore.py` (`_EXPLORE_SYSTEM` + `format_parse_context_block` call)
- Modify: `services/agent-runtime/tests/test_sidebar_media_parse.py`
- Modify: `services/agent-runtime/tests/test_sidebar_media_parse_ac.py` (AC-01 must not contain 待确认项; AC-02 still contains `price_band`)
- Modify: `services/agent-runtime/tests/test_chat_system_prompt.py` (keep filename copout asserts; add identity asserts)

**Interfaces:**
- Produces: `format_parse_context_block(parse: dict, *, ask_unknown: bool = False) -> str`
- Produces: `parse_block_asks_unknown(text: str) -> bool` — True iff text contains any of `上架` / `投放` / `营销方案` / `全链路` / `详情页`

- [ ] **Step 1: RED / update tests**

Replace `test_context_block_forbids_filename_copout` body so default `ask_unknown=False` still has the filename line and **does not** contain `待确认项` or `向用户确认` even when `unknown=["price_band"]`.

Add:

```python
def test_context_block_ask_unknown_true_keeps_confirm_hint():
    block = format_parse_context_block(
        {"user_facing_summary": "不锈钢水杯", "fields": {"category": "水杯"}, "unknown": ["price_band"]},
        ask_unknown=True,
    )
    assert "待确认项" in block
    assert "price_band" in block
    assert "向用户确认" in block


def test_parse_block_asks_unknown_closed_set():
    from app.graph.sidebar_media_parse import parse_block_asks_unknown

    assert parse_block_asks_unknown("请帮我设计这个产品的电商产品上架方案") is True
    assert parse_block_asks_unknown("@I1 模特 @I2 产品，让模特穿上，保持构图不变") is False
```

In `test_ac01_parse_then_explore_reply_uses_summary_not_node_id`, after system is available:

```python
    system = _system_text(messages)
    assert "待确认项" not in system
    assert "向用户确认" not in system
```

Keep AC-02 `assert "price_band" in system`.

In `test_chat_system_prompt.py` keep:

```python
assert "若已提供【侧栏参考图解析】" in _SYSTEM
assert "不得声称只能看到文件名或画布节点标题" in _SYSTEM
```

Add:

```python
def test_chat_system_sidebar_chips_are_not_canvas_ids():
    assert "@I1" in _SYSTEM or "侧栏芯片" in _SYSTEM
    assert "不是画布节点" in _SYSTEM or "不是画布" in _SYSTEM
    assert "apply_sidebar_attachments" in _SYSTEM
```

- [ ] **Step 2:** Run the above — FAIL until implementation.

- [ ] **Step 3: `format_parse_context_block`**

```python
_PARSE_ASK_UNKNOWN_MARKERS = ("上架", "投放", "营销方案", "全链路", "详情页")


def parse_block_asks_unknown(text: str) -> bool:
    t = text or ""
    return any(m in t for m in _PARSE_ASK_UNKNOWN_MARKERS)


def format_parse_context_block(parse: dict, *, ask_unknown: bool = False) -> str:
    summary = str(parse.get("user_facing_summary") or "").strip() or "未知"
    category = str((parse.get("fields") or {}).get("category") or "").strip()
    category_line = category if category else "未知，勿编造"
    unknown = parse.get("unknown") or []
    unknown_hint = ""
    if ask_unknown and unknown:
        unknown_hint = f"\n待确认项：{'、'.join(str(u) for u in unknown)}"
    if ask_unknown:
        commerce = "图中未出现的价格/平台/资质不要编，改为向用户确认。"
    else:
        commerce = (
            "图中未出现的价格/平台/资质不要编造；不要向用户追问这些项，"
            "也不要因此推迟摆盘或 propose_generation。"
        )
    return (
        "【侧栏参考图解析】\n"
        f"摘要：{summary}\n"
        f"品类：{category_line}{unknown_hint}\n"
        "请基于以上理解回答或写方案。不要声称只能看到文件名或画布节点标题。\n"
        f"{commerce}"
    )
```

- [ ] **Step 4: explore inject**

```python
from app.graph.sidebar_media_parse import (
    format_parse_context_block,
    parse_block_asks_unknown,
    prefix_assistant_reply,
)
# ...
if parse:
    system_content = system_content + "\n\n" + format_parse_context_block(
        parse, ask_unknown=parse_block_asks_unknown(user_text)
    )
```

- [ ] **Step 5: `_EXPLORE_SYSTEM` verbatim increments**

Keep rules 1–3, 5, 8, 9. Replace rules 4, 6, 7 with:

```
4. 用户要创建图片/视频/文本/音频节点或明确「生成一张…」时：用 upsert_media_node
创建或更新节点（可带 prompt），按需再用 set_node_prompt 填参、用 connect_nodes 连线，
然后调用 propose_generation，并等待用户确认；不要假装已出图。
有侧栏参考图要出结果图时：用 upsert_media_node 新建一张图节点（用户明确要求改某个
image-* 除外），再 apply_sidebar_attachments（mode=localRefs，mentioned_keys 用 I1/I2
芯片序），必要时 set_node_prompt，然后 propose_generation。此路径不要 connect_nodes、
不要 attach_refs。一致性写在提示词和 ref 顺序（先身份后衣服/产品），不要再搭工作流。
6. 若需要当前未绑定的能力，先调用 tool_search 加载 deferred 工具。
upsert_media_node / propose_generation 在「生成一张」类口语下应已绑定，不要用 tool_search 找 CORE。
有侧栏参考图要出结果图时 upsert_media_node / apply_sidebar_attachments / propose_generation
应已绑定，不要用 tool_search 找 CORE。
7. 若已提供【侧栏参考图解析】，不得声称只能看到文件名或画布节点标题。
@I1/@I2 是侧栏芯片 key，不是画布节点 id。禁止问「I1 对应画布哪张图」；禁止把芯片映射到
已有画布节点（除非用户明确要求改该节点）。侧栏图≥3 且未 @、或只有旧图且未 @：先问用哪几张
或请 @I1，不要对闲聊新建节点。
```

`test_b5_explore_system_guides_upsert_propose_not_run` still requires `connect_nodes` (rule 4 first paragraph + rule 5). Do not remove those.

- [ ] **Step 6:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest \
  tests/test_sidebar_media_parse.py \
  tests/test_sidebar_media_parse_ac.py \
  tests/test_chat_system_prompt.py \
  tests/test_phase_2b_propose_tools.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/agent-runtime/app/graph/sidebar_media_parse.py \
  services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_sidebar_media_parse.py \
  services/agent-runtime/tests/test_sidebar_media_parse_ac.py \
  services/agent-runtime/tests/test_chat_system_prompt.py
git commit -m "$(cat <<'EOF'
fix(agent): stop commerce QA on gen-path sidebar parse; name chip ids

EOF
)"
```

---

### Task 6: Regression gate (S7 / S10)

**Files:** none expected unless a test broke.

- [ ] **Step 1:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest \
  tests/test_explore_narrow_bind.py \
  tests/test_explore_tools.py \
  tests/test_phase_2b_propose_tools.py \
  tests/test_chat_system_prompt.py \
  tests/test_sidebar_media_parse.py \
  tests/test_sidebar_media_parse_ac.py \
  tests/test_nest_event_proxy.py \
  tests/test_campaign_sidebar_refs.py -v
```

Expected: PASS. Confirm `test_b1_propose_and_upsert_visible_run_gen_not` still asserts no `run_*` in `build_tool_plan().visible_names`.

- [ ] **Step 2:** Grep guard — must be empty:

```bash
rg -n "穿上|换装" services/agent-runtime/app/graph/explore_dispatch.py services/agent-runtime/app/graph/atomic_intent.py
```

`explore_dispatch.py` must not gain those literals. `TRANSFORM_VERBS` in `l0_action.py` must be untouched.

- [ ] **Step 3:** Confirm these files have **zero** diff:

- `deploy/prod-phase-2d3-h8-verify.py`
- `deploy/prod-phase-v2-bare-gen-verify.py`

- [ ] **Step 4: Commit** only if Step 1–3 required extra fixes.

---

## Spec coverage (self-review)

| Spec | Task |
|------|------|
| SM-D1 / SM-D2 no verb table | Task 2 + Task 6 grep |
| SM-D3 sidebar 4-set, planner first | Task 2 |
| SM-D4 omit attachments | Task 4 |
| SM-D5 parse ask_unknown | Task 5 |
| SM-D6 no mandatory / no H8 V2 | Task 6 |
| SM-D7 this-turn new only | Task 2 resolve + Task 3 parse stamp |
| §2.6 prompt identity | Task 5 |
| S1–S7 bind | Task 1–3 |
| S8 | Task 4 |
| S9 | Task 5 |
| S10 / P7 script unmodified | Task 6 |

---

## Execution handoff

Plan saved. Two options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with checkpoints  

Which approach?
