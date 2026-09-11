#!/usr/bin/env python3
"""Production smoke for Refine edit-intent taxonomy stamps (Catalog Fill).

This verifies agent → guideEditIntentId stamping for edit intents.
It does NOT drive the RefineSidePanel UI (see manual checklist).

Checks:
  1. Auth
  2. Stamp e3 / e5 / e7 (baseline + catalog-fill)
  3. Stamp additional edit intents: e1, e2, e6, e8 (when taxonomy matches)

Usage:
  python3 deploy/prod-refine-edit-intent-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3 deploy/prod-refine-edit-intent-verify.py
"""

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
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "240"))

PASS = FAIL = 0

# (label, utterance, expect_intent_id)
# Utterances must include 帮我生成… so atomic-create stamps guide ids.
CASES: list[tuple[str, str, str]] = [
    ("e3", "帮我生成一张换装图，只换衣服保留脸", "e3_identity_clothing"),
    ("e5", "帮我生成一张产品抠图透明底 PNG", "e5_transparent_cutout"),
    ("e7", "帮我生成一张去物体并自然补全背景的图片", "e7_remove_object"),
    ("e1", "帮我生成一张版面翻译图，保留原布局只翻译文字", "e1_translate_layout"),
    ("e2", "帮我生成一张风格迁移图，把参考风格套到主体上", "e2_style_transfer"),
    ("e6", "帮我生成一张草图转写实图", "e6_drawing_to_realistic"),
    ("e8", "帮我生成一张人物入景合成图", "e8_insert_person"),
]


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
        line += f" — {detail[:260]}"
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
    with urlopen(r, timeout=180) as resp:
        return json.loads(resp.read())


def sse_collect(t: str, sid: str, msg: str, tid: str, *, timeout: float) -> tuple[list[dict], str, set[str], str]:
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
                chunk = resp.read(4096)
                if not chunk:
                    exit_reason = "eof"
                    break
                buf += chunk.decode("utf-8", errors="replace")
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


def latest_nodes(tok: str, sid: str) -> list[dict[str, Any]]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {}
    return list(canvas.get("nodes") or [])


def node_intent(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    return str(data.get("guideEditIntentId") or data.get("guide_edit_intent_id") or "").strip()


def verify_stamp(tok: str, label: str, utterance: str, expect_intent: str) -> None:
    sid = http("POST", "/sessions", {"title": f"refine-e-{label}-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, types, exit_reason = sse_collect(tok, sid, utterance, tid, timeout=SSE_TIMEOUT_SEC)
    found = ""
    for n in latest_nodes(tok, sid):
        i = node_intent(n)
        if i:
            found = i
            break
    record(
        f"agent stamp intent ({label})",
        found == expect_intent,
        f"got={found or '-'} expect={expect_intent} exit={exit_reason} types={sorted(types)[:6]} text={text[:60]!r}",
    )


def main() -> int:
    print(f"BASE_URL={BASE}")
    print("Target: Refine edit-intent taxonomy stamps\n")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("auth login", True)
    except Exception as exc:  # noqa: BLE001
        record("auth login", False, str(exc))
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1

    for label, utterance, expect in CASES:
        try:
            verify_stamp(tok, label, utterance, expect)
        except Exception as exc:  # noqa: BLE001
            record(f"agent stamp intent ({label})", False, str(exc))

    print(f"\nPASS={PASS} FAIL={FAIL}")
    print("Note: RefineSidePanel UI fill/submit not covered — see deploy/manual-refine-edit-intent-checklist.md")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
