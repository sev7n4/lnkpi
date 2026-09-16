# Bare-gen propose bind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the gold utterance「帮我生成一张蓝色天空产品主图」, explore binds `upsert_media_node` + `propose_generation` so production can reach `pending_confirm` without `run_*`.

**Architecture:** Keep planner/import exclusive narrow-write sets. Add `utterance_binds_media_propose` and a fourth branch in `select_narrow_write_tools` that returns a 4-tool media set. Do not change `_bind_plan_tools` filtering logic. New V2 smoke script; do not edit H8.

**Tech Stack:** Python agent-runtime; pytest; existing Nest canvas tools.

**Spec:** [docs/superpowers/specs/2026-09-16-agent-bare-gen-propose-bind-design.md](../specs/2026-09-16-agent-bare-gen-propose-bind-design.md)

## Global Constraints

- Gold utterance (verbatim): `帮我生成一张蓝色天空产品主图`
- Media narrow set (exactly these 4): `upsert_media_node`, `propose_generation`, `set_node_prompt`, `attach_refs`
- Gate must **not** use `utterance_suggests_media_create`
- Exclude regen via `regen_intent` **or** `regenerate_phrase_intent` (「重新生成一张」contains「生成一张」)
- Exclude campaign via public `CAMPAIGN_OVERRIDE_PHRASES` (do not import `_is_campaign_override`)
- Planner/import branches in `select_narrow_write_tools` unchanged
- Do **not** modify `deploy/prod-phase-2d3-h8-verify.py`
- No `run_*` in `build_tool_plan().visible_names`; no mandatory explore dispatch for gen
- No 2d.4 shim delete; no Phase 3; no same-session regen propose; no real billed generation
- Branch: `feature/agent-bare-gen-propose-bind` from latest `main`

---

## File map

| File | Responsibility |
|------|----------------|
| Spec + this plan | Authorize bind gap + P1–P7 |
| `app/graph/explore_dispatch.py` | `utterance_binds_media_propose`; media branch in `select_narrow_write_tools` |
| `app/graph/nodes/explore.py` | One extra system-prompt sentence (CORE already bound on gen utterances) |
| `tests/test_explore_narrow_bind.py` | P1–P5 + campaign/regen negatives; fix stale module docstring |
| `tests/test_chat_system_prompt.py` | Prompt sentence present |
| `tests/test_phase_2b_propose_tools.py` | P6 regression (run, no logic change expected) |
| `deploy/prod-phase-v2-bare-gen-verify.py` | P7 production smoke |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-agent-bare-gen-propose-bind-design.md` (header plan link only; already done if this plan is committed with it)

- [ ] **Step 1:** Confirm spec header `实现 plan` links to this file and campaign exclusion uses `CAMPAIGN_OVERRIDE_PHRASES`.

- [ ] **Step 2: Commit** (only if spec still says 待写)

```bash
git add docs/superpowers/specs/2026-09-16-agent-bare-gen-propose-bind-design.md \
  docs/superpowers/plans/2026-09-16-agent-bare-gen-propose-bind.md
git commit -m "$(cat <<'EOF'
docs(agent): plan bare-gen propose bind for explore narrow writes

EOF
)"
```

If both files are already in the same commit as this plan, skip a second docs-only commit.

---

### Task 1: Failing tests P1–P5

**Files:**
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`

**Interfaces:**
- Consumes: `select_narrow_write_tools`, `_bind_plan_tools` (existing)
- Produces: RED gates for media set / negatives; GOLD and MEDIA_WRITE constants later tasks must reuse verbatim

- [ ] **Step 1: Write RED tests** (append; keep all existing planner/import tests)

Replace the module docstring:

```python
"""Explore write-tool narrow bind: planner/import exclusive sets + media-propose set."""
```

Add after the existing `_IMPORT_ONLY` constant:

```python
GOLD_BARE_GEN = "帮我生成一张蓝色天空产品主图"
MEDIA_WRITE = frozenset({
    "upsert_media_node",
    "propose_generation",
    "set_node_prompt",
    "attach_refs",
})
```

