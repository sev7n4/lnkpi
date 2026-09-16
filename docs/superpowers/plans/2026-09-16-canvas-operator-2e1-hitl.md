# Canvas Operator 2e.1 HITL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production V4: after the V2 gold utterance reaches `pending_confirm`, a real click on the sidebar confirm chip starts studio generate (one small image credit); a separate cancel session returns the node to `draft` with no studio call.

**Architecture:** Verify-first. 2c already wires `[data-testid=generation-propose-confirm]` → `confirmProposeGeneration` → `emit('generateNode')` → `CanvasPage.handleAgentGenerateNode` → `generateForNode` → `studioApi.generateImage`. This slice does **not** change explore bind. If prod confirm already starts generate, the PR is the unit lock + V4 smoke script. If click leaves the node without a studio start, fix `generateForNode` / `isModelSelectable` with TDD and re-run the browser gate.

**Tech Stack:** Vue 3 + vitest (`@lnkpi/web`); Nest Jwt `POST /agent/clear-propose`; existing V2 Python harness; production BASE `http://119.29.173.89:8888`.

**Spec:** [docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md](../specs/2026-09-16-canvas-operator-2e-design.md) §2.1 / E1–E5 / 2E-D4 / 2E-D8.

## Global Constraints

- Gold utterance (verbatim): `帮我生成一张蓝色天空产品主图`
- Production E2 **only** path: browser click `[data-testid=generation-propose-confirm]` (label `确认生成`). Click with no studio start = fail
- `generateForNode` spy is allowed **only** in unit tests; never as production E2 green
- `POST /studio/image/generate` from a script is diagnostic only (E5); must not green E2
- Cancel: `POST /agent/clear-propose` or `[data-testid=generation-propose-cancel]`; node `draft`; no studio; no charge
- **Zero** runtime bind change: do not edit `explore_dispatch.py`, `explore.py`, `definitions.py`, or any `select_narrow_write_tools` path
- Do **not** modify `deploy/prod-phase-v2-bare-gen-verify.py` or `deploy/prod-phase-2d3-h8-verify.py`
- No new `POST /agent/confirm-propose`; no `run_*`; no silent billed generate; no 2e.2 / 2e.3 work
- Do not add 穿上/换装 to `MEDIA_CREATE_HINTS`; do not start 2e.2 until this plan's prod hard table is green
- Allow **one** small image credit on the confirm session (default 16:9 / 1K)
- Prod login: `PHONE=17279698608` `CODE=123456` `BASE_URL=http://119.29.173.89:8888`
- Canvas URL: `{BASE}/workflow/{sessionId}`
- Branch: `feature/canvas-operator-2e` (already isolated worktree)

---

## File map

| File | Responsibility |
|------|----------------|
| Spec + this plan | Authorize E1–E5; 2e.2/2e.3 stay out |
| `apps/web/src/composables/useNodeGeneration.test.ts` | Lock: `pending_confirm` image with gold prompt and **no** `imageModel` still calls `studioApi.generateImage` |
| `apps/web/src/composables/useNodeGeneration.ts` | Only if Task 4 fails: stop silent return / default-model block |
| `apps/web/src/pages/CanvasPage.vue` | Only if Task 4 fails: `handleAgentGenerateNode` / `isModelSelectable` |
| `deploy/prod-phase-2e1-hitl-verify.py` | E1 setup printout, E4 cancel, post-click `assert-started` |
| Do **not** touch | `explore_dispatch.py`, V2/H8 scripts, `agentChipSet.ts` (C2 already locks no `sendPreset`) |

---

### Task 0: Point spec at this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md` (header already links here after patch 2)
- Create: this plan file

**Interfaces:**
- Consumes: spec 2E-D1, 2E-D4, 2E-D8, E1–E5
- Produces: implementer runs this file only

- [ ] **Step 1:** Confirm spec header `状态` is **已批准**（审阅补丁 2）and `实现 plan` links to `../plans/2026-09-16-canvas-operator-2e1-hitl.md`.

- [ ] **Step 2: Commit** (docs only; skip files already in HEAD if this commit is docs-only together with the spec patch)

```bash
git add docs/superpowers/specs/2026-09-16-canvas-operator-2e-design.md \
  docs/superpowers/plans/2026-09-16-canvas-operator-2e1-hitl.md
git commit -m "$(cat <<'EOF'
docs(agent): patch Canvas Operator 2e spec and plan 2e.1 HITL

EOF
)"
```

---

