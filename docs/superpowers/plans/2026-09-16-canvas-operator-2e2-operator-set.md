# Canvas Operator 2e.2 Operator Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default `canvas_agent` rounds always bind the nine-tool operator set; planner/import tools overlay additively; `图生视频` / `分镜` no longer steal canvas tools.

**Architecture:** Change `select_narrow_write_tools` from exclusive ≤5 scene sets to `OPERATOR_WRITE | overlay`. `_bind_plan_tools` already culls `EXPLORE_WRITE_TOOLS` to that set — no second cull. Prompt and `attach_refs` / `apply_sidebar_attachments` descriptions encode hang-identity (chips vs canvas ids) and “visible ≠ must call”. Do not mandatory-dispatch propose.

**Tech Stack:** Python agent-runtime; pytest; existing Nest canvas tools.

**Spec:** [docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md](../specs/2026-09-16-canvas-operator-2e-design.md) §0.1–0.2, §2.2, E6–E13, 2E-D2/D3/D6/D7/D9/D10.

## Global Constraints

- Operator set (exactly 9): `upsert_media_node` · `propose_generation` · `set_node_prompt` · `set_node_content` · `upsert_prompt_node` · `connect_nodes` · `apply_sidebar_attachments` · `attach_refs` · `duplicate_node`
- Overlay import: `import_workflow` on strong anchors only
- Overlay planner: `match_workflow_templates` · `preview_workflow_template` · `promote_workflow_template`; add `instantiate_workflow_template` only when utterance contains `确认落到画布`
- Abolish `图生视频` / `分镜` as subtractive planner predicates; V1 gold contains `生图生视频`
- V1 visibility gold (verbatim): `我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock`
- V2 gold (verbatim): `帮我生成一张蓝色天空产品主图`
- Merge gate = E6–E13 visibility + no `run_*` + no mandatory propose. 「谢谢不得出现 propose `tool_call`」is post-deploy eval, not CI
- Chips `@I*` / `I1` → only `apply_sidebar_attachments` (`mode=localRefs`); canvas `image-*` / `video-*` → `attach_refs` and/or `connect_nodes`; never `attach_refs` on chip keys; never `connect_nodes` to chips
- No `run_*` visible or called; no 19-tool dump; upload / upscale / asset-library stay deferred or non-operator CORE as today
- Do not add 穿上/换装/`工作流`/`分镜`/`搭骨架` to `MEDIA_CREATE_HINTS`
- Do not modify `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`, or 2e.1 harness semantics
- No 2e.3 production V1 gold run in this PR; no 2d.4; no Phase 3; no new confirm API
- Branch: `feature/canvas-operator-2e2` from `origin/main` (`28d35d41`)

---

## File map

| File | Responsibility |
|------|----------------|
| Spec + this plan | Authorize E6–E13 |
| `app/graph/explore_dispatch.py` | `_OPERATOR_WRITE`; additive `select_narrow_write_tools`; `_is_planner_utterance` without 图生视频/分镜 |
| `app/graph/nodes/explore.py` | Prompt isomorphic with 9-set + hang table + idle-no-propose; planner overlay does not ban `connect_nodes` |
| `app/tools/definitions.py` | `attach_refs` description: canvas ids only |
| `tests/test_explore_narrow_bind.py` | E6–E13 |
| `tests/test_chat_system_prompt.py` | Hang table + idle + instantiate gate sentences |
| `tests/test_arrange_along_edges_bind.py` / `test_upscale_image_bind.py` | Re-run; should stay green (those tools are not in `EXPLORE_WRITE_TOOLS`) |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md` (header `实现 plan`)
- Create: this plan file

**Interfaces:**
- Consumes: spec 2E-D2, 2E-D3, E6–E13
- Produces: spec header links here for 2e.2

- [ ] **Step 1:** Spec header `实现 plan` must say 2e.1 delivered (#354) and this file is the **only** 2e.2 plan.

- [ ] **Step 2: Commit** (docs only)

```bash
git add docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md \
  docs/superpowers/plans/2026-09-16-canvas-operator-2e2-operator-set.md
git commit -m "$(cat <<'EOF'
docs(agent): plan Canvas Operator 2e.2 additive operator set

EOF
)"
```

---

### Task 1: RED tests E6–E13

**Files:**
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`

**Interfaces:**
- Consumes: `select_narrow_write_tools`, `_bind_plan_tools`
- Produces: `OPERATOR_WRITE`, `GOLD_V1` used by later tasks verbatim

Replace the exclusive-set assertions. Keep `GOLD_BARE_GEN`, `GOLD_TRYON`, `utterance_binds_*` gates.

