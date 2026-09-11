#!/usr/bin/env python3
"""Production smoke for Image Prompting Guide Catalog Fill (#278).

Checks:
  1. Auth + session
  2. POST /studio/prompt/generate with guideSceneId=g3_exact_text
  3. Existing g3/e5 agent atomic utterances stamp guide ids on nodes
  4. Catalog-fill g6/e7 utterances stamp the new guide ids on nodes

Usage:
  python3 deploy/prod-image-prompting-guide-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3 deploy/prod-image-prompting-guide-verify.py
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
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "240"))

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


def latest_nodes(tok: str, sid: str) -> list[dict[str, Any]]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {}
    return list(canvas.get("nodes") or [])


def verify_prompt_api_accepts_guide_scene(tok: str) -> None:
    """DTO acceptance smoke: empty prompt must 400 quickly even with guideSceneId present."""
    t0 = time.time()
    try:
        http(
            "POST",
            "/studio/prompt/generate",
            {"prompt": "", "guideSceneId": "g3_exact_text"},
            t=tok,
        )
        record("studio accepts guideSceneId field", False, "expected 400 for empty prompt")
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        ok = "400" in msg or "Bad Request" in msg
        record(
            "studio accepts guideSceneId field",
            ok,
            f"{type(exc).__name__}: {msg[:120]} sec={time.time() - t0:.1f}",
        )


def _node_guide_ids(node: dict[str, Any]) -> tuple[str, str]:
    data = node.get("data") or {}
    scene = str(data.get("guideSceneId") or data.get("guide_scene_id") or "").strip()
    intent = str(data.get("guideEditIntentId") or data.get("guide_edit_intent_id") or "").strip()
    return scene, intent


def verify_agent_taxonomy_stamp(tok: str, label: str, utterance: str, expect_scene: str | None, expect_intent: str | None) -> None:
    sid = http("POST", "/sessions", {"title": f"guide-{label}-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, types, exit_reason = sse_collect(tok, sid, utterance, tid, timeout=SSE_TIMEOUT_SEC)
    nodes = latest_nodes(tok, sid)
    found_scene = ""
    found_intent = ""
    for n in nodes:
        s, i = _node_guide_ids(n)
        if s:
            found_scene = s
        if i:
            found_intent = i

    if expect_scene:
        record(
            f"agent stamp scene ({label})",
            found_scene == expect_scene,
            f"got={found_scene or '-'} exit={exit_reason} types={sorted(types)[:6]} text={text[:80]!r}",
        )
    if expect_intent:
        record(
            f"agent stamp intent ({label})",
            found_intent == expect_intent,
            f"got={found_intent or '-'} exit={exit_reason} nodes={len(nodes)} text={text[:80]!r}",
        )


def main() -> int:
    print(f"BASE_URL={BASE}")
    print("Deploy target: Image Prompting Guide Catalog Fill (#278)\n")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("auth login", True)
    except Exception as exc:  # noqa: BLE001
        record("auth login", False, str(exc))
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1

    verify_prompt_api_accepts_guide_scene(tok)

    # Atomic create utterances (must include 帮我生成…) so runtime stamps guide ids on nodes
    verify_agent_taxonomy_stamp(
        tok,
        "g3",
        "帮我生成一个广告提示词，标语必须精确文字 Yours to Create，不要多余字",
        expect_scene="g3_exact_text",
        expect_intent=None,
    )
    verify_agent_taxonomy_stamp(
        tok,
        "e5",
        "帮我生成一张产品抠图透明底 PNG",
        expect_scene=None,
        expect_intent="e5_transparent_cutout",
    )
    verify_agent_taxonomy_stamp(
        tok,
        "g6",
        "帮我生成一组漫画分格，讲述机器人在雨夜寻找家的故事",
        expect_scene="g6_comic_strip",
        expect_intent=None,
    )
    verify_agent_taxonomy_stamp(
        tok,
        "e7",
        "帮我生成一张去物体并自然补全背景的图片",
        expect_scene=None,
        expect_intent="e7_remove_object",
    )

    print(f"\nPASS={PASS} FAIL={FAIL}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
