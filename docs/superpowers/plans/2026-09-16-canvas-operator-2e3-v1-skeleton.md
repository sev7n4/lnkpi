# Canvas Operator 2e.3 V1 Oral Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production V1 gold utterance builds a multi-node canvas skeleton (image + video or image→video chain, ≥1 `connect_nodes` edge, non-empty dock prompts, per-node `propose_generation`) and stops at `pending_confirm` with no `run_*` and no billed complete.

**Architecture:** Bind is already 2e.2 (operator nine visible; V1 gold is not `#355` composition). This slice is prompt isomorphic + write-retry copy so the model actually uses upsert/connect/propose, plus a production harness for E14–E18. Do not mandatory-dispatch propose. Do not treat import/instantiate/composition HTTP as a pass.

**Tech Stack:** Python agent-runtime; pytest; production SSE harness (same login as V2).

**Spec:** [docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md](../specs/2026-09-16-canvas-operator-2e-design.md) §0.3 V1 gold, §2.3, E14–E18, 2E-D5/D7/D9.

## Global Constraints

- V1 gold (verbatim): `我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock`
- V2 gold (verbatim, regression only): `帮我生成一张蓝色天空产品主图`
- E14: `flow_mode=canvas_agent` (not atomic subgraph)
- E15: ≥2 media nodes covering 生图 **and** 生视频 (two types, or image→video chain) + ≥1 canvas edge + non-empty dock prompt on generatable nodes
- E16: tools must include `upsert_media_node` (or equivalent new media node) **and** `connect_nodes` **and** `propose_generation`; no `run_*`. **`import_workflow` / `instantiate_workflow_template` must not green this utterance**. Edges must come from `connect_nodes` canvas_action, not import/instantiate land
- E17: generatable nodes `pending_confirm` (or equivalent); no billed complete; **do not** auto-confirm; **do not** charge
- E18: no atomic 「基于引用内容…」 card; chips are not canvas edges
- V1 gold must **not** match `is_composition_structure_utterance` (no 规划+工作流 pair; 「连接好」≠ `连线|连好线`)
- Do not add 穿上/换装/`工作流`/`分镜`/`搭骨架` to `MEDIA_CREATE_HINTS`
- Do not modify `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`, or 2e.1 harness semantics
- No `run_*` visible or called; no 19-tool dump; no new confirm API; no 2d.4; no Phase 3
- `MAX_EXPLORE_TOOL_ROUNDS` is currently 4; one round may emit multiple tool_calls. Do **not** raise the cap unless production E16 fails with a truncated tool loop. If raised, lock it with a unit test
- Prod: `BASE_URL=http://119.29.173.89:8888` `PHONE=17279698608` `CODE=123456`
- Branch: `feature/canvas-operator-2e3` from `origin/main` (`513c4fa7`)
- This PR ships unit tests + prompt + harness. **Do not run V1 gold against production in this PR.** E14–E18 production is the post-merge deploy loop

---

## File map

| File | Responsibility |
|------|----------------|
| Spec + this plan | Authorize E14–E18 |
| `tests/test_composition_route.py` or `tests/test_explore_narrow_bind.py` | V1 gold is not composition; operator bind still holds |
| `tests/test_chat_system_prompt.py` | Rule-5 skeleton: 生图+生视频, dock, connect_nodes, no import-as-pass |
| `app/graph/nodes/explore.py` | Rule 5 copy; write-retry must name upsert/connect/propose not import |
| `deploy/prod-phase-2e3-v1-verify.py` | Production E14–E18 harness (run after deploy) |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md` (header `实现 plan`)
- Create: this plan file

**Interfaces:**
- Consumes: spec §2.3 E14–E18
- Produces: spec header links here for 2e.3; 2e.1/#354 and 2e.2/#357 stay delivered

- [ ] **Step 1:** Spec header `实现 plan` must say 2e.1 delivered (#354), 2e.2 delivered (#357), and this file is the **only** 2e.3 plan.

- [ ] **Step 2: Commit** (docs only)

```bash
git add docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md \
  docs/superpowers/plans/2026-09-16-canvas-operator-2e3-v1-skeleton.md
git commit -m "$(cat <<'EOF'
docs(agent): plan Canvas Operator 2e.3 V1 oral skeleton

EOF
)"
```

---

### Task 1: RED tests — V1 is not composition; prompt names skeleton tools

**Files:**
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`
- Modify: `services/agent-runtime/tests/test_chat_system_prompt.py`
- Modify: `services/agent-runtime/tests/test_composition_route.py` (append; do not weaken GOLD_COMPOSE_1 empty-write tests)

