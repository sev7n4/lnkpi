# Agent Consistency Chains (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement product + model consistency chains (4-panel turnaround nodes), three video nodes with prompt-only voiceover/subtitle hints, and same-chain `attach_refs` refresh before generation.

**Architecture:** Expand `canvas-manifest.yaml` with `chain`/`role` + new keys; pass metadata through `SplitManifestItem` / `split`; shared helper builds chain-aware `refOrder`; `orchestrate_gen` re-attaches refs immediately before each `run_*`. No TTS/mux (B2). Keep A gates (`await_topo` → confirm_gen).

**Tech Stack:** Python LangGraph Runtime, Nest `attach_refs` / image+video gen, YAML skill manifest, pytest.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-consistency-chains-design.md`（已确认）

## Global Constraints

- Dual chains required: product (`white_bg` → `product_turnaround` → downstreams) and model (`model_portrait` → `model_turnaround` → `model_lifestyle`).
- Turnaround = **one** image node, **4-panel** prompt (close-up left + front/side/back).
- Exactly three videos: `video_product` / `video_scene` / `video_lifestyle`; remove `show_video` and single `model`.
- `copy_main` never in video `depends_on` / image `refOrder`; voiceover/subtitle only in video `prompt_hint`.
- No audio nodes, TTS, subtitle tracks, or mux in this plan.
- Out图 only after A「确认出图」; do not reintroduce draft auto-orchestrate.
- `lnkpi.max_downstream` must be ≥ manifest item count (use **16**).

---

## File map

| File | Responsibility |
| --- | --- |
| `services/agent-runtime/skills/enterprise-marketing-campaign/assets/canvas-manifest.yaml` | Keys, depends_on, chain/role, prompts |
| `services/agent-runtime/skills/enterprise-marketing-campaign/SKILL.md` | max_downstream + asset wording |
| `services/agent-runtime/app/graph/state.py` | `chain` / `role` on `SplitManifestItem` |
| `services/agent-runtime/app/graph/chain_refs.py` | **New** — build refOrder from chain roles |
| `services/agent-runtime/app/graph/nodes/split.py` | Load chain/role; use chain_refs for initial attach |
| `services/agent-runtime/app/graph/nodes/orchestrate_gen.py` | Re-attach refs before each gen |
| `services/agent-runtime/tests/test_chain_refs.py` | **New** |
| `services/agent-runtime/tests/test_topo_trim.py` | Update fixtures for new keys |
| `services/agent-runtime/tests/test_orchestrate_gen.py` | Assert attach_refs order before gen |
| `services/agent-runtime/tests/test_manifest_consistency.py` | **New** — load real YAML, assert graph rules |

---

### Task 1: State fields + chain_refs helper (TDD)

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py`
- Create: `services/agent-runtime/app/graph/chain_refs.py`
- Create: `services/agent-runtime/tests/test_chain_refs.py`

**Interfaces:**
- Produces: `build_chain_ref_order(*, item: dict, by_key: dict[str, dict], plan_node_id: str | None) -> list[str]`
  - Returns ordered **node_id** strings (skip missing).
  - Rules from spec §2.1 / §1.4:
    - no chain → `[plan, …depends_on node_ids]`
    - seed → `[plan]`
    - turnaround → `[plan, seed]`
    - downstream (incl. videos) → `[plan, seed, turnaround]` then any remaining `depends_on` node_ids not already listed (for cross-chain e.g. `video_lifestyle` needing `scene` + `model_lifestyle`)

- [ ] **Step 1: Extend SplitManifestItem**

In `state.py`, add optional fields:

```python
chain: Literal["product", "model"] | None
role: Literal["seed", "turnaround", "downstream"] | None
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_chain_refs.py
from app.graph.chain_refs import build_chain_ref_order

def _by(**nodes):
    return nodes

def test_downstream_includes_seed_and_turnaround():
    by_key = {
        "white_bg": {"key": "white_bg", "role": "seed", "chain": "product", "node_id": "n-seed"},
        "product_turnaround": {
            "key": "product_turnaround",
            "role": "turnaround",
            "chain": "product",
            "node_id": "n-ta",
            "depends_on": ["white_bg"],
        },
        "hero_main": {
            "key": "hero_main",
            "role": "downstream",
            "chain": "product",
            "node_id": "n-hero",
            "depends_on": ["product_turnaround", "white_bg"],
        },
    }
    order = build_chain_ref_order(
        item=by_key["hero_main"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order == ["n-plan", "n-seed", "n-ta"]


def test_video_lifestyle_appends_cross_chain_deps():
    by_key = {
        "white_bg": {"key": "white_bg", "role": "seed", "chain": "product", "node_id": "n-w"},
        "product_turnaround": {
            "key": "product_turnaround",
            "role": "turnaround",
            "chain": "product",
            "node_id": "n-pta",
        },
        "scene": {"key": "scene", "role": "downstream", "chain": "product", "node_id": "n-sc"},
        "model_portrait": {
            "key": "model_portrait",
            "role": "seed",
            "chain": "model",
            "node_id": "n-mp",
        },
        "model_turnaround": {
            "key": "model_turnaround",
            "role": "turnaround",
            "chain": "model",
            "node_id": "n-mta",
        },
        "model_lifestyle": {
            "key": "model_lifestyle",
            "role": "downstream",
            "chain": "model",
            "node_id": "n-ml",
        },
        "video_lifestyle": {
            "key": "video_lifestyle",
            "role": "downstream",
            "chain": "model",
            "node_id": "n-vl",
            "depends_on": ["model_lifestyle", "product_turnaround", "scene"],
        },
    }
    order = build_chain_ref_order(
        item=by_key["video_lifestyle"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order[0] == "n-plan"
    assert order[1:3] == ["n-mp", "n-mta"]  # model seed + turnaround
    # remaining depends not yet listed
    assert "n-ml" in order and "n-pta" in order and "n-sc" in order
    assert "copy" not in "".join(order)


def test_no_chain_uses_depends_on():
    by_key = {
        "copy_main": {"key": "copy_main", "node_id": "n-copy", "depends_on": []},
    }
    order = build_chain_ref_order(
        item=by_key["copy_main"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order == ["n-plan"]
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `cd services/agent-runtime && ../../../../services/agent-runtime/.venv/bin/pytest tests/test_chain_refs.py -v`  
(or worktree venv if present)  
Expected: import / missing function failures

- [ ] **Step 4: Implement `chain_refs.py`**

```python
from __future__ import annotations
from typing import Any


def _nid(item: dict[str, Any] | None) -> str | None:
    if not item:
        return None
    n = item.get("node_id")
    return str(n) if n else None


def _find_role(by_key: dict[str, dict], chain: str, role: str) -> dict | None:
    for it in by_key.values():
        if str(it.get("chain") or "") == chain and str(it.get("role") or "") == role:
            return it
    return None


def build_chain_ref_order(
    *,
    item: dict[str, Any],
    by_key: dict[str, dict[str, Any]],
    plan_node_id: str | None,
) -> list[str]:
    out: list[str] = []
    if plan_node_id:
        out.append(str(plan_node_id))

    chain = item.get("chain")
    role = item.get("role")
    if chain in ("product", "model") and role in ("seed", "turnaround", "downstream"):
        seed = _find_role(by_key, str(chain), "seed")
        turn = _find_role(by_key, str(chain), "turnaround")
        if role == "seed":
            pass
        elif role == "turnaround":
            n = _nid(seed)
            if n and n not in out:
                out.append(n)
        else:  # downstream
            for peer in (seed, turn):
                n = _nid(peer)
                if n and n not in out:
                    out.append(n)
            for dep_key in item.get("depends_on") or []:
                dep = by_key.get(str(dep_key))
                n = _nid(dep)
                if n and n not in out:
                    out.append(n)
        return out

    for dep_key in item.get("depends_on") or []:
        dep = by_key.get(str(dep_key))
        n = _nid(dep)
        if n and n not in out:
            out.append(n)
    return out
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pytest tests/test_chain_refs.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/agent-runtime/app/graph/state.py \
  services/agent-runtime/app/graph/chain_refs.py \
  services/agent-runtime/tests/test_chain_refs.py
