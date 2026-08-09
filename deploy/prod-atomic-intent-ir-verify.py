#!/usr/bin/env python3
"""Production verify — source-backed video/image intent IR (B+C)."""

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

CASES = [
    ("基于提示词生成视频", "video"),
    ("@T1 请基于文案生成视频", "video"),
    ("基于文本生成图片", "image"),
    ("帮我生成一个蓝牙耳机的分镜提示词", "prompt"),
    ("@T1 请按风格3出图", "image"),
]

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
        line += f" — {detail[:200]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sse_collect(t: str, sid: str, msg: str, tid: str, *, timeout: float = 180) -> tuple[list[dict], list[dict]]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    canvas_actions: list[dict] = []
    linked: list[dict] = []
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
                            return canvas_actions, linked
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        if ev.get("type") == "canvas_action":
                            canvas_actions.append(ev.get("data") or {})
                        if ev.get("type") == "linked_outputs":
                            linked.extend(ev.get("data") or [])
                        if ev.get("type") == "done":
                            return canvas_actions, linked
        except IncompleteRead:
            pass
    return canvas_actions, linked


def first_node_type(canvas_actions: list[dict]) -> str | None:
    for act in canvas_actions:
        if act.get("type") != "add_node":
            continue
        payload = act.get("payload") or {}
        return str(payload.get("nodeType") or payload.get("type") or "")
    return None


def main() -> int:
    print("=== Atomic Intent IR production verify ===")
    print(f"BASE={BASE}\n")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    record("Login", True)

    sid = http("POST", "/sessions", {"title": f"ir-verify-{int(time.time())}"}, t=tok)["data"]["id"]

    for utterance, expect_type in CASES:
        tid = f"{sid}:{uuid.uuid4().hex[:8]}"
        actions, linked = sse_collect(tok, sid, utterance, tid, timeout=120)
        node_type = first_node_type(actions)
        lo_type = (linked[0].get("nodeType") if linked else None)
        got = node_type or lo_type or "?"
        ok = got == expect_type
        record(f"{utterance} → {expect_type}", ok, f"got={got}, actions={len(actions)}")

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