**Interfaces:**
- Consumes: `GOLD_V1` already in `test_explore_narrow_bind.py`; `is_composition_structure_utterance`; `_SYSTEM` / `_EXPLORE_SYSTEM`
- Produces: E14-adjacent unit locks (route/bind/prompt). Production E14–E18 stay in Task 3 harness

- [ ] **Step 1: Bind / composition tests**

Keep existing `test_e6_v1_gold_bind_includes_operator_skeleton_tools`. Append:

```python
def test_e14_v1_gold_is_not_composition_structure():
    from app.graph.composition_route import is_composition_structure_utterance

    assert is_composition_structure_utterance(GOLD_V1) is False
    tools = select_narrow_write_tools(GOLD_V1)
    assert OPERATOR_WRITE <= tools
    assert "connect_nodes" in tools
    assert "import_workflow" not in tools
    assert "instantiate_workflow_template" not in tools
```

In `test_composition_route.py` (or `test_composition_l0.py` if that is where GOLD_COMPOSE_1 lives), append:

```python
def test_v1_operator_gold_does_not_trip_composition_structure():
    from app.graph.composition_route import is_composition_structure_utterance

    gold = (
        "我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock"
    )
    assert is_composition_structure_utterance(gold) is False
    assert is_composition_structure_utterance(GOLD_COMPOSE_1) is True
```

- [ ] **Step 2: Prompt tests** — append to `test_chat_system_prompt.py`:

```python
def test_chat_system_v1_skeleton_prefers_upsert_connect_propose():
    assert "connect_nodes" in _SYSTEM
    assert "upsert_media_node" in _SYSTEM
    assert "propose_generation" in _SYSTEM
    assert "生图" in _SYSTEM and "生视频" in _SYSTEM
    assert "dock" in _SYSTEM.lower() or "填" in _SYSTEM
    assert "不要压成单个" in _SYSTEM or "不要压成" in _SYSTEM


def test_chat_system_v1_skeleton_must_not_prefer_import():
    assert "import_workflow" in _SYSTEM  # still mentioned for import turns
    # skeleton path must not tell the model import is the way to pass 生图生视频
    assert "口语搭骨架" in _SYSTEM or "骨架" in _SYSTEM
```

If `test_chat_system_v1_skeleton_prefers_upsert_connect_propose` already PASSES on current rule 5 except `生图`+`生视频`, leave passing asserts; keep the 生图/生视频 pair as the RED that Task 2 must add.

- [ ] **Step 3: Write-retry copy test**

Find the explore write-retry `SystemMessage` in `app/graph/nodes/explore.py` (currently names `set_node_prompt` / `import_workflow` / `upload_media_to_canvas`). Add:

```python
def test_explore_write_retry_names_operator_skeleton_tools():
    from app.graph.nodes.explore import make_explore_node
    import inspect
    src = inspect.getsource(make_explore_node)
    assert "upsert_media_node" in src
    assert "connect_nodes" in src
    assert "propose_generation" in src
```

Prefer extracting the retry string to a module-level `_WRITE_RETRY_SYSTEM` constant if inspect-on-closure is brittle — if you extract, assert on that constant instead.

- [ ] **Step 4: Run (expect RED on new 生图/生视频 and write-retry)**

```bash
cd services/agent-runtime && python3.11 -m pytest \
  tests/test_explore_narrow_bind.py \
  tests/test_chat_system_prompt.py \
  tests/test_composition_l0.py \
  tests/test_composition_route.py -q
```

- [ ] **Step 5: Commit tests only**

```bash
git add services/agent-runtime/tests/test_explore_narrow_bind.py \
  services/agent-runtime/tests/test_chat_system_prompt.py \
  services/agent-runtime/tests/test_composition_l0.py \
  services/agent-runtime/tests/test_composition_route.py
git commit -m "$(cat <<'EOF'
test(agent): lock V1 gold off composition and onto skeleton prompt

EOF
)"
```

---