git commit -m "feat(agent-runtime): chain_refs helper and SplitManifestItem chain/role"
```

---

### Task 2: Rewrite canvas-manifest + Skill metadata

**Files:**
- Modify: `services/agent-runtime/skills/enterprise-marketing-campaign/assets/canvas-manifest.yaml`
- Modify: `services/agent-runtime/skills/enterprise-marketing-campaign/SKILL.md`
- Create: `services/agent-runtime/tests/test_manifest_consistency.py`

**Interfaces:**
- Consumes: spec §1 tables (exact keys/deps)
- Produces: YAML loadable by existing `load_skill` / `canvas_manifest`

- [ ] **Step 1: Write failing consistency tests**

```python
# tests/test_manifest_consistency.py
from pathlib import Path
from app.skills.loader import discover_skills, load_skill

SKILLS = Path(__file__).resolve().parents[1] / "skills"

def _items():
    skill = load_skill({e.skill_id: e for e in discover_skills(SKILLS)}["enterprise-marketing-campaign"])
    return skill.canvas_manifest["items"]

def test_no_legacy_model_or_show_video():
    keys = {i["key"] for i in _items()}
    assert "model" not in keys
    assert "show_video" not in keys
    assert {"video_product", "video_scene", "video_lifestyle"} <= keys
    assert {"model_portrait", "model_turnaround", "model_lifestyle"} <= keys
    assert "product_turnaround" in keys

def test_copy_not_in_video_deps():
    for it in _items():
        if it["key"].startswith("video_"):
            assert "copy_main" not in (it.get("depends_on") or [])

def test_turnaround_prompts_mention_four_panels():
    by = {i["key"]: i for i in _items()}
    for k in ("product_turnaround", "model_turnaround"):
        hint = by[k]["prompt_hint_template"]
        assert "特写" in hint and "正" in hint and "侧" in hint and "背" in hint

def test_video_prompts_mention_voiceover_or_subtitle():
    for it in _items():
        if it["key"].startswith("video_"):
            h = it["prompt_hint_template"]
            assert "旁白" in h or "字幕" in h
```

- [ ] **Step 2: Run — expect FAIL** (legacy keys / missing keys)

- [ ] **Step 3: Replace `canvas-manifest.yaml` items**

Use this structure (fill full `prompt_hint_template` strings; product/model turnaround must include 四格：最左近景特写+正侧背；videos include 旁白要点 + 底部中文字幕风格):

```yaml
schema_version: 1
defaults:
  auto_generate_image: true
  auto_generate_video: true
  topology_mode_default: full
items:
  - key: copy_main
    title: 主文案
    target_type: text
    auto_generate: false
    depends_on: []
    # no chain/role

  - key: white_bg
    title: 白底图
    target_type: image
    chain: product
    role: seed
    gen_mode: t2i
    auto_generate: true
    depends_on: []

  - key: product_turnaround
    title: 产品四视图
    target_type: image
    chain: product
    role: turnaround
    gen_mode: i2i
    auto_generate: true
    depends_on: [white_bg]

  - key: hero_main
    title: 主图
    target_type: image
    chain: product
    role: downstream
    gen_mode: i2i
    auto_generate: true
    depends_on: [product_turnaround, white_bg]

  - key: detail_cut
    title: 细节/剖面
    target_type: image
    chain: product
    role: downstream
    gen_mode: i2i
    auto_generate: true
    depends_on: [product_turnaround, white_bg]

  - key: scene
    title: 场景图
    target_type: image
    chain: product
    role: downstream
    gen_mode: i2i
    auto_generate: true
    depends_on: [product_turnaround]

  - key: banner
    title: Banner
    target_type: image
    chain: product
    role: downstream
    gen_mode: i2i
    auto_generate: true
    depends_on: [product_turnaround]

  - key: brand
    title: 品牌图
    target_type: image
    chain: product
    role: downstream
    gen_mode: i2i
    auto_generate: true
    depends_on: [product_turnaround]

  - key: model_portrait
    title: 模特定妆
    target_type: image
    chain: model
    role: seed
    gen_mode: t2i
    auto_generate: true
    depends_on: []

  - key: model_turnaround
    title: 模特四视图
    target_type: image
    chain: model
    role: turnaround
    gen_mode: i2i
    auto_generate: true
    depends_on: [model_portrait]

  - key: model_lifestyle
    title: 人景
    target_type: image
    chain: model
    role: downstream
    gen_mode: i2i
    auto_generate: true
    depends_on: [model_turnaround, model_portrait]

  - key: video_product
    title: 产品展示视频
    target_type: video
    chain: product
    role: downstream
    gen_mode: v_ref
    auto_generate: true
    depends_on: [product_turnaround, white_bg]

  - key: video_scene
    title: 场景氛围视频
    target_type: video
    chain: product
    role: downstream
    gen_mode: v_ref
    auto_generate: true
    depends_on: [scene, product_turnaround]

  - key: video_lifestyle
    title: 人景生活方式视频
    target_type: video
    chain: model
    role: downstream
    gen_mode: v_ref
    auto_generate: true
    depends_on: [model_lifestyle, product_turnaround, scene]