Append:

```python
def test_p1_gold_sentence_binds_media_narrow_set():
    tools = select_narrow_write_tools(GOLD_BARE_GEN)
    assert tools == MEDIA_WRITE
    assert len(tools) <= 5


def test_p2_poster_look_does_not_bind_propose():
    tools = select_narrow_write_tools("看看这张海报")
    assert "upsert_media_node" not in tools
    assert "propose_generation" not in tools
    assert tools != MEDIA_WRITE


def test_p3_regen_phrase_does_not_bind_propose():
    tools = select_narrow_write_tools("重新生成一张")
    assert "upsert_media_node" not in tools
    assert "propose_generation" not in tools


def test_campaign_override_does_not_bind_media_set():
    tools = select_narrow_write_tools(GOLD_BARE_GEN + "，做个营销方案")
    assert tools != MEDIA_WRITE
    assert "propose_generation" not in tools


def test_p5_bind_plan_tools_gold_includes_media_writes():
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
    _bind_plan_tools(FakeLlm(), tools_by_name, [], GOLD_BARE_GEN)
    bound = set(captured[0])
    assert "upsert_media_node" in bound
    assert "propose_generation" in bound
    assert "set_node_prompt" in bound
    assert "attach_refs" in bound
```

Also add (same file) a direct predicate test that will fail until Task 2:

```python
def test_utterance_binds_media_propose_gate():
    from app.graph.explore_dispatch import utterance_binds_media_propose

    assert utterance_binds_media_propose(GOLD_BARE_GEN) is True
    assert utterance_binds_media_propose("看看这张海报") is False
    assert utterance_binds_media_propose("重新生成一张") is False
    assert utterance_binds_media_propose(GOLD_BARE_GEN + "，做个营销方案") is False
```

- [ ] **Step 2:** Run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_narrow_bind.py -v
```

Expected: new tests FAIL (`ImportError` for `utterance_binds_media_propose` and/or `tools != MEDIA_WRITE` on gold). Existing planner/import tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add services/agent-runtime/tests/test_explore_narrow_bind.py
git commit -m "$(cat <<'EOF'
test(agent): add bare-gen media narrow-bind failing gates

EOF
)"
```

---

### Task 2: Predicate + media branch (GREEN P1–P5)

**Files:**
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py`

**Interfaces:**
- Produces: `utterance_binds_media_propose(text: str) -> bool`
- Produces: `select_narrow_write_tools` returns `MEDIA_WRITE` for gold; planner/import unchanged

- [ ] **Step 1: Add constant + predicate** (near `_DEFAULT_NARROW_WRITE`)

```python
_MEDIA_PROPOSE_WRITE = frozenset({
    "upsert_media_node",
    "propose_generation",
    "set_node_prompt",
    "attach_refs",
})


def utterance_binds_media_propose(text: str) -> bool:
    """True when explore should bind upsert_media_node + propose_generation."""
    from app.graph.atomic_intent import (
        CAMPAIGN_OVERRIDE_PHRASES,
        MEDIA_CREATE_HINTS,
        regen_intent,
        regenerate_phrase_intent,
    )
    from app.graph.media_utterance import (
        normalize_colloquial_create_verbs,
        strong_generate_media,
    )

    t = text or ""
    if not t.strip():
        return False
    if regen_intent(t) or regenerate_phrase_intent(t):
        return False
    if any(p in t for p in CAMPAIGN_OVERRIDE_PHRASES):
        return False
    if any(h in t for h in MEDIA_CREATE_HINTS):
        return True
    return strong_generate_media(normalize_colloquial_create_verbs(t))
```

- [ ] **Step 2: Insert media branch** as the last exclusive check before `return _DEFAULT_NARROW_WRITE` inside `select_narrow_write_tools`. Do not reorder import/planner checks. Final function:

```python
def select_narrow_write_tools(utterance: str) -> frozenset[str]:
    """Keyword bind for workflow import vs recipe planner vs media propose (≤5 write tools).

    Strong import anchors win so planner keywords never steal
    ``请用 import_workflow 导入`` / ``导入工作流``.
    Media propose is after planner/import so those sets stay exclusive.
    """
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
    if utterance_binds_media_propose(text):
        return _MEDIA_PROPOSE_WRITE
    return _DEFAULT_NARROW_WRITE