- [ ] **Step 1: After `SIDEBAR_MEDIA_WRITE`, add constants**

```python
GOLD_V1 = (
    "我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock"
)
OPERATOR_WRITE = frozenset({
    "upsert_media_node",
    "propose_generation",
    "set_node_prompt",
    "set_node_content",
    "upsert_prompt_node",
    "connect_nodes",
    "apply_sidebar_attachments",
    "attach_refs",
    "duplicate_node",
})
RUN_STAR = frozenset({"run_image_generation", "run_video_generation"})
```

Replace exclusive tests with these bodies (same function names unless noted).

`test_planner_utterance_binds_preview_and_instantiate_not_only_import`:

```python
def test_planner_utterance_binds_preview_and_instantiate_not_only_import():
    tools = select_narrow_write_tools("帮我规划一个电商套图工作流，接到角色三视图")
    assert OPERATOR_WRITE <= tools
    assert "preview_workflow_template" in tools
    assert "match_workflow_templates" in tools
    assert "instantiate_workflow_template" not in tools
    assert "import_workflow" not in tools
```

`test_plan_a_workflow_without_consecutive_anchor_binds_planner`:

```python
def test_plan_a_workflow_without_consecutive_anchor_binds_planner():
    tools = select_narrow_write_tools("帮我规划一个角色三视图工作流")
    assert OPERATOR_WRITE <= tools
    assert _PLANNER_TOOLS <= tools
    assert "instantiate_workflow_template" not in tools
    assert "import_workflow" not in tools
```

`test_confirm_canvas_bind_includes_instantiate`:

```python
def test_confirm_canvas_bind_includes_instantiate():
    tools = select_narrow_write_tools("确认落到画布")
    assert OPERATOR_WRITE <= tools
    assert "instantiate_workflow_template" in tools
    assert _PLANNER_TOOLS <= tools
```

`test_import_workflow_utterance_still_binds_only_import` → rename conceptually but keep name:

```python
def test_import_workflow_utterance_still_binds_only_import():
    tools = select_narrow_write_tools("请用 import_workflow 导入")
    assert "import_workflow" in tools
    assert OPERATOR_WRITE <= tools
```

`test_planner_keywords_bind_planner_tools`: drop `tools == _PLANNER_TOOLS`; assert `OPERATOR_WRITE <= tools` and planner three present, no instantiate.

`test_import_workflow_chinese_still_binds_only_import`:

```python
def test_import_workflow_chinese_still_binds_only_import():
    for u in ("请导入工作流到画布", "导入工作流"):
        tools = select_narrow_write_tools(u)
        assert "import_workflow" in tools
        assert OPERATOR_WRITE <= tools
```

`test_promote_phrases_bind_promote_not_only_import`: drop `len(tools) <= 5` and `tools == _PLANNER_TOOLS`; assert operator + promote.

`test_live_explore_bind_uses_narrow_planner_writes`:

```python
    bound = set(captured[0])
    assert "preview_workflow_template" in bound
    assert "set_node_prompt" in bound
    assert "connect_nodes" in bound
    assert "upsert_media_node" in bound
    assert "import_workflow" not in bound
    assert "instantiate_workflow_template" not in bound
    assert not bound.intersection(RUN_STAR)
```

`test_p1_gold_sentence_binds_media_narrow_set`:

```python
def test_p1_gold_sentence_binds_media_narrow_set():
    tools = select_narrow_write_tools(GOLD_BARE_GEN)
    assert OPERATOR_WRITE <= tools
    assert "upsert_media_node" in tools
    assert "propose_generation" in tools
```

`test_p2_poster_look_does_not_bind_propose` and `test_p3_regen_phrase_does_not_bind_propose` and `test_campaign_override_does_not_bind_media_set`: **visibility** still has operator set (including `propose_generation`). Lock the **call** gate, not absence:

```python
def test_p2_poster_look_does_not_bind_propose():
    from app.graph.explore_dispatch import utterance_binds_media_propose

    tools = select_narrow_write_tools("看看这张海报")
    assert OPERATOR_WRITE <= tools
    assert utterance_binds_media_propose("看看这张海报") is False


def test_p3_regen_phrase_does_not_bind_propose():
    from app.graph.explore_dispatch import utterance_binds_media_propose

    tools = select_narrow_write_tools("重新生成一张")
    assert OPERATOR_WRITE <= tools
    assert utterance_binds_media_propose("重新生成一张") is False
```

Campaign override: keep `utterance_binds_media_propose(...) is False`; operator set still visible.

`test_p5_bind_plan_tools_gold_includes_media_writes`: add `assert "connect_nodes" in bound`.

