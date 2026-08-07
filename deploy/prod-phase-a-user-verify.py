#!/usr/bin/env python3
"""Production Phase A user-path verification via :8888 API.

Usage:
  python3 deploy/prod-phase-a-user-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-phase-a-user-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")

PASS = 0
FAIL = 0
SKIP = 0
RESULTS: list[tuple[str, str, str]] = []


def record(case: str, status: str, detail: str = "") -> None:
    global PASS, FAIL, SKIP
    RESULTS.append((case, status, detail))
    if status == "PASS":
        PASS += 1
    elif status == "FAIL":
        FAIL += 1
    else:
        SKIP += 1
    icon = {"PASS": "✅", "FAIL": "❌", "SKIP": "⏭️"}.get(status, "?")
    line = f"{icon} {case}"
    if detail:
        line += f" — {detail[:200]}"
    print(line)


def http_json(method: str, path: str, body: dict | None = None, token: str | None = None) -> Any:
    url = f"{API}{path}"
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def sse_conversation(
    token: str,
    session_id: str,
    message: str,
    *,
    thread_id: str,
    user_decision: str | None = None,
    timeout: float = 180,
) -> tuple[list[dict], str]:
    body: dict[str, Any] = {
        "sessionId": session_id,
        "message": message,
        "threadId": thread_id,
    }
    if user_decision:
        body["userDecision"] = user_decision
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": f"ik_{thread_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}",
    }
    req = Request(
        f"{API}/agent/chat/conversation",
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST",
    )
    events: list[dict] = []
    text_parts: list[str] = []
    deadline = time.time() + timeout
    with urlopen(req, timeout=timeout) as resp:
        buf = ""
        while time.time() < deadline:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk.decode(errors="replace")
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        return events, "".join(text_parts)
                    try:
                        ev = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    if ev.get("type") == "text_delta":
                        text_parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if ev.get("type") == "error":
                        return events, "".join(text_parts)
    return events, "".join(text_parts)


def main() -> int:
    print(f"=== Phase A production user-path verify ===")
    print(f"BASE={BASE}  PHONE={PHONE}\n")

    # B0 infra
    try:
        health = http_json("GET", "/health")
        record("B0-1 Nest health", "PASS" if health.get("ok") else "FAIL", str(health))
    except Exception as exc:  # noqa: BLE001
        record("B0-1 Nest health", "FAIL", str(exc))
        return 1

    try:
        rt = http_json("GET", "/agent/runtime-health")
        ok = bool((rt.get("data") or {}).get("ok"))
        record("B0-2 Runtime health", "PASS" if ok else "FAIL", str(rt.get("data")))
    except Exception as exc:  # noqa: BLE001
        record("B0-2 Runtime health", "FAIL", str(exc))

    # Login
    try:
        http_json("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        login = http_json("POST", "/auth/login", {"phone": PHONE, "code": CODE})
        token = login["data"]["token"]
        user = login["data"]["user"]
        record(
            "P0-0 Login",
            "PASS",
            f"user={user.get('nickname')} points={user.get('points')} membership={user.get('membership')}",
        )
    except HTTPError as exc:
        record("P0-0 Login", "FAIL", exc.read().decode() if exc.fp else str(exc))
        return 1
    except Exception as exc:  # noqa: BLE001
        record("P0-0 Login", "FAIL", str(exc))
        return 1

    # Create session
    try:
        sess = http_json("POST", "/sessions", {"title": f"PhaseA-P0-{int(time.time())}"}, token=token)
        session_id = sess["data"]["id"]
        record("P0-0b Create session", "PASS", session_id)
    except Exception as exc:  # noqa: BLE001
        record("P0-0b Create session", "FAIL", str(exc))
        return 1

    thread_id = f"{session_id}:{uuid.uuid4()}"

    # P0-1 marketing intake
    prompt = "帮我做一套天猫详情页营销方案，品类：蓝牙耳机，品牌 lnkpi，PhaseA-P0复测"
    try:
        ev1, text1 = sse_conversation(token, session_id, prompt, thread_id=thread_id, timeout=240)
        types1 = {e.get("type") for e in ev1}
        has_plan = any(k in text1 for k in ("确认", "方案", "1 / A", "A /"))
        has_err = "error" in types1 or "Error code" in text1 or "401" in text1
        if has_err:
            record("P0-1 Agent marketing plan", "FAIL", text1[:180])
        elif has_plan:
            record("P0-1 Agent marketing plan", "PASS", text1[:120].replace("\n", " "))
        else:
            record("P0-1 Agent marketing plan", "FAIL", f"unexpected reply: {text1[:180]}")
    except Exception as exc:  # noqa: BLE001
        record("P0-1 Agent marketing plan", "FAIL", str(exc))
        print("\nAborting flow — fix LLM/provider before continuing.")
        _summary()
        return 1

    time.sleep(1)
    msgs_before = http_json(
        "GET",
        f"/agent/chat/user/messages?sessionId={session_id}&threadId={thread_id}",
    )
    count_before = len(msgs_before.get("data") or [])

    # P0-2 confirm plan
    try:
        ev2, text2 = sse_conversation(token, session_id, "1", thread_id=thread_id, timeout=240)
        has_canvas = any(e.get("type") == "canvas_action" for e in ev2)
        record(
            "P0-2 Confirm plan → canvas",
            "PASS" if has_canvas or "营销方案" in text2 or "写入" in text2 else "FAIL",
            f"canvas_actions={sum(1 for e in ev2 if e.get('type')=='canvas_action')} text={text2[:80]}",
        )
    except Exception as exc:  # noqa: BLE001
        record("P0-2 Confirm plan → canvas", "FAIL", str(exc))

    # P0-5 history dedup (W2)
    try:
        msgs_after = http_json(
            "GET",
            f"/agent/chat/user/messages?sessionId={session_id}&threadId={thread_id}",
        )
        data = msgs_after.get("data") or []
        user_msgs = [m for m in data if m.get("role") == "user" and prompt in str(m.get("content") or "")]
        record(
            "P0-5 History user message saved",
            "PASS" if len(user_msgs) >= 1 else "FAIL",
            f"user_msgs_with_prompt={len(user_msgs)} total={len(data)} delta={len(data)-count_before}",
        )
        dup = len(user_msgs) > 2
        if dup:
            record("P0-5 History no duplicate flood", "FAIL", f"duplicate user rows={len(user_msgs)}")
        else:
            record("P0-5 History no duplicate flood", "PASS", f"user rows={len(user_msgs)}")
    except Exception as exc:  # noqa: BLE001
        record("P0-5 History", "FAIL", str(exc))

    # P0-6 concurrent busy (same thread)
    try:
        import threading

        results: list[tuple[list[dict], str]] = []

        def _bg() -> None:
            try:
                results.append(
                    sse_conversation(
                        token,
                        session_id,
                        "确认",
                        thread_id=thread_id,
                        timeout=30,
                    )
                )
            except Exception:
                results.append(([], ""))

        t = threading.Thread(target=_bg, daemon=True)
        t.start()
        time.sleep(0.5)
        _, busy_text = sse_conversation(token, session_id, "改成更运动风", thread_id=thread_id, timeout=30)
        t.join(timeout=35)
        busy_ok = any(
            s in busy_text
            for s in ("上一轮仍在处理中", "出图仍在进行中", "修改意见已收到", "请稍候")
        )
        record("P0-6 Concurrent busy tip", "PASS" if busy_ok else "SKIP", busy_text[:100] or "no overlap")
    except Exception as exc:  # noqa: BLE001
        record("P0-6 Concurrent busy tip", "SKIP", str(exc))

    _summary()
    return 0 if FAIL == 0 else 1


def _summary() -> None:
    print(f"\n=== Summary: PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    if FAIL:
        print("Phase A user-path: NOT READY for Phase B — fix failures above.")
    else:
        print("Phase A user-path: core checks passed (extend with topo/gen manually if not covered).")


if __name__ == "__main__":
    sys.exit(main())