```

Do **not** edit `_bind_plan_tools`.

- [ ] **Step 3:** Re-run

```bash
cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest \
  tests/test_explore_narrow_bind.py tests/test_phase_2b_propose_tools.py -v
```

Expected: all PASS (P1–P5 + P4 planner/import + P6 B1 visible_names still has propose/upsert and no `run_*`).

- [ ] **Step 4: Commit**

```bash
git add services/agent-runtime/app/graph/explore_dispatch.py
git commit -m "$(cat <<'EOF'
feat(agent): bind upsert+propose on bare-gen explore utterances

EOF
)"
```

---

### Task 3: System prompt one-liner

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py` (`_EXPLORE_SYSTEM` rule 6)
- Modify: `services/agent-runtime/tests/test_chat_system_prompt.py`

**Interfaces:**
- Consumes: `_EXPLORE_SYSTEM` re-exported as `chat._SYSTEM`
- Produces: prompt states CORE media tools are already bound on gen utterances; do not `tool_search` for them

- [ ] **Step 1: Failing assertion**

```python
def test_chat_system_says_not_to_search_core_media_tools():
    assert "tool_search" in _SYSTEM
    assert "upsert_media_node" in _SYSTEM
    assert "propose_generation" in _SYSTEM
    assert "不要用 tool_search" in _SYSTEM or "勿用 tool_search" in _SYSTEM
```

- [ ] **Step 2:** `PYTHONPATH=. python3.11 -m pytest tests/test_chat_system_prompt.py::test_chat_system_says_not_to_search_core_media_tools -v` → FAIL

- [ ] **Step 3:** After rule 6 in `_EXPLORE_SYSTEM`, append (same string concat, keep rule numbering):

Current rule 6:

```
"6. 若需要当前未绑定的能力，先调用 tool_search 加载 deferred 工具。\n"
```

Change to:

```
"6. 若需要当前未绑定的能力，先调用 tool_search 加载 deferred 工具。"
"upsert_media_node / propose_generation 在「生成一张」类口语下应已绑定，不要用 tool_search 找 CORE。\n"
```

- [ ] **Step 4:** Re-run `tests/test_chat_system_prompt.py -v` → PASS; re-run `tests/test_explore_narrow_bind.py -q` → PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py \
  services/agent-runtime/tests/test_chat_system_prompt.py
git commit -m "$(cat <<'EOF'
fix(agent): tell explore not to tool_search for CORE media writes

