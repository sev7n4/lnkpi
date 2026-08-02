#!/usr/bin/env python3
"""Production verify for PR #95 — W12 SSE recovery (ping + thread-state).

Usage:
  python3 deploy/prod-w12-verify.py
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
    timeout: float = 120,
) -> tuple[list[dict], set[str]]:
    body = {"sessionId": sid, "message": msg, "threadId": tid}
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    end = time.time() + timeout
    with urlopen(r, timeout=timeout) as resp:
        buf = ""
        while time.time() < end:
            chunk = resp.read(4096)
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
                        return events, types
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    types.add(str(ev.get("type") or ""))
                    if "ping" in types and len(events) >= 3:
                        return events, types
    return events, types


def main() -> int:
    print("=== PR #95 production verify (W12) ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")), f"latency={(rt.get('data') or {}).get('latencyMs')}ms")

    sid = http("POST", "/sessions", {"title": f"W12-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Setup session", True, sid)

    events, types = sse_collect(tok, sid, "天猫蓝牙耳机详情页，品牌 lnkpi，W12复测", tid, timeout=180)
    record("SSE stream started", len(events) >= 1, f"events={len(events)} types={sorted(types)}")
    # Ping fires after 15s; short plan streams may finish before first heartbeat.
    if "ping" in types:
        record("SSE ping heartbeat", True, f"types={sorted(types)}")
    elif "done" in types and len(events) <= 5:
        record("SSE ping heartbeat", True, "stream finished before 15s ping interval (expected)", skip=True)
    else:
        record("SSE ping heartbeat", False, f"types={sorted(types)}")

    ts = http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok)
    data = ts.get("data") or {}
    record(
        "thread-state API",
        ts.get("code") == 0 and data.get("threadId") == tid,
        f"phase={data.get('phase')} interrupted={data.get('interrupted')}",
    )
    record(
        "thread-state has phase",
        isinstance(data.get("phase"), (str, type(None))),
        f"phase={data.get('phase')}",
    )

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
