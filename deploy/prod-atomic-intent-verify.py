#!/usr/bin/env python3
"""Prod smoke: Phase 1 atomic intent — regenerate phrase + multi-image create.

Cases:
  A) create →「重新生成一张」→ same node count, regen path
  B) multi-image enumerated → 3 nodes on canvas
  C) create →「重新生成一张，背景改成白色」→ new node (count +1)
  D) create →「按刚才那个风格再生成一张」→ new node (count +1)

Reuse SSE helpers from prod-atomic-regenerate-verify.py.
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


def run_regenerate_phrase_smoke(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"intent-regen-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"iregen_{uuid.uuid4().hex[:8]}"
    record("Regen session", True, f"sid={sid}")

    _, text1, types1, exit1 = sse_collect(
        tok, sid, "帮我生成一个模特人物图", tid, timeout=SSE_TIMEOUT_SEC
    )
    atomic_ok = "原子创作" in text1 and "image 节点" in text1
    record("Regen Turn1 atomic", atomic_ok and "error" not in types1, text1[:100])

    nodes1 = image_nodes(tok, sid)
    count1 = len(nodes1)
    record("Regen Turn1 node exists", count1 >= 1, f"nodes={count1} exit={exit1}")

    _, text2, types2, exit2 = sse_collect(
        tok, sid, "重新生成一张", tid, timeout=SSE_TIMEOUT_SEC
    )
    nodes2 = image_nodes(tok, sid)
    regen_ok = (
        len(nodes2) == count1
        and ("重新生成" in text2 or "生成完成" in text2)
        and "await_confirm" not in types2
        and "拟定拆解约" not in text2[:200]
        and "error" not in types2
    )
    record("Regen Turn2 phrase path", regen_ok, f"text={text2[:120]} exit={exit2}")

    ts2 = thread_state(tok, tid)
    record(
        "Regen Turn2 not plan gate",
        "await_confirm" not in (ts2.get("nextNodes") or []),
        f"phase={ts2.get('phase')}",
    )


def run_multi_image_smoke(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"intent-multi-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"imulti_{uuid.uuid4().hex[:8]}"
    msg = "帮我生成三张图，分别是蓝牙耳机主图、白底图、三视图。"
    record("Multi session", True, f"sid={sid}")

    _, text, types, exit_reason = sse_collect(tok, sid, msg, tid, timeout=SSE_TIMEOUT_SEC)
    multi_text_ok = "3 张 image 节点" in text or "3 个 image 节点" in text or "已完成 3 张" in text
    not_campaign = "await_confirm" not in types and "拟定拆解约" not in text[:200]
    record("Multi atomic path", multi_text_ok and not_campaign, text[:140])

    nodes = image_nodes(tok, sid)
    record("Multi 3 nodes on canvas", len(nodes) >= 3, f"count={len(nodes)} exit={exit_reason}")

    titles = {str((n.get("data") or {}).get("title") or n.get("title") or "") for n in nodes}
    expected_bits = ("主图", "白底", "三视图")
    title_hit = sum(1 for bit in expected_bits if any(bit in t for t in titles))
    record("Multi expected titles", title_hit >= 2, f"titles={list(titles)[:6]}")


def run_variant_new_node_smoke(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"intent-variant-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"ivariant_{uuid.uuid4().hex[:8]}"
    record("Variant session", True, f"sid={sid}")

    _, text1, types1, exit1 = sse_collect(
        tok, sid, "帮我生成一个模特人物图", tid, timeout=SSE_TIMEOUT_SEC
    )
    record("Variant Turn1 atomic", "原子创作" in text1 and "error" not in types1, text1[:100])

    count1 = len(image_nodes(tok, sid))
    record("Variant Turn1 one node", count1 >= 1, f"nodes={count1} exit={exit1}")

    _, text2, types2, exit2 = sse_collect(
        tok, sid, "重新生成一张，背景改成白色", tid, timeout=SSE_TIMEOUT_SEC
    )
    count2 = len(image_nodes(tok, sid))
    adjust_ok = (
        count2 > count1
        and ("已创建" in text2 or "image 节点" in text2 or "生成完成" in text2)
        and "await_confirm" not in types2
        and "error" not in types2
    )
    record("Variant Turn2 adjust new node", adjust_ok, f"nodes {count1}->{count2} text={text2[:120]} exit={exit2}")

    _, text3, types3, exit3 = sse_collect(
        tok, sid, "按刚才那个风格再生成一张", tid, timeout=SSE_TIMEOUT_SEC
    )
    count3 = len(image_nodes(tok, sid))
    style_ok = (
        count3 > count2
        and ("已创建" in text3 or "image 节点" in text3 or "生成完成" in text3)
        and "await_confirm" not in types3
        and "error" not in types3
    )
    record("Variant Turn3 style new node", style_ok, f"nodes {count2}->{count3} text={text3[:120]} exit={exit3}")


def run_clarify_smoke(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"intent-clarify-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"iclari_{uuid.uuid4().hex[:8]}"
    _, text, types, _ = sse_collect(tok, sid, "帮我生成", tid, timeout=SSE_TIMEOUT_SEC)
    nodes = image_nodes(tok, sid)
    clarify_markers = (
        "不确定",
        "有误",
        "描述",
        "请说明",
        "请补充",
        "clarify",
        "例如",
    )
    ok = len(nodes) == 0 and any(m in text for m in clarify_markers)
    record("Clarify vague utterance", ok and "error" not in types, text[:120])


def main() -> int:
    print("=== Prod smoke: atomic intent (regen + multi + variant new node) ===")
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

    run_regenerate_phrase_smoke(tok)
    run_multi_image_smoke(tok)
    run_variant_new_node_smoke(tok)
    run_clarify_smoke(tok)

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