`test_s1_tryon_gold_with_chips_binds_sidebar_set`:

```python
def test_s1_tryon_gold_with_chips_binds_sidebar_set():
    tools = select_narrow_write_tools(
        GOLD_TRYON,
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
    )
    assert OPERATOR_WRITE <= tools
    assert "apply_sidebar_attachments" in tools
```

Remove `assert "attach_refs" not in tools` and `assert "connect_nodes" not in tools` and `len(tools) <= 5`.

`test_s2_tryon_gold_without_chips_does_not_bind_via_chuanshang`: operator visible; `utterance_binds_media_propose(GOLD_TRYON)` stays False (no MEDIA_CREATE_HINTS expansion). `utterance_binds_sidebar_media_propose(GOLD_TRYON, None)` stays False.

`test_s3*` / `test_s3b_thanks*` / `test_s5_what_is_i1*`: keep **bind predicate** False for propose; **do not** assert `propose_generation not in tools`. Assert `OPERATOR_WRITE <= tools` and the existing `utterance_binds_sidebar_media_propose` / `utterance_binds_media_propose` False cases.

`test_s3b_thanks_with_old_chips_does_not_bind`:

```python
def test_s3b_thanks_with_old_chips_does_not_bind():
    from app.graph.explore_dispatch import utterance_binds_sidebar_media_propose

    tools = select_narrow_write_tools(
        "谢谢",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
    )
    assert OPERATOR_WRITE <= tools
    assert utterance_binds_sidebar_media_propose("谢谢", ["I1", "I2"]) is False
    assert utterance_binds_media_propose("谢谢") is False
```

`test_s6_planner_plus_chips_stays_planner`:

```python
    assert OPERATOR_WRITE <= tools
    assert tools >= _PLANNER_TOOLS
    assert "instantiate_workflow_template" not in tools
```

`test_s1_bare_gen_plus_chips_uses_sidebar_set_not_attach_refs`: operator includes both hang tools; keep `apply_sidebar_attachments in tools`; drop `attach_refs not in tools`.

`test_s7_bare_gen_without_chips_still_media_write`: `assert OPERATOR_WRITE <= select_narrow_write_tools(GOLD_BARE_GEN)`.

`test_s1_bind_plan_tools_tryon_includes_sidebar_writes`: drop `assert "attach_refs" not in bound`; assert operator names including `connect_nodes` and `attach_refs` **are** bound.

Append new tests:

```python
def test_e6_v1_gold_bind_includes_operator_skeleton_tools():
    tools = select_narrow_write_tools(GOLD_V1)
    assert OPERATOR_WRITE <= tools
    assert "upsert_media_node" in tools
    assert "connect_nodes" in tools
    assert "propose_generation" in tools
    assert "instantiate_workflow_template" not in tools
    assert "import_workflow" not in tools


def test_e10_thanks_vision_regen_operator_visible_no_run_star():
    from app.graph.nodes.explore import _bind_plan_tools
    from app.tools.definitions import EXPLORE_WRITE_TOOLS
    from unittest.mock import MagicMock

    for u in ("谢谢", "@I1 是什么衣服", "重新生成一张"):
        tools = select_narrow_write_tools(u, sidebar_image_keys=("I1",), mentioned_keys=("I1",))
        assert OPERATOR_WRITE <= tools
        assert tools.isdisjoint(RUN_STAR)

    captured: list[list[str]] = []

    class FakeLlm:
        def bind_tools(self, tools):
            captured.append([getattr(t, "name", "") for t in tools])
            return self

    tools_by_name = {name: MagicMock(name=name) for name in EXPLORE_WRITE_TOOLS}
    for name, tool in tools_by_name.items():
        tool.name = name
    _bind_plan_tools(FakeLlm(), tools_by_name, [], "谢谢")
    bound = set(captured[0])
    assert OPERATOR_WRITE <= bound
    assert bound.isdisjoint(RUN_STAR)


def test_e11_build_tool_plan_excludes_run_star():
    plan = build_tool_plan(loaded=[])
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names


def test_e12_shengtu_shengshipin_is_not_planner_exclusive():
    tools = select_narrow_write_tools("我想直接生图生视频")
    assert OPERATOR_WRITE <= tools
    assert tools != _PLANNER_TOOLS
    assert "match_workflow_templates" not in tools
```

- [ ] **Step 2: Run tests (expect RED)**

```bash
cd services/agent-runtime && python3.11 -m pytest tests/test_explore_narrow_bind.py -q
```

Expected: FAIL on E6 / planner exclusive equality / `len(tools) <= 5` leftovers / try-on `attach_refs not in`.