EOF
)"
```

---

### Task 4: V2 production smoke script (P7 fixture)

**Files:**
- Create: `deploy/prod-phase-v2-bare-gen-verify.py`

Do **not** edit `deploy/prod-phase-2d3-h8-verify.py`.

Copy SSE/login helpers from H8 (`sse_chat`, `http`, `load_canvas`, `pending_ids`) but tighten assertions. Full script:

```python
#!/usr/bin/env python3
"""Production V2/B9 verify — bare gen must upsert + propose + pending_confirm.

Does not replace deploy/prod-phase-2d3-h8-verify.py (2d.3 no-charge regression).

Usage:
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3.11 deploy/prod-phase-v2-bare-gen-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT = float(os.environ.get("V2_SSE_TIMEOUT", "180"))
GOLD = "帮我生成一张蓝色天空产品主图"

PASS = FAIL = 0


def record(case: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        icon = "✅"
    else:
        FAIL += 1
        icon = "❌"
    line = f"{icon} {case}"
    if detail:
        line += f" — {detail[:300]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(
        f"{API}{p}",
        data=None if b is None else json.dumps(b).encode(),
        headers=h,
        method=m,
    )
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read() or b"{}")


def sse_chat(tok: str, sid: str, msg: str, tid: str, *, model: str | None = None, timeout: float = 180) -> dict[str, Any]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if model:
        body["model"] = model
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"v2_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    steps: list[str] = []
    tool_names: list[str] = []
    routes: list[dict] = []
    canvas_actions: list[dict] = []
    parts: list[str] = []
    saw_done = False
    end = time.time() + timeout
    with urlopen(r, timeout=timeout + 30) as resp:
        buf = ""
        try:
            while time.time() < end:
                try:
                    chunk = resp.read(4096)
                except IncompleteRead as exc:
                    if exc.partial:
                        buf += exc.partial.decode(errors="replace")
                    if saw_done:
                        break
                    time.sleep(0.2)
                    continue
                if not chunk:
                    if saw_done:
                        break
                    time.sleep(0.2)
                    continue
                buf += chunk.decode(errors="replace")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    for line in block.splitlines():
                        if not line.startswith("data:"):
                            continue
                        pl = line[5:].strip()
                        if pl == "[DONE]":
                            saw_done = True
                            break
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        events.append(ev)
                        et = str(ev.get("type") or "")
                        types.add(et)
                        data = ev.get("data") or {}
                        if et == "text_delta":
                            parts.append(str(data.get("text") or ""))
                        if et == "text_replace":
                            parts = [str(data.get("text") or "")]
                        if et == "step":
                            node_id = str((data.get("id") if isinstance(data, dict) else "") or "")
                            steps.append(node_id.replace("node:", ""))
                        if et == "tool_call":
                            name = str(
                                data.get("name") or data.get("tool") or data.get("toolName") or ""
                            )
                            if name:
                                tool_names.append(name)
                        if et == "route_decision":
                            rd = data.get("route_decision") if isinstance(data, dict) else None
                            if isinstance(rd, dict):
                                routes.append(rd)
                            elif isinstance(data, dict):
                                routes.append(data)
                        if et == "canvas_action" and isinstance(data, dict):
                            canvas_actions.append(data)
                        if et in ("done", "error"):
                            if et == "error":
                                parts.append(f"[ERROR: {data}]")
                            saw_done = True
                            break
                    if saw_done:
                        break
                if saw_done:
                    break
        except IncompleteRead:
            pass
    text = parts[-1] if len(parts) == 1 and parts[0] else "".join(parts)
    flow = routes[-1].get("flow_mode") if routes else None
    pending = False
    billed = False
    for a in canvas_actions:
        payload = a.get("payload") or a.get("data") or a
        if not isinstance(payload, dict):
            continue
        inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        st = str(inner.get("status") or payload.get("status") or "")
        if st == "pending_confirm":
            pending = True
        if st in ("completed", "running", "generating", "success"):
            billed = True
    return {
        "text": text,
        "steps": steps,
        "tools": tool_names,
        "flow_mode": flow,
        "pending_via_actions": pending,
        "billed_via_actions": billed,
        "no_run_tools": "run_image_generation" not in tool_names
        and "run_video_generation" not in tool_names,
        "saw_done": saw_done,
    }


def load_canvas(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)
    data = sess.get("data") or sess
    raw = data.get("canvasData") or data.get("canvas") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def pending_ids(canvas: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for n in canvas.get("nodes") or []:
        st = str((n.get("data") or {}).get("status") or "")
        if st == "pending_confirm":
            out.append(str(n.get("id")))
    return out


def main() -> int:
    print("=== V2 bare-gen propose production verify ===")
    print(f"BASE={BASE}\n")
    health = http("GET", "/health")
    record("Nest health", bool(health.get("ok")), str(health)[:120])
    rt = http("GET", "/agent/runtime-health")
    record("Runtime health", bool((rt.get("data") or {}).get("ok")), str((rt.get("data") or {}).get("latencyMs")))
    login = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})
    tok = (login.get("data") or {}).get("token")
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    model = os.environ.get("HARNESS_MODEL", "").strip() or None
    if not model:
        boot = http("GET", "/provider/bootstrap", t=tok)
        model = ((boot.get("data") or {}).get("preferences") or {}).get("defaultTextModel") or None
    record("Agent model", bool(model), str(model))
    canvas = http("POST", "/agent/canvas/create", {"title": f"v2-bare-{uuid.uuid4().hex[:6]}"}, tok)
    sid = (canvas.get("data") or {}).get("id") or (canvas.get("data") or {}).get("sessionId")
    record("Canvas session", bool(sid), str(sid))
    if not sid:
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    try:
        r = sse_chat(tok, str(sid), GOLD, f"t_v2_{uuid.uuid4().hex[:8]}", model=model, timeout=SSE_TIMEOUT)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("P7 gold turn completes", False, str(exc))
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    record("P7 flow_mode=canvas_agent", r["flow_mode"] == "canvas_agent", f"flow={r['flow_mode']}")
    record(
        "P7 tool_call upsert then propose",
        "upsert_media_node" in r["tools"]
        and "propose_generation" in r["tools"]
        and r["tools"].index("upsert_media_node") < r["tools"].index("propose_generation"),
        f"tools={r['tools'][:12]}",
    )
    time.sleep(1.0)
    pids = pending_ids(load_canvas(tok, str(sid)))
    record(
        "P7 pending_confirm on canvas",
        bool(pids) or r["pending_via_actions"],
        f"pendingIds={pids[:3]} via_actions={r['pending_via_actions']}",
    )
    record("P7 no run_* tools", r["no_run_tools"], f"tools={r['tools'][:8]}")
    record("P7 no billed complete before confirm", not r["billed_via_actions"], f"billed={r['billed_via_actions']}")
    print(f"\nPASS={PASS} FAIL={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        raise SystemExit(2)
```

- [ ] **Step 2: Commit** (script only; do not run against prod until Task 5 deploy)

```bash
git add deploy/prod-phase-v2-bare-gen-verify.py
git commit -m "$(cat <<'EOF'
test(deploy): add V2 bare-gen propose pending_confirm smoke

EOF
)"
```

---

### Task 5: PR + P7 after deploy

**Files:** none beyond push

- [ ] **Step 1:** `cd services/agent-runtime && PYTHONPATH=. python3.11 -m pytest tests/test_explore_narrow_bind.py tests/test_chat_system_prompt.py tests/test_phase_2b_propose_tools.py -q` → exit 0

- [ ] **Step 2:** Push + PR (mydev: squash merge after CI green)

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(agent): bind upsert+propose on bare-gen utterances" --body "$(cat <<'EOF'
## Summary
- Explore media narrow-write set for gold「帮我生成一张蓝色天空产品主图」
- Do not widen default chat bind; planner/import exclusive sets unchanged
- New V2 smoke (does not change 2d.3 H8)

## Test plan
- [ ] `pytest tests/test_explore_narrow_bind.py tests/test_chat_system_prompt.py tests/test_phase_2b_propose_tools.py`
- [ ] After Agent Runtime deploy: `python3.11 deploy/prod-phase-v2-bare-gen-verify.py`

EOF
)"
```

- [ ] **Step 3:** CI green → `gh pr merge <n> --squash --delete-branch`

- [ ] **Step 4:** Watch Agent Runtime deploy success, then:

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  python3.11 deploy/prod-phase-v2-bare-gen-verify.py
```

Expected: PASS with pending_confirm. If bind unit tests were green but this fails on missing `tool_call`, **stop** — that is spec §5 prompt/model follow-up, not a silent H8-style soft pass.

---

## Done when

- [ ] P1–P6 CI green
- [ ] P7 prod PASS (pending_confirm, no `run_*`)
- [ ] H8 file untouched
- [ ] 2d.4 / Phase 3 **not** started

## Spec coverage

| Spec | Task |
|------|------|
| BG-D1–D3 / P1–P5 | Task 1–2 |
| BG-D2 prompt assist | Task 3 |
| BG-D5 / P7 fixture | Task 4 |
| BG-D4 / P7 prod | Task 5 |
| P6 | Task 2 pytest `test_phase_2b_propose_tools.py` |
| P4 | Task 1–2 existing tests |
| BG-D6 no mandatory | Global; Task 5 stop rule |