```

Keep `source_section` fields consistent with existing style where useful.

- [ ] **Step 4: Bump Skill metadata**

In `SKILL.md` frontmatter: `lnkpi.max_downstream: "16"`.  
Update Split instructions to mention 产品/模特一致性链与三视频；旁白/字幕仅 prompt。

- [ ] **Step 5: Run consistency tests — PASS**

- [ ] **Step 6: Commit**

```bash
git add services/agent-runtime/skills/enterprise-marketing-campaign/ \
  services/agent-runtime/tests/test_manifest_consistency.py
git commit -m "feat(skill): product/model chains and three video nodes in manifest"
```

---

### Task 3: split.py loads chain/role and uses chain_refs

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/split.py` (`_manifest_items` + attach_refs loop)
- Modify: `services/agent-runtime/tests/test_graph_plan_split.py` (assert new keys present after confirm; no `model`/`show_video`)

**Interfaces:**
- Consumes: `build_chain_ref_order`
- Produces: `split_manifest` items with `chain`/`role` and correct initial refs

- [ ] **Step 1: Update `_manifest_items` to copy chain/role**

When building each `SplitManifestItem`, set:

```python
chain=raw.get("chain") if raw.get("chain") in ("product", "model") else None,
role=raw.get("role") if raw.get("role") in ("seed", "turnaround", "downstream") else None,
```

- [ ] **Step 2: Replace attach_refs loop**

```python
from app.graph.chain_refs import build_chain_ref_order

by_key = {str(i["key"]): dict(i) for i in manifest if i.get("key")}
for item in manifest:
    nid = item.get("node_id")
    if not nid:
        continue
    hint = item.get("prompt_hint") or ""
    if hint:
        await nest.set_node_prompt(nid, hint)
    ref_order = build_chain_ref_order(
        item=dict(item), by_key=by_key, plan_node_id=plan_node_id
    )
    await nest.attach_refs(nid, ref_order)
```

- [ ] **Step 3: Adjust integration test assertions**

In `test_confirm_then_split_creates_image_skeletons` (or add sibling test): after confirm, `keys` must include `product_turnaround`, `model_portrait`, `video_product`; must not include `model` or `show_video`.

- [ ] **Step 4: Pytest plan_split + manifest — PASS**

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/split.py \
  services/agent-runtime/tests/test_graph_plan_split.py
git commit -m "feat(agent-runtime): split passes chain metadata and chain-aware refs"
```

---

### Task 4: orchestrate_gen re-attaches refs before run

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/orchestrate_gen.py`
- Modify: `services/agent-runtime/tests/test_orchestrate_gen.py`

**Interfaces:**
- Consumes: `build_chain_ref_order`, nest.`attach_refs`
- Produces: before each successful scheduling of `run_one`, refs refreshed

- [ ] **Step 1: Extend FakeNest in tests with `attach_refs` recording**

```python
async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
    self.ref_calls.append((node_id, list(ref_order)))
    return {"nodeId": node_id, "actions": []}
```

Add test: hero after white_bg+turnaround complete → last `attach_refs` for hero includes seed+turnaround node ids in order; video_lifestyle includes model seed/turnaround + product_turnaround + scene.

