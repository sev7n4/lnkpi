#!/usr/bin/env python3
"""Production smoke verify for P4 atomic_create_gate — image/text/prompt (A1 partial).

Checks per modality:
  - SSE atomic_create path (not campaign plan gate)
  - Canvas node created
  - Generation completes (record/content) or clear error

Video/audio confirm gates: deploy/prod-atomic-confirm-gate-verify.py

Usage:
  python3 deploy/prod-atomic-studio-verify.py
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

CASES: list[tuple[str, str, str]] = [
    ("image", "帮我生成一个模特人物图", "image"),
    ("text", "帮我写广告词，强调降噪", "text"),
    ("prompt", "帮我对「蓝牙耳机」做 prompt 扩写，出图用", "prompt"),
]

TURNAROUND_UTTERANCE = "山海经吞金兽的三视图，CG风格"


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


def latest_node(tok: str, sid: str, node_type: str) -> dict[str, Any] | None:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {}
    nodes = [n for n in (canvas.get("nodes") or []) if n.get("type") == node_type]
    return nodes[-1] if nodes else None


def verify_modality(tok: str, label: str, utterance: str, node_type: str) -> None:
    sid = http("POST", "/sessions", {"title": f"P4-{label}-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, types, exit_reason = sse_collect(tok, sid, utterance, tid, timeout=SSE_TIMEOUT_SEC)

    atomic_ok = "原子创作" in text and f"{node_type} 节点" in text
    not_campaign = "await_confirm" not in types and "拟定拆解约" not in text[:200]
    record(f"{label} atomic path", atomic_ok and not_campaign, text[:120])

    node = latest_node(tok, sid, node_type)
    data = (node or {}).get("data") or {}
    has_output = bool(
        data.get("generationRecordId")
        or data.get("url")
        or (node_type == "text" and str(data.get("content") or "").strip())
        or (node_type == "prompt" and str(data.get("prompt") or "").strip())
    )
    gen_ok = "生成完成" in text or has_output
    not_unsupported = "暂不支持" not in text
    record(
        f"{label} gen completed",
        gen_ok and not_unsupported and "error" not in types,
        f"exit={exit_reason} rec={data.get('generationRecordId')} content={'yes' if data.get('content') else 'no'}",
    )

    ts = thread_state(tok, tid)
    phase = ts.get("phase")
    next_nodes = ts.get("nextNodes") or []
    record(
        f"{label} not stuck at plan gate",
        "await_confirm" not in next_nodes and phase not in ("await_confirm",),
        f"phase={phase}",
    )


def verify_turnaround_pipeline(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"P4-turnaround-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, types, exit_reason = sse_collect(
        tok, sid, TURNAROUND_UTTERANCE, tid, timeout=SSE_TIMEOUT_SEC
    )

    record(
        "turnaround atomic path",
        "image 节点" in text and "2:1" in text,
        text[:160],
    )
    record(
        "turnaround light hint",
        "角色设定图" in text or "非账户默认" in text or "非默认" in text,
        text[:160],
    )

    node = latest_node(tok, sid, "image")
    data = (node or {}).get("data") or {}
    expanded = str(data.get("expandedPrompt") or data.get("content") or "")
    record(
        "turnaround expandedPrompt",
        "四格" in expanded,
        expanded[:120],
    )
    record(
        "turnaround promptMode",
        data.get("promptMode") == "character_turnaround",
        str(data.get("promptMode")),
    )

    rec_id = data.get("generationRecordId")
    aspect_ok = False
    if rec_id:
        rec = http("GET", f"/studio/generations/{rec_id}", t=tok).get("data") or {}
        try:
            meta = json.loads(rec.get("metadata") or "{}")
        except json.JSONDecodeError:
            meta = {}
        aspect_ok = meta.get("aspectRatio") == "2:1"
        prompt_used = str(rec.get("prompt") or "")
        record(
            "turnaround image prompt not raw utterance",
            "四格" in prompt_used,
            prompt_used[:100],
        )
    record(
        "turnaround aspect 2:1",
        aspect_ok,
        f"rec={rec_id} exit={exit_reason}",
    )


def main() -> int:
    print("=== P4 atomic_create production smoke verify (image/text/prompt) ===")
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

    for label, utterance, node_type in CASES:
        verify_modality(tok, label, utterance, node_type)

    verify_turnaround_pipeline(tok)

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
