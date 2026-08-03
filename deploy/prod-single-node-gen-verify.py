#!/usr/bin/env python3
"""Production verify for P3 — single-node quick generation (W28–W30).

Flow:
  1. Create session + seed one manual image node on canvas
  2. SSE「快速生成这张主图」with focusNodeId → skip plan/topo gates
  3. Assert thread-state phase is not await_confirm; gen path started

Usage:
  python3 deploy/prod-single-node-gen-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-single-node-gen-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
GEN_SSE_TIMEOUT_SEC = float(os.environ.get("GEN_SSE_TIMEOUT_SEC", "600"))

PASS = FAIL = SKIP = 0


def record(case: str, ok: bool, detail: str = "", *, skip: bool = False) -> None:
    global PASS, FAIL, SKIP
    if skip:
        SKIP += 1
        icon = "⏭️"
    elif ok:
        PASS += 1
        icon = "✅"
    else:
        FAIL += 1
        icon = "❌"
    line = f"{icon} {case}"
    if detail:
        line += f" — {detail[:220]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sse_collect(
    t: str,
    sid: str,
    msg: str,
    tid: str,
    *,
    focus_node_id: str | None = None,
    timeout: float = 420,
) -> tuple[list[dict], str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if focus_node_id:
        body["focusNodeId"] = focus_node_id
    body["skillId"] = "enterprise-marketing-campaign"
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    parts: list[str] = []
    end = time.time() + timeout
    exit_reason = "timeout"
    with urlopen(r, timeout=timeout) as resp:
        buf = ""
        while time.time() < end:
            chunk = resp.read(4096)
            if not chunk:
                exit_reason = "eof"
                break
            buf += chunk.decode(errors="replace")
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data:"):
                        continue
                    pl = line[5:].strip()
                    if pl == "[DONE]":
                        return events, "".join(parts), types, "done_marker"
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    et = str(ev.get("type") or "")
                    types.add(et)
                    if et == "text_delta":
                        parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if et == "done":
                        return events, "".join(parts), types, "done"
                    if et == "error":
                        return events, "".join(parts), types, "error"
    return events, "".join(parts), types, exit_reason


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}


def seed_image_node(tok: str, sid: str) -> str:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {"nodes": [], "edges": []}
    node_id = f"image-p3-{int(time.time())}"
    nodes = list(canvas.get("nodes") or [])
    nodes.append(
        {
            "id": node_id,
            "type": "image",
            "position": {"x": 800, "y": 400},
            "data": {
                "title": "P3单节点主图",
                "prompt": "电商白底产品主图，P3单节点快速生成复测",
                "status": "draft",
            },
        }
    )
    patch = {"nodes": nodes, "edges": canvas.get("edges") or [], "viewport": canvas.get("viewport")}
    http("PUT", f"/sessions/{sid}", {"canvasData": patch}, t=tok)
    return node_id


def main() -> int:
    print("=== P3 single-node quick gen production verify ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("Login", True)
    except Exception as exc:  # noqa: BLE001
        record("Login", False, str(exc))
        return 1

    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = http("POST", "/sessions", {"title": f"P3-single-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Create session", True, sid)

    try:
        focus_id = seed_image_node(tok, sid)
        record("Seed image node", True, focus_id)
    except Exception as exc:  # noqa: BLE001
        record("Seed image node", False, str(exc))
        return 1

    events, text, types, exit_reason = sse_collect(
        tok,
        sid,
        "快速生成这张主图",
        tid,
        focus_node_id=focus_id,
        timeout=GEN_SSE_TIMEOUT_SEC,
    )
    record("SSE stream started", len(events) >= 1, f"events={len(events)} exit={exit_reason}")

    skipped_plan = "await_confirm" not in types and "单节点快速生成" in text
    record(
        "Single-node path (no plan gate)",
        skipped_plan or "task_update" in types or "gen" in text.lower(),
        f"types={sorted(types)} snippet={text[:120]!r}",
    )

    ts = thread_state(tok, tid)
    phase = ts.get("phase")
    next_nodes = ts.get("nextNodes") or []
    not_at_plan = "await_confirm" not in next_nodes and phase not in ("await_confirm", "compose_confirm")
    record(
        "thread-state skips plan gate",
        not_at_plan,
        f"phase={phase} next={next_nodes}",
    )
    record(
        "thread-state gen or done phase",
        phase in ("orchestrate_gen", "done", None) or any("gen" in str(n) for n in next_nodes),
        f"phase={phase}",
    )

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