- [ ] **Step 2: Run new test — FAIL** (no attach_refs in orchestrate)

- [ ] **Step 3: In `run_one`, before `run_image_generation` / `run_video_generation`**

Build `by_key` from manifest once in outer scope (already exists). Resolve `plan_node_id` from state if available (`state.get("plan_node_id")`); thread into `make_orchestrate_gen_node` closure via state read inside node:

```python
plan_node_id = state.get("plan_node_id")
# inside run_one, before run_*:
ref_order = build_chain_ref_order(
    item=dict(item), by_key=by_key, plan_node_id=plan_node_id
)
attach = getattr(nest, "attach_refs", None)
if attach is not None and ref_order:
    await attach(str(node_id), ref_order)
```

- [ ] **Step 4: Pytest orchestrate — PASS** (including dependency_failed unchanged)

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/orchestrate_gen.py \
  services/agent-runtime/tests/test_orchestrate_gen.py
git commit -m "feat(agent-runtime): refresh chain refs before each image/video gen"
```

---

### Task 5: trimmed defaults + topo_trim fixtures

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/split.py` (`_select_trimmed_keys`)
- Modify: `services/agent-runtime/tests/test_topo_trim.py`

**Interfaces:**
- Produces: trimmed selection prefers `copy_main`, `white_bg`, `product_turnaround`, `hero_main` (± optional `video_product`); may omit full model chain

- [ ] **Step 1: Update `_select_trimmed_keys`**

```python
must = [
    k
    for k in (
        "copy_main",
        "white_bg",
        "product_turnaround",
        "hero_main",
        "detail_cut",
        "video_product",
    )
    if k in keys
]
```

Do **not** auto-include entire model chain in trimmed unless already selected.

- [ ] **Step 2: Update `test_topo_trim.py` fixtures** — replace `show_video` with `video_product` depends_on `[product_turnaround, white_bg]`; assert closure pulls turnaround+white_bg.

- [ ] **Step 3: Pytest topo_trim + split trimmed path if any — PASS**

- [ ] **Step 4: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/split.py \
  services/agent-runtime/tests/test_topo_trim.py
git commit -m "feat(agent-runtime): trimmed defaults keep product turnaround core path"
```

---

### Task 6: Full suite verification + PR

**Files:** none required unless failures

- [ ] **Step 1: Run full agent-runtime pytest**

```bash
cd services/agent-runtime
# use repo .venv
pytest tests/ -q
```

Expected: all pass

- [ ] **Step 2: Manual checklist in PR body**

- [ ] full：确认方案 → 骨架含双链+三视频 Mermaid → 确认出图  
- [ ] 下游 gen 前 attach_refs 含 seed+turnaround  
- [ ] seed 失败 → 下游 dependency_failed  
- [ ] trimmed：至少 white_bg→product_turnaround→hero_main  
- [ ] 视频 prompt 含旁白/字幕；无 audio 节点  

- [ ] **Step 3: Push + `gh pr create`** against main  
Title: `feat(agent): consistency chains (product/model) + three videos`  
Link spec path in Summary.

- [ ] **Step 4: Commit only if doc nits** — otherwise stop after PR

---

## Spec coverage self-check

| Spec requirement | Task |
| --- | --- |
| Dual chain keys + 4-panel prompts | Task 2 |
| Three videos; no show_video; copy not in video deps | Task 2 |
| chain/role on state + helper | Task 1 |
| split load + initial refs | Task 3 |
| orchestrate refresh refs | Task 4 |
| trimmed + closure | Task 5 |
| Prompt-only audio/subtitle; no TTS | Task 2 prompts + Global Constraints |
| A await_topo unchanged | no graph builder changes |

## Placeholder scan

None intentional — implementers must write full Chinese prompt strings in Task 2 YAML (not left as comments only).

---

## Execution handoff

After this plan is approved for coding:

1. Worktree already on `feature/agent-consistency-chains` (or recreate from main + cherry-pick docs commits)
2. Use subagent-driven-development or executing-plans
3. Deploy with `enable_agent_runtime=true` after merge

**Stop for human gate:** reply「开始实现」to execute Tasks 1–6.
