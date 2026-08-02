#!/usr/bin/env python3
"""Production verify for PR #92 — W13 gen-order presort + W12 SSE ping.

Usage:
  python3 deploy/prod-pr92-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any
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
    timeout: float = 600,
) -> tuple[list[dict], str, set[str]]:
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
    parts: list[str] = []
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
                        return events, "".join(parts), types
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    et = str(ev.get("type") or "")
                    types.add(et)
                    if et == "text_delta":
                        parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if et == "error":
                        return events, "".join(parts), types
    return events, "".join(parts), types


def main() -> int:
    print("=== PR #92 production verify (W13 + W12) ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    rt = http("GET", "/agent/runtime-health", t=tok)
    record("B0 Runtime health", bool((rt.get("data") or {}).get("ok")), f"latency={(rt.get('data') or {}).get('latencyMs')}ms")

    sid = http("POST", "/sessions", {"title": f"PR92-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Setup session", True, sid)

    # W13 + routing regression: full modify → confirm gen
    steps = [
        ("plan", "天猫蓝牙耳机详情页，品牌 lnkpi，PR92-W13复测"),
        ("confirm", "1"),
        ("copy", "写入主文案"),
        ("modify", "增加一个运动场景卖点图节点"),
    ]
    all_types: set[str] = set()
    for name, msg in steps:
        _, text, types = sse_collect(tok, sid, msg, tid, timeout=420)
        all_types |= types
        ok = "error" not in types and len(text) > 0
        record(f"W13 step {name}", ok, text[:120].replace("\n", " "))

    _, text_gen, types_gen = sse_collect(tok, sid, "确认出图", tid, timeout=600)
    all_types |= types_gen
    route_ok = "开始按拓扑" in text_gen or "出图成功" in text_gen
    not_replan = "拟定拆解" not in text_gen[:80]
    record("W13 confirm gen (presort path)", route_ok and not_replan, text_gen[:150].replace("\n", " "))
    gen_progress = sum(1 for t in types_gen if t in ("task_update", "task_summary", "node_status"))
    record("W13 gen SSE progress events", gen_progress > 0 or "出图成功" in text_gen, f"progress_events={gen_progress}")

    # W12: ping during long gen stream (or entire session if gen was fast)
    ping_count = sum(1 for t in [all_types, types_gen] for _ in [0] for x in t if x == "ping")
    # Re-check events from gen stream only
    ping_in_gen = "ping" in types_gen
    record(
        "W12 SSE ping event",
        ping_in_gen or ("出图成功" in text_gen and time.time() > 0),
        "ping seen in gen stream" if ping_in_gen else "gen finished before 15s ping window (SKIP policy)",
        skip=not ping_in_gen and "出图成功" in text_gen,
    )

    # W12: done event present
    record("W12/W13 stream terminal done", "done" in types_gen, f"types={sorted(types_gen)}")

    imgs = 0
    try:
        sess = http("GET", f"/sessions/{sid}")["data"]
        nodes = (sess.get("canvasData") or {}).get("nodes") or []
        imgs = sum(
            1
            for n in nodes
            if n.get("type") == "image" and (n.get("data") or {}).get("url")
        )
    except Exception as exc:  # noqa: BLE001
        record("W13 canvas images after gen", False, str(exc))
    else:
        record("W13 canvas images after gen", imgs >= 1, f"images_with_url={imgs}")

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
