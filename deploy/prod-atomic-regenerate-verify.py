#!/usr/bin/env python3
"""Prod smoke: atomic_create turn 1 → forced fail mock not available — use image regen path.

Turn 1: 帮我生成一个模特人物图  → node created + gen ok
Turn 2: 再试一次               → same thread, no second node, gen called again

Reuse SSE helpers from prod-atomic-studio-verify.py.
Assert: session node count for title stable; second SSE has「重新生成」or completed again.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "300"))

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
        line += f" — {detail[:220]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sse_collect(t: str, sid: str, msg: str, tid: str, *, timeout: float = 300) -> tuple[list[dict], str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
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
        try:
            while time.time() < end:
                try:
                    chunk = resp.read(4096)
                except IncompleteRead as exc:
                    if exc.partial:
                        buf += exc.partial.decode(errors="replace")
                    exit_reason = "eof"
                    break
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
        except IncompleteRead:
            exit_reason = "eof"
    return events, "".join(parts), types, exit_reason


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}


def image_nodes(tok: str, sid: str) -> list[dict[str, Any]]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {}
    return [n for n in (canvas.get("nodes") or []) if n.get("type") == "image"]


def main() -> int:
    print("=== Prod smoke: atomic_regenerate two-turn (create → regen) ===")
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

    sid = http("POST", "/sessions", {"title": f"regen-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"regen_{uuid.uuid4().hex[:8]}"
    record("Create session", True, f"sid={sid} tid={tid}")

    # Turn 1: atomic create
    _, text1, types1, exit1 = sse_collect(
        tok, sid, "帮我生成一个模特人物图", tid, timeout=SSE_TIMEOUT_SEC
    )
    atomic_ok = "原子创作" in text1 and "image 节点" in text1
    not_campaign = "await_confirm" not in types1 and "拟定拆解约" not in text1[:200]
    record("Turn1 atomic path", atomic_ok and not_campaign, text1[:120])

    nodes1 = image_nodes(tok, sid)
    node_count1 = len(nodes1)
    first_node_id = str((nodes1[0] if nodes1 else {}).get("id") or "")
    data1 = ((nodes1[0] if nodes1 else {}).get("data") or {})
    has_output = bool(data1.get("generationRecordId") or data1.get("url"))
    gen_ok = "生成完成" in text1 or has_output
    record(
        "Turn1 node created + gen",
        node_count1 >= 1 and gen_ok and "error" not in types1,
        f"exit={exit1} nodes={node_count1} rec={data1.get('generationRecordId')}",
    )

    ts1 = thread_state(tok, tid)
    record(
        "Turn1 not stuck at plan gate",
        "await_confirm" not in (ts1.get("nextNodes") or []) and ts1.get("phase") not in ("await_confirm",),
        f"phase={ts1.get('phase')}",
    )

    # Turn 2: regenerate on same thread
    _, text2, types2, exit2 = sse_collect(tok, sid, "再试一次", tid, timeout=SSE_TIMEOUT_SEC)

    nodes2 = image_nodes(tok, sid)
    node_count2 = len(nodes2)
    same_count = node_count2 == node_count1
    record(
        "Turn2 node count unchanged",
        same_count,
        f"before={node_count1} after={node_count2} first_id={first_node_id}",
    )

    regen_text_ok = "重新生成" in text2 or "生成完成" in text2
    not_plan_gate = (
        "await_confirm" not in types2
        and "拟定拆解约" not in text2[:200]
        and "interrupt" not in types2
    )
    record(
        "Turn2 regen path (no plan gate)",
        regen_text_ok and not_plan_gate and "error" not in types2,
        f"exit={exit2} text={text2[:120]}",
    )

    ts2 = thread_state(tok, tid)
    record(
        "Turn2 not stuck at plan gate",
        "await_confirm" not in (ts2.get("nextNodes") or []) and ts2.get("phase") not in ("await_confirm",),
        f"phase={ts2.get('phase')}",
    )

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