### Task 1: Lock generateForNode for agent-shaped pending_confirm nodes

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts` (append inside `describe('useNodeGeneration')`, before the closing `})`)
- Test also re-runs: `apps/web/src/components/agent/agentChipSet.test.ts` (C2 already exists — do not rewrite)

**Interfaces:**
- Consumes: existing `createNode`, `createDeps`, mocked `studioApi.generateImage` resolving `{ data: completedRecord }` with `id: 'rec-1'`
- Produces: regression named `2e.1: pending_confirm image without imageModel still starts studio generate`
- Later tasks read: if this test is RED, jump to Task 5 before production confirm

This is a characterization lock of the confirm payload agent actually writes: gold prompt, `status: pending_confirm`, **no** `imageModel`. `resolveGenerationModel('image', undefined)` must pick the platform default so `assertModelSelectable` is not a silent no-op.

- [ ] **Step 1: Append the test** at the end of `describe('useNodeGeneration')` in `apps/web/src/composables/useNodeGeneration.test.ts`:

```typescript
  it('2e.1: pending_confirm image without imageModel still starts studio generate', async () => {
    const node = createNode('image', {
      prompt: '帮我生成一张蓝色天空产品主图',
      status: 'pending_confirm',
    })
    const isModelSelectable = vi.fn(() => true)
    const { api } = createDeps([node], { isModelSelectable })

    await api.generateForNode(node)

    expect(studioApi.generateImage).toHaveBeenCalled()
    expect(isModelSelectable).toHaveBeenCalled()
    expect(node.data?.status).not.toBe('pending_confirm')
    expect(node.data?.generationRecordId).toBe('rec-1')
  })
```

- [ ] **Step 2: Run the new test and the existing C2 chip test**

```bash
pnpm --filter @lnkpi/web test -- src/composables/useNodeGeneration.test.ts src/components/agent/agentChipSet.test.ts
```

Expected: both files PASS. C2 must still say `confirmProposeGeneration` calls `generateForNode` and never `sendPreset`.

If the **new** test FAILS (`generateImage` not called, or status still `pending_confirm`): do **not** weaken the assertion. Go to Task 5 with this failure as the repro, then re-run Step 2.

- [ ] **Step 3: Commit** (skip if Task 5 must land in the same commit as the fix)

```bash
git add apps/web/src/composables/useNodeGeneration.test.ts
git commit -m "$(cat <<'EOF'
test(web): lock pending_confirm generate without imageModel

