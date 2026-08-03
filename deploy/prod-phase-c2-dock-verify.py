#!/usr/bin/env python3
"""Production Phase C2 dock skillId/model verification.

Covers dock → Nest → Runtime path:
  - skillId=canvas + marketing brief → plan-like response
  - skillId=storyboard + greeting → chat (no canvas node plan)

Usage:
  python3 deploy/prod-phase-c2-dock-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-phase-c2-dock-verify.py
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
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "420"))

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
    timeout: float = 420,
    skillId: str | None = None,
    model: str | None = None,
) -> tuple[list[dict], str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if skillId:
        body["skillId"] = skillId
    if model:
        body["model"] = model
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


def plan_like(text: str) -> bool:
    markers = ("方案", "画布节点", "拟定拆解", "营销", "详情页")
    return any(m in text for m in markers)


def canvas_plan_phrase(text: str) -> bool:
    return "拟定拆解约" in text and "画布节点" in text


def main() -> int:
    print("=== Phase C2 dock skillId/model verify ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("P0 Login", True)
    except Exception as exc:  # noqa: BLE001
        record("P0 Login", False, str(exc))
        return 1

    rt = http("GET", "/agent/runtime-health", t=tok)
    record("P0 Runtime health", bool((rt.get("data") or {}).get("ok")))

    # P1: canvas skillId + marketing brief → plan-like response
    sid1 = http("POST", "/sessions", {"title": f"PhaseC2-canvas-{int(time.time())}"}, t=tok)["data"]["id"]
    tid1 = f"{sid1}:{uuid.uuid4()}"
    record("P1 Create session (canvas)", True, sid1)

    brief = "天猫蓝牙耳机详情页营销方案，品牌 lnkpi，PhaseC2 dock canvas 复测"
    _, text1, types1, exit1 = sse_collect(
        tok, sid1, brief, tid1, timeout=SSE_TIMEOUT_SEC, skillId="canvas"
    )
    ok1 = "error" not in types1 and len(text1) > 0 and plan_like(text1)
    record(
        "P1 canvas skillId plan stream",
        ok1,
        f"exit={exit1} text={text1[:100].replace(chr(10), ' ')}",
    )

    # P2: storyboard skillId + greeting → chat (no canvas node plan)
    sid2 = http("POST", "/sessions", {"title": f"PhaseC2-storyboard-{int(time.time())}"}, t=tok)["data"]["id"]
    tid2 = f"{sid2}:{uuid.uuid4()}"
    record("P2 Create session (storyboard)", True, sid2)

    _, text2, types2, exit2 = sse_collect(
        tok, sid2, "你好", tid2, timeout=SSE_TIMEOUT_SEC, skillId="storyboard"
    )
    ok2 = (
        "error" not in types2
        and len(text2) > 0
        and not canvas_plan_phrase(text2)
    )
    record(
        "P2 storyboard skillId chat stream",
        ok2,
        f"exit={exit2} text={text2[:100].replace(chr(10), ' ')}",
    )

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