- [ ] **Step 3: Do not implement yet** (Task 2). If any new test already PASSES, leave it; do not weaken RED ones.

- [ ] **Step 4: Commit tests only**

```bash
git add services/agent-runtime/tests/test_explore_narrow_bind.py
git commit -m "$(cat <<'EOF'
test(agent): require additive operator set on explore bind

EOF
)"
```

---

### Task 2: Additive `select_narrow_write_tools`

**Files:**
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py` (`_DEFAULT_NARROW_WRITE` / `_is_planner_utterance` / `select_narrow_write_tools` ~94–273)

**Interfaces:**
- Consumes: Task 1 constants (same nine names)
- Produces: `select_narrow_write_tools` always returns a set ⊇ operator nine; overlays as spec §0.2

- [ ] **Step 1: Replace the five exclusive frozensets used as return values**

Keep `_PLANNER_WRITE_TOOLS`, `_PLANNER_INSTANTIATE_TOOLS`, `_IMPORT_WRITE_TOOLS` as **overlay** sets. Replace `_DEFAULT_NARROW_WRITE` / `_MEDIA_PROPOSE_WRITE` / `_SIDEBAR_MEDIA_WRITE` **returns** with operator ∪ optional overlay. You may keep the old frozensets as unused or delete them if no remaining references.

```python
_OPERATOR_WRITE = frozenset({
    "upsert_media_node",
    "propose_generation",
    "set_node_prompt",
    "set_node_content",
    "upsert_prompt_node",
    "connect_nodes",
    "apply_sidebar_attachments",
    "attach_refs",
    "duplicate_node",
})
```

- [ ] **Step 2: `_is_planner_utterance` — delete the 图生视频/分镜 exclusive**

```python
def _is_planner_utterance(text: str) -> bool:
    if not text:
        return False
    if any(anchor in text for anchor in _PLANNER_ANCHORS):
        return True
    if _PLANNER_CONFIRM in text:
        return True
    return "规划" in text and "工作流" in text
```

- [ ] **Step 3: Additive `select_narrow_write_tools`**

```python
def select_narrow_write_tools(
    utterance: str,
    *,
    sidebar_image_keys: Sequence[str] = (),
    this_turn_new_image_keys: Sequence[str] = (),
    mentioned_keys: Sequence[str] = (),
) -> frozenset[str]:
    """Default operator set; planner/import overlays add tools and never subtract."""
    visible = set(_OPERATOR_WRITE)
    text = utterance or ""
    low = text.lower()
    if "import_workflow" in low or "导入工作流" in text:
        visible |= _IMPORT_WRITE_TOOLS
        return frozenset(visible)
    if _PLANNER_CONFIRM in text:
        visible |= _PLANNER_INSTANTIATE_TOOLS
        return frozenset(visible)
    if _is_planner_utterance(text):
        visible |= _PLANNER_WRITE_TOOLS
        return frozenset(visible)
    if _is_workflow_import_utterance(text):
        if _has_strong_workflow_import_anchor(text, low):
            visible |= _IMPORT_WRITE_TOOLS
        return frozenset(visible)
    return frozenset(visible)
```

Do **not** call `utterance_binds_media_propose` / sidebar bind to shrink the set. Keep those functions for prompt/eval; they must not become mandatory dispatch.

Leave `resolve_sidebar_image_ref_keys` unchanged (SM-D7).

Update the function docstring: remove “≤5 write tools” and “exclusive”.

- [ ] **Step 4: Run Task 1 tests**

```bash
cd services/agent-runtime && python3.11 -m pytest tests/test_explore_narrow_bind.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/explore_dispatch.py
git commit -m "$(cat <<'EOF'
feat(agent): keep canvas operator tools visible with planner overlay

EOF
)"
```

---

### Task 3: Prompt isomorphic + hang-identity copy

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py` (`_PLANNER_SYSTEM` ~50–64, `_EXPLORE_SYSTEM` ~77–111)
- Modify: `services/agent-runtime/app/tools/definitions.py` (`attach_refs` description ~761–766)
- Test: `services/agent-runtime/tests/test_chat_system_prompt.py`

**Interfaces:**
- Consumes: operator nine now always bound when explore LLM runs
- Produces: prompt sentences that name only tools in-hand; hang table; idle-no-call

- [ ] **Step 1: Failing prompt tests** — append to `test_chat_system_prompt.py`:

```python
def test_chat_system_hang_identity_chips_vs_canvas_ids():
    assert "apply_sidebar_attachments" in _SYSTEM
    assert "attach_refs" in _SYSTEM
    assert "芯片" in _SYSTEM
    assert "image-*" in _SYSTEM or "画布节点" in _SYSTEM


def test_chat_system_idle_must_not_require_propose():
    assert "谢谢" in _SYSTEM or "闲聊" in _SYSTEM
    assert "propose_generation" in _SYSTEM


def test_chat_system_instantiate_only_after_confirm_canvas():
    assert "确认落到画布" in _SYSTEM
    assert "instantiate_workflow_template" in _SYSTEM
```

- [ ] **Step 2: Run (expect RED)**

```bash
cd services/agent-runtime && python3.11 -m pytest tests/test_chat_system_prompt.py -q
```

- [ ] **Step 3: Prompt patches**

Replace `_PLANNER_SYSTEM` first two instruction sentences (keep the rest of the string):

```python
_PLANNER_SYSTEM = (
    "规划工作流时：先 match_workflow_templates 再 preview_workflow_template。"
    "用户已说「确认落到画布」后用 instantiate_workflow_template，不要用手搭替代已确认的 instantiate。"
    "未确认落到画布时不要 instantiate；口语搭骨架（多节点+连线+填 dock）用 upsert_media_node 与 connect_nodes。"
    "instantiate_workflow_template 只在用户确认落到画布之后调用，"
    # ... keep remaining lines from the existing _PLANNER_SYSTEM starting at
    # "只传 parent_id、parent_version、delta" through arrange_nodes_along_edges.
)
```

Copy the rest of the current `_PLANNER_SYSTEM` after those new lead-in sentences so promote / confirmed / addedNodeIds behavior is unchanged.

In `_EXPLORE_SYSTEM`, after rule 4’s sidebar paragraph, add (keep existing rules 1–9; extend 4/5/6):

After the sentence `不要 attach_refs。` add:

```
"挂参分工：侧栏 @I* / I1 只用 apply_sidebar_attachments（mode=localRefs）；"
"画布已有 image-* / video-* 才用 attach_refs 或 connect_nodes。"
"禁止 attach_refs 吃芯片 key；禁止 connect_nodes 连芯片。"
"闲聊、谢谢、纯识图问句、「重新生成一张」即使工具可见也不得 upsert_media_node / propose_generation。"
"无「确认落到画布」不得 instantiate_workflow_template。"
```

In rule 6, add: `connect_nodes` 已绑定，不要用 `tool_search` 找 CORE 写工具。

Do not mention `run_*` as callable. Do not list the other ~10 write tools as always-on.

- [ ] **Step 4: `attach_refs` description**

```python
                description=(
                    "Attach ordered canvas node ids (image-* / video-*) as refs. "
                    "Never pass sidebar chip keys (I1/I2/@I*). "
                    "Use apply_sidebar_attachments for chips."
                ),
```

- [ ] **Step 5: Run prompt + bind tests**

```bash
cd services/agent-runtime && python3.11 -m pytest \
  tests/test_chat_system_prompt.py \
  tests/test_explore_narrow_bind.py \
  tests/test_arrange_along_edges_bind.py \
  tests/test_upscale_image_bind.py -q
```

Expected: PASS. `arrange_nodes_along_edges` / `upscale_image` remain visible because they are not in `EXPLORE_WRITE_TOOLS`.

- [ ] **Step 6: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/app/tools/definitions.py \
  services/agent-runtime/tests/test_chat_system_prompt.py
git commit -m "$(cat <<'EOF'
feat(agent): align explore prompt with always-on operator tools

EOF
)"
```

---

### Task 4: Stop — no 2e.3, no V2/H8 edits

**Files:** none required

**Interfaces:**
- Consumes: E6–E13 green locally
- Produces: handoff only

- [ ] **Step 1:** `git diff --name-only origin/main...HEAD` must not include `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`, or 2e.3 production scripts.

- [ ] **Step 2:** Do not run the V1 gold against production in this PR. 2e.3 starts after this runtime is deployed (spec §2.4).

- [ ] **Step 3:** Optional local extra: `python3.11 -m pytest tests/test_explore_tools.py tests/test_phase_2b_propose_tools.py -q` if those files exist; fix only if 2e.2 bind broke them.

---

## Self-review (author)

1. **Spec coverage:** E6–E9 overlays → Task 1+2. E10 visibility not tool_call → Task 1 thanks tests + 2E-D10. E11 → `test_e11`. E12 → `_is_planner_utterance` + `test_e12`. E13 → rewritten exclusive tests. Hang table → Task 3. 2E-D7 MEDIA_CREATE_HINTS untouched.
2. **Placeholder scan:** no TBD.
3. **Types:** `select_narrow_write_tools(...) -> frozenset[str]`; `_OPERATOR_WRITE` names match spec §0.1.
