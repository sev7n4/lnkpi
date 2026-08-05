#!/usr/bin/env python3
"""Production smoke for Agent execution trace (P0)."""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")

PASS = FAIL = 0
FORBIDDEN = ("原子创作", "image 节点", "[canvas_context]", "canvas_context")


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


def sse_collect(t: str, sid: str, msg: str, tid: str, *, timeout: float = 180) -> tuple[list[str], list[dict], set[str]]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    replaces: list[str] = []
    canvas_actions: list[dict] = []
    node_statuses: list[dict] = []
    types: set[str] = set()
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
                    break
                if not chunk:
                    break
                buf += chunk.decode(errors="replace")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    for line in block.splitlines():
                        if not line.startswith("data:"):
                            continue
                        pl = line[5:].strip()
                        if pl == "[DONE]":
                            return replaces, canvas_actions, node_statuses, types
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        et = str(ev.get("type") or "")
                        types.add(et)
                        data = ev.get("data") or {}
                        if et == "text_replace" and data.get("text"):
                            replaces.append(str(data["text"]))
                        if et == "canvas_action":
                            canvas_actions.append(data)
                        if et == "node_status":
                            node_statuses.append(data)
                        if et == "done":
                            return replaces, canvas_actions, node_statuses, types
        except IncompleteRead:
            pass
    return replaces, canvas_actions, node_statuses, types


def main() -> int:
    print("=== Execution trace production verify (P0) ===")
    print(f"BASE={BASE}\n")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    record("Login", True)

    sid = http("POST", "/sessions", {"title": f"trace-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    replaces, canvas_actions, node_statuses, types = sse_collect(
        tok, sid, "帮我生成一个模特人物图", tid
    )
    stream = "\n".join(replaces)

    record("multi text_replace stages", len(replaces) >= 2, f"count={len(replaces)}")
    record("parse ack in stream", any("我来生成" in t for t in replaces), replaces[0][:100] if replaces else "")
    record("done in stream", any("生成完成" in t for t in replaces), replaces[-1][:100] if replaces else "")
    record("canvas_action emitted", len(canvas_actions) >= 1 or "canvas_action" in types, f"n={len(canvas_actions)}")
    record("node_status emitted", len(node_statuses) >= 1 or "node_status" in types, f"n={len(node_statuses)}")
    record("no forbidden labels", not any(f in stream for f in FORBIDDEN))
    record("step events emitted", "step" in types, f"types={sorted(types)[:12]}")

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