### Task 2: Prompt + write-retry isomorphic with V1 skeleton

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`

**Interfaces:**
- Consumes: Task 1 RED tests
- Produces: Rule 5 tells the in-hand tools to build 生图+生视频 skeleton; write-retry names those tools

- [ ] **Step 1:** Replace rule 5 in `_EXPLORE_SYSTEM` (keep rules 1–4 and 6–9). New rule 5 must include these facts (Chinese, concise):

```
"5. 口语搭骨架（含「生图生视频」、多节点+连线+填 dock）：至少 upsert_media_node 两个媒体节点"
"（一张 image 与一条 video，或 image→video 链），每个可生成节点 prompt 非空（创建时带 prompt 或 set_node_prompt），"
"用 connect_nodes 连 canvas 节点 id，再对每个可生成节点 propose_generation。"
"不要压成单个 atomic 式节点；不要 import_workflow / instantiate_workflow_template 顶替本句；"
"不要把 @I* 芯片连成边。确认前不要 run_*、不要声称已出图。\n"
```

Do not mention `run_*` as callable. Do not list 19 write tools.

- [ ] **Step 2:** Change the write-retry `SystemMessage` to:

```python
_WRITE_RETRY_SYSTEM = (
    "必须调用写入类工具完成操作（如 upsert_media_node、connect_nodes、"
    "set_node_prompt、propose_generation）。"
    "口语搭骨架不要改用 import_workflow。"
)
```

Use this constant in the retry branch instead of the inline string that currently lists `import_workflow` / `upload_media_to_canvas` first.

- [ ] **Step 3: Run Task 1 tests**

```bash
cd services/agent-runtime && python3.11 -m pytest \
  tests/test_explore_narrow_bind.py \
  tests/test_chat_system_prompt.py \
  tests/test_composition_l0.py \
  tests/test_composition_route.py \
  tests/test_planner_system_prompt.py \
  tests/test_arrange_along_edges_bind.py \
  tests/test_upscale_image_bind.py -q
```

Expected: PASS. `#355` composition gold still `is_composition_structure_utterance True` and empty writes.

- [ ] **Step 4: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_chat_system_prompt.py
git commit -m "$(cat <<'EOF'
feat(agent): prompt V1 oral skeleton as upsert-connect-propose

EOF
)"
```

---

### Task 3: Production harness (not run in this PR)

**Files:**
- Create: `deploy/prod-phase-2e3-v1-verify.py`

**Interfaces:**
- Consumes: V2 harness helpers pattern (`sse_chat`, login, canvas create). Do **not** edit V2/H8/2e.1 scripts
- Produces: E14–E18 assertions for a later deploy loop

- [ ] **Step 1:** New script with GOLD = V1 verbatim. Reuse HTTP/SSE style from `deploy/prod-phase-v2-bare-gen-verify.py` (copy helpers, new Idempotency-Key prefix `2e3_`). Timeout default 240s (multi-tool).

Record these cases (exact names):

1. `E14 flow_mode=canvas_agent`
2. `E16 tools include upsert_media_node + connect_nodes + propose_generation`
3. `E16 no run_*`
4. `E16 import/instantiate are not the pass` — fail if `import_workflow` or `instantiate_workflow_template` in tools **and** (`connect_nodes` missing **or** upsert missing)
5. `E15 >=2 media nodes` from loaded canvas (`image-*` / `video-*` ids, or node type image/video)
6. `E15 covers image and video` — at least one image node and one video node, **or** an edge chain from an image id to a video id
7. `E15 >=1 canvas edge` — count `canvasData.edges`; additionally require a `canvas_action` whose tool/name is `connect_nodes` (or payload type matching connect). If edges exist but tools lack `connect_nodes`, **FAIL** (import land)
8. `E15 non-empty dock prompt` — every generatable media node (`image`/`video`) has non-empty `data.prompt` or equivalent
9. `E17 pending_confirm, no billed complete`
10. `E18 no atomic card` — fail if reply contains `基于引用内容` or flow is atomic subgraph; fail if any `connect_nodes` arg uses `I1`/`I2`/`@I`

Print `PASS=n FAIL=m` like V2. Exit 1 if FAIL.

- [ ] **Step 2:** Do **not** execute the script against production in this task.

- [ ] **Step 3: Commit**

```bash
git add deploy/prod-phase-2e3-v1-verify.py
git commit -m "$(cat <<'EOF'
test(agent): add production harness for 2e.3 V1 skeleton

EOF
)"
```

---

### Task 4: Stop — no production V1, no V2/H8 edits

**Files:** none required

- [ ] **Step 1:** `git diff --name-only origin/main...HEAD` must not include `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`, or 2e.1 harness.

- [ ] **Step 2:** Do not run V1 gold on production until this runtime is deployed. Do not bump `MAX_EXPLORE_TOOL_ROUNDS` in this PR.

- [ ] **Step 3:** Optional local pytest already green in Task 2.

---

## Self-review (author)

1. **Spec coverage:** E14 route → Task 1 composition false + harness E14. E15–E17 → harness (prod after deploy). E16 tool names → prompt Task 2 + harness. E18 → harness. Bind already 2e.2 E6.
2. **Placeholder scan:** no TBD.
3. **#355:** composition gold stays structure=True / empty writes; V1 gold stays structure=False / operator nine.