EOF
)"
```

---

### Task 2: V4 harness — setup / cancel / assert-started

**Files:**
- Create: `deploy/prod-phase-2e1-hitl-verify.py`
- Do **not** copy-edit `deploy/prod-phase-v2-bare-gen-verify.py`

**Interfaces:**
- Consumes: same login/SSE contract as V2 (`POST /auth/login`, `POST /agent/canvas/create`, `POST /agent/chat/conversation` SSE)
- Produces:
  - `setup` → prints `2E1_SESSION`, `2E1_NODE`, `2E1_CANVAS_URL`; leaves node `pending_confirm`; **no** studio generate
  - `cancel` → new session, gold, `POST /api/agent/clear-propose`, node `draft`, no `generationRecordId`
  - `assert-started` → reads `2E1_SESSION` / `2E1_NODE` (env or argv) and PASSes only if that node is `generating` **or** has `generationRecordId`

- [ ] **Step 1: Write the script** exactly as follows

```python
#!/usr/bin/env python3
"""Production 2e.1 HITL verify — setup / cancel / assert-started.

Does not replace deploy/prod-phase-v2-bare-gen-verify.py (P7 unchanged).
Does not click the confirm chip and does not POST /studio/image/generate.
E2 remains a browser click of [data-testid=generation-propose-confirm].

Usage:
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3.11 deploy/prod-phase-2e1-hitl-verify.py setup
  python3.11 deploy/prod-phase-2e1-hitl-verify.py cancel
  2E1_SESSION=... 2E1_NODE=... python3.11 deploy/prod-phase-2e1-hitl-verify.py assert-started
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
        "Idempotency-Key": f"2e1_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    tool_names: list[str] = []
    routes: list[dict] = []
    canvas_actions: list[dict] = []
    parts: list[str] = []
    saw_done = False
    billed = False
    pending = False
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
                        data = ev.get("data") or {}
                        if et == "text_delta":
                            parts.append(str(data.get("text") or ""))
                        if et == "text_replace":
                            parts = [str(data.get("text") or "")]
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
                            payload = data.get("payload") or data.get("data") or data
                            inner = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else payload
                            if isinstance(inner, dict):
                                st = str(inner.get("status") or payload.get("status") or "")
                                if st == "pending_confirm":
                                    pending = True
                                if st in ("completed", "running", "generating", "success"):
                                    billed = True
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
    flow = routes[-1].get("flow_mode") if routes else None
    return {
        "tools": tool_names,
        "flow_mode": flow,
        "pending_via_actions": pending,
        "billed_via_actions": billed,
        "no_run_tools": "run_image_generation" not in tool_names
        and "run_video_generation" not in tool_names,
        "saw_done": saw_done,
    }


def login() -> tuple[str, str | None]:
    login_res = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})
    tok = (login_res.get("data") or {}).get("token")
    if not tok:
        return "", None
    model = os.environ.get("HARNESS_MODEL", "").strip() or None
    if not model:
        boot = http("GET", "/provider/bootstrap", t=tok)
        model = ((boot.get("data") or {}).get("preferences") or {}).get("defaultTextModel") or None
    return str(tok), model


def new_session(tok: str) -> str:
    canvas = http("POST", "/agent/canvas/create", {"title": f"2e1-{uuid.uuid4().hex[:6]}"}, tok)
    sid = (canvas.get("data") or {}).get("id") or (canvas.get("data") or {}).get("sessionId")
    return str(sid or "")


def load_canvas(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)
    data = sess.get("data") or sess
    raw = data.get("canvasData") or data.get("canvas") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def pending_nodes(canvas: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in canvas.get("nodes") or []:
        st = str((n.get("data") or {}).get("status") or "")
        if st == "pending_confirm":
            out.append(n)
    return out


def node_by_id(canvas: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    for n in canvas.get("nodes") or []:
        if str(n.get("id")) == node_id:
            return n
    return None


def gold_turn(tok: str, sid: str, model: str | None) -> dict[str, Any]:
    return sse_chat(tok, sid, GOLD, f"t_2e1_{uuid.uuid4().hex[:8]}", model=model, timeout=SSE_TIMEOUT)


def cmd_setup() -> int:
    print("=== 2e.1 HITL setup (stop at pending_confirm; do not confirm) ===")
    print(f"BASE={BASE}\n")
    tok, model = login()
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        return 1
    sid = new_session(tok)
    record("Canvas session", bool(sid), sid)
    if not sid:
        return 1
    try:
        r = gold_turn(tok, sid, model)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("E1 gold turn completes", False, str(exc))
        return 1
    record("E1 flow_mode=canvas_agent", r["flow_mode"] == "canvas_agent", f"flow={r['flow_mode']}")
    record(
        "E1 tool_call upsert then propose",
        "upsert_media_node" in r["tools"]
        and "propose_generation" in r["tools"]
        and r["tools"].index("upsert_media_node") < r["tools"].index("propose_generation"),
        f"tools={r['tools'][:12]}",
    )
    record("E1 no run_* tools", r["no_run_tools"], f"tools={r['tools'][:8]}")
    record("E1 no billed complete before confirm", not r["billed_via_actions"], f"billed={r['billed_via_actions']}")
    time.sleep(1.0)
    pnodes = pending_nodes(load_canvas(tok, sid))
    nid = str(pnodes[0].get("id")) if pnodes else ""
    record("E1 pending_confirm on canvas", bool(nid) or r["pending_via_actions"], f"node={nid}")
    url = f"{BASE}/workflow/{sid}"
    print(f"\n2E1_SESSION={sid}")
    print(f"2E1_NODE={nid}")
    print(f"2E1_CANVAS_URL={url}")
    print("E2 next: open that URL, click [data-testid=generation-propose-confirm], then run assert-started")
    return 1 if FAIL else 0


def cmd_cancel() -> int:
    print("=== 2e.1 HITL cancel (E4; no studio) ===")
    print(f"BASE={BASE}\n")
    tok, model = login()
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        return 1
    sid = new_session(tok)
    record("Canvas session", bool(sid), sid)
    if not sid:
        return 1
    try:
        r = gold_turn(tok, sid, model)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("Cancel-session gold turn", False, str(exc))
        return 1
    record("Cancel-session no run_*", r["no_run_tools"], f"tools={r['tools'][:8]}")
    time.sleep(1.0)
    pnodes = pending_nodes(load_canvas(tok, sid))
    nid = str(pnodes[0].get("id")) if pnodes else ""
    record("Cancel-session pending_confirm", bool(nid), f"node={nid}")
    if not nid:
        return 1
    cleared = http("POST", "/agent/clear-propose", {"sessionId": sid, "nodeId": nid}, tok)
    data = cleared.get("data") or {}
    record("E4 clear-propose status=draft", data.get("status") == "draft", str(data)[:200])
    node = node_by_id(load_canvas(tok, sid), nid) or {}
    nd = node.get("data") or {}
    record("E4 canvas node is draft", str(nd.get("status") or "") == "draft", f"status={nd.get('status')}")
    record(
        "E4 no generationRecordId after cancel",
        not nd.get("generationRecordId"),
        f"generationRecordId={nd.get('generationRecordId')}",
    )
    return 1 if FAIL else 0


def cmd_assert_started() -> int:
    print("=== 2e.1 HITL assert-started (after browser confirm click) ===")
    sid = os.environ.get("2E1_SESSION", "").strip()
    nid = os.environ.get("2E1_NODE", "").strip()
    record("2E1_SESSION set", bool(sid), sid)
    record("2E1_NODE set", bool(nid), nid)
    if not sid or not nid:
        return 1
    tok, _model = login()
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        return 1
    node = node_by_id(load_canvas(tok, sid), nid) or {}
    nd = node.get("data") or {}
    st = str(nd.get("status") or "")
    rid = nd.get("generationRecordId")
    started = st in ("generating", "completed", "fallback_pending") or bool(rid)
    record(
        "E2 generate started (not silent click)",
        started and st != "pending_confirm",
        f"status={st} generationRecordId={rid}",
    )
    record("E2 left pending_confirm", st != "pending_confirm", f"status={st}")
    record("E2 is not draft-without-record", not (st == "draft" and not rid), f"status={st} rid={rid}")
    return 1 if FAIL else 0


def main() -> int:
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if cmd not in {"setup", "cancel", "assert-started"}:
        print("usage: prod-phase-2e1-hitl-verify.py setup|cancel|assert-started", file=sys.stderr)
        return 2
    if cmd == "setup":
        return cmd_setup()
    if cmd == "cancel":
        return cmd_cancel()
    return cmd_assert_started()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        raise SystemExit(2)
```

- [ ] **Step 2: Syntax-check**

```bash
python3.11 -m py_compile deploy/prod-phase-2e1-hitl-verify.py
```

Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add deploy/prod-phase-2e1-hitl-verify.py
git commit -m "$(cat <<'EOF'
chore(deploy): add 2e.1 HITL setup/cancel/assert harness

EOF
)"
```

---

### Task 3: Production E1 + E4 (no confirm click)

**Files:**
- Run only: unmodified `deploy/prod-phase-v2-bare-gen-verify.py` and new `deploy/prod-phase-2e1-hitl-verify.py`
- Requires: `full_network` (or equivalent) to `http://119.29.173.89:8888`

**Interfaces:**
- Consumes: Task 2 script; live prod Nest + agent-runtime
- Produces: E1 green from **both** V2 P7 and `setup`; E4 green from `cancel`. Does **not** produce E2.

- [ ] **Step 1: Run unmodified V2 (E1 / P7 lock)**

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  python3.11 deploy/prod-phase-v2-bare-gen-verify.py
```

Expected: `PASS=10 FAIL=0` (or the current P7 count; **FAIL must be 0**). Do not change V2 assertions if a case fails — that is a prod regression, stop.

- [ ] **Step 2: Run 2e.1 setup**

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  python3.11 deploy/prod-phase-2e1-hitl-verify.py setup
```

Expected: E1 lines all ✅; printed `2E1_SESSION`, `2E1_NODE`, `2E1_CANVAS_URL`. Save those three values for Task 4. **Do not** POST studio. **Do not** call `assert-started` yet.

- [ ] **Step 3: Run 2e.1 cancel on a fresh session (E4)**

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  python3.11 deploy/prod-phase-2e1-hitl-verify.py cancel
```

Expected: every `E4` line ✅; `FAIL=0`. This is a **different** canvas than Step 2.

- [ ] **Step 4: Commit** only if you had to fix the new script (not V2). If both commands already passed with the Task 2 file, skip.

---

### Task 4: Production E2 + E3 — browser click the confirm chip

**Files:**
- No source edits unless this task fails, then Task 5
- Browser: `{BASE}/workflow/{2E1_SESSION}` from Task 3 Step 2
- After click: `deploy/prod-phase-2e1-hitl-verify.py assert-started`

**Interfaces:**
- Consumes: `2E1_SESSION` / `2E1_NODE` / `2E1_CANVAS_URL` from Task 3 setup
- Produces: E2 green **only** with UI evidence of clicking `generation-propose-confirm` **and** `assert-started` PASS. E3: confirm session has `generationRecordId` (or `generating`); cancel session from Task 3 has none

Do **not** click `[data-testid=atomic-confirm-dock]`. Do **not** type `确认生成` into the composer (`sendPreset`). Do **not** POST `/studio/image/generate`.

- [ ] **Step 1: Open the setup canvas**

Navigate to `2E1_CANVAS_URL` (example `http://119.29.173.89:8888/workflow/<sessionId>`).

If a login dialog is visible:

1. Phone input placeholder `请输入手机号` → `17279698608`
2. Code input placeholder `请输入验证码` → `123456`
3. Click the full-width primary submit (label `登录` / `注册`)

Wait until the agent side rail shows the confirm chip. The button must have `data-testid="generation-propose-confirm"` and text `确认生成`. If that testid is missing, E2 fails — do not substitute Dock generate.

- [ ] **Step 2: Click confirm**

Click `[data-testid=generation-propose-confirm]` once. Wait up to 60s.

Pass signals (any one after leaving `pending_confirm`): node shows generating spinner, or canvas GET (next step) has `generationRecordId`, or status `generating`/`completed`.

Fail signals: chip click no-ops; node stays `pending_confirm`; node becomes `draft` with no `generationRecordId`; composer sends a user message `确认生成`; only `atomic-confirm-dock` was clicked.

- [ ] **Step 3: assert-started (E2/E3 confirm half)**

```bash
BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \
  2E1_SESSION=<from setup> 2E1_NODE=<from setup> \
  python3.11 deploy/prod-phase-2e1-hitl-verify.py assert-started
```

Expected: `E2 generate started` ✅ and `FAIL=0`.

If FAIL: capture `status` + `generationRecordId` from the script output and go to Task 5. Do **not** green E2 via studio-direct.

- [ ] **Step 4: E3 cross-check**

Confirm session (this task): `generationRecordId` present or status `generating`/`completed` (one small image credit allowed).

Cancel session (Task 3 Step 3): no `generationRecordId`. Do not start a second billed generate.

- [ ] **Step 5: Commit** only if Task 5 produced code. If prod was already green, no commit here.

---

### Task 5: Fix confirm wiring only if Task 4 failed

**Files (touch only the failing layer):**
- Modify: `apps/web/src/composables/useNodeGeneration.ts` (`generateForNode` around the empty prompt/refs early return ~713 and `assertModelSelectable` ~677)
- and/or `apps/web/src/pages/CanvasPage.vue` (`isModelSelectable` ~432, `handleAgentGenerateNode` ~2829)
- Test: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Consumes: Task 1 test + the failing `assert-started` status
- Produces: same unit test green **and** Task 4 re-run green
- Forbidden: new confirm API; bind changes; `sendPreset('确认生成')`

Hypotheses (check in this order; stop at the first that matches evidence):

1. `generateForNode` returned because `!local && !refs.length` (prompt empty on the node). `handleAgentGenerateNode` already patched `pending_confirm` → `draft`, so the chip looks dismissed but studio never ran.
2. `assertModelSelectable` / `CanvasPage.isModelSelectable` rejected the resolved default (`prefs.selectableImageModels.includes(platform::default)` is false when `imageModel` was missing).
3. Confirm clicked `atomic-confirm-dock` or `sendPreset` instead of `generation-propose-confirm` — that is a test error, not a code fix.

- [ ] **Step 1: Write a failing test that matches the hypothesis**

If hypothesis 1 (empty prompt after confirm should not look successful; surface an error instead of silent return). Append:

```typescript
  it('2e.1: pending_confirm image with empty prompt patches error instead of silent return', async () => {
    const node = createNode('image', {
      prompt: '',
      status: 'pending_confirm',
    })
    const { api, deps } = createDeps([node])

    await api.generateForNode(node)

    expect(studioApi.generateImage).not.toHaveBeenCalled()
    expect(deps.patchNodeData).toHaveBeenCalledWith(
      'image-1',
      expect.objectContaining({
        status: NODE_GENERATION_STATUS.error,
        errorMessage: '请先填写提示词',
      }),
    )
  })
```

If hypothesis 2 (default model must remain selectable when `imageModel` is omitted). Append — this should already be Task 1; if Task 1 failed because `isModelSelectable` was called with a key the canvas page would reject, change `CanvasPage.isModelSelectable` so a resolved platform default is allowed when the list is empty or the requested field was blank. Keep Task 1's assertion (`generateImage` called).

- [ ] **Step 2: Run the new test and confirm it fails**

```bash
pnpm --filter @lnkpi/web test -- src/composables/useNodeGeneration.test.ts
```

Expected (hypothesis 1): FAIL, `generateImage` not called and `errorMessage` missing (silent `return` at the `!local && !refs.length` branch).

- [ ] **Step 3: Minimal implementation**

Hypothesis 1 — in `apps/web/src/composables/useNodeGeneration.ts` inside `generateForNode`, replace the silent empty-input return with an error patch (prompt nodes keep the existing image-ref exception):

```typescript
    if (nodeType === 'prompt') {
      const hasImageRef = refs.some((r) => r.mediaType === 'image' && Boolean(r.url?.trim()))
      if (!local && !hasImageRef) {
        deps.patchNodeData(node.id, {
          status: NODE_GENERATION_STATUS.error,
          errorMessage: '请先填写提示词',
        })
        return
      }
    } else if (nodeType !== 'sceneComposer' && !local && !refs.length) {
      deps.patchNodeData(node.id, {
        status: NODE_GENERATION_STATUS.error,
        errorMessage: '请先填写提示词',
      })
      return
    }
```

Hypothesis 2 — in `apps/web/src/pages/CanvasPage.vue` `isModelSelectable`, allow the resolved default when the selectable list does not contain the encoded key:

```typescript
function isModelSelectable(modality: StudioModality, model: string): boolean {
  const prefs = preferences.value
  if (!prefs) return true
  const list =
    modality === 'image'
      ? prefs.selectableImageModels
      : modality === 'video'
        ? prefs.selectableVideoModels
        : modality === 'audio'
          ? prefs.selectableAudioModels
          : prefs.selectableTextModels
  if (!list.length) return true
  if (list.includes(model)) return true
  const catalog = catalogModelKeyFromValue(model)
  return list.includes(catalog)
}
```

Add the import if missing:

```typescript
import {
  resolveGenerationModel,
  catalogModelKeyFromValue,
  type StudioModality,
} from '@/constants/studioModels'
```

(`catalogModelKeyFromValue` is already exported from `apps/web/src/constants/studioModels.ts`.)

Do **not** apply both fixes if only one hypothesis is evidenced.

- [ ] **Step 4: Re-run unit tests**

```bash
pnpm --filter @lnkpi/web test -- src/composables/useNodeGeneration.test.ts src/components/agent/agentChipSet.test.ts
```

Expected: PASS.

- [ ] **Step 5: Re-run Task 3 setup + Task 4 browser + assert-started** on a **new** session (the failed session may already be `draft`).

Expected: `assert-started` FAIL=0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/composables/useNodeGeneration.ts \
  apps/web/src/composables/useNodeGeneration.test.ts \
  apps/web/src/pages/CanvasPage.vue
git commit -m "$(cat <<'EOF'
fix(web): start dock generate from agent pending_confirm confirm

EOF
)"
```

Only stage files you actually changed.

---

### Task 6: Stop — do not start 2e.2

**Files:** none

**Interfaces:**
- Consumes: E1–E4 green (E5 optional, must not substitute E2)
- Produces: handoff note only

- [ ] **Step 1:** Confirm none of these files changed in the 2e.1 PR: `services/agent-runtime/app/graph/explore_dispatch.py`, `deploy/prod-phase-v2-bare-gen-verify.py`, `deploy/prod-phase-2d3-h8-verify.py`.

- [ ] **Step 2:** Do not write 2e.2 bind/prompt changes. 2e.2 starts only after this production hard table is green (spec §2.4).

---

## Self-review (author)

1. **Spec coverage:** E1 → Task 3 V2 + setup. E2 → Task 4 click + assert-started. E3 → Task 4 Step 4 vs Task 3 cancel. E4 → Task 3 cancel. E5 → explicitly not a gate. 2E-D8 zero bind → Global Constraints + Task 6. Missing `imageModel` → Task 1 + Task 5 hypothesis 2.
2. **Placeholder scan:** no TBD; Task 5 is conditional but contains full test + patch text.
3. **Type consistency:** `clear-propose` body `{ sessionId, nodeId }`; canvas route `/workflow/:sessionId`; confirm testid `generation-propose-confirm`.
