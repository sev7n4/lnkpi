#!/usr/bin/env python3
"""Production verify for PR #93 — W11 dual-channel (recordId + gen flow).

Usage:
  python3 deploy/prod-w11-verify.py
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
# Full gen (13 nodes) often exceeds 600s; proxy may close SSE before ``done``.
GEN_SSE_TIMEOUT_SEC = float(os.environ.get("GEN_SSE_TIMEOUT_SEC", "1200"))
GEN_CANVAS_POLL_SEC = float(os.environ.get("GEN_CANVAS_POLL_SEC", "300"))

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
) -> tuple[list[dict], str, set[str], str]:
    """Collect SSE until done/error/timeout. Returns (events, text, types, exit_reason)."""
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
    exit_reason = "timeout"
    # Socket timeout must cover the full stream window (not just first read).
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


def count_canvas_images(tok: str, sid: str) -> tuple[int, int]:
    """Return (images_with_url, nodes_with_generationRecordId)."""
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    nodes = (sess.get("canvasData") or {}).get("nodes") or []
    imgs = sum(1 for n in nodes if n.get("type") == "image" and (n.get("data") or {}).get("url"))
    rec_nodes = sum(1 for n in nodes if (n.get("data") or {}).get("generationRecordId"))
    return imgs, rec_nodes


def poll_canvas_after_sse(
    tok: str,
    sid: str,
    *,
    min_images: int = 1,
    timeout_sec: float = GEN_CANVAS_POLL_SEC,
    interval_sec: float = 15,
) -> tuple[int, int]:
    """Poll session canvas when SSE ends early; generation may still be running server-side."""
    deadline = time.time() + timeout_sec
    imgs = rec_nodes = 0
    while time.time() < deadline:
        try:
            imgs, rec_nodes = count_canvas_images(tok, sid)
            if imgs >= min_images:
                return imgs, rec_nodes
        except Exception:
            pass
        time.sleep(interval_sec)
    try:
        return count_canvas_images(tok, sid)
    except Exception:
        return imgs, rec_nodes


def evaluate_stream_done(
    types: set[str],
    events: list[dict],
    *,
    exit_reason: str,
    imgs: int,
    text: str,
) -> tuple[bool, bool, str]:
    """Returns (ok, skip, detail). skip=True when SSE closed early but canvas is authoritative."""
    if "done" in types or exit_reason in ("done", "done_marker"):
        return True, False, f"exit={exit_reason} types={sorted(types)}"
    if "task_summary" in types:
        return True, False, "task_summary terminal event"
    if "error" in types:
        return False, False, f"error in stream types={sorted(types)}"

    task_done = sum(
        1
        for e in events
        if e.get("type") == "task_update" and (e.get("data") or {}).get("status") == "done"
    )
    if imgs >= 1 and task_done >= 1:
        return True, True, (
            f"SSE ended ({exit_reason}) without done; "
            f"canvas authoritative task_done={task_done} imgs={imgs}"
        )
    if imgs >= 1 and ("task_update" in types or "开始按拓扑" in text):
        return True, True, (
            f"SSE ended ({exit_reason}) without done; partial stream imgs={imgs}"
        )
    return False, False, f"exit={exit_reason} types={sorted(types)} imgs={imgs}"


def main() -> int:
    print("=== PR #93 production verify (W11) ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")), f"latency={(rt.get('data') or {}).get('latencyMs')}ms")

    sid = http("POST", "/sessions", {"title": f"W11-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Setup session", True, sid)

    for name, msg in [
        ("plan", "天猫蓝牙耳机详情页，品牌 lnkpi，W11复测"),
        ("confirm", "1"),
        ("copy", "写入主文案"),
    ]:
        _, text, types, _ = sse_collect(tok, sid, msg, tid, timeout=420)
        record(f"step {name}", "error" not in types and len(text) > 0, text[:100].replace("\n", " "))

    events, text_gen, types_gen, exit_gen = sse_collect(
        tok, sid, "确认出图", tid, timeout=GEN_SSE_TIMEOUT_SEC
    )
    record("confirm gen", "出图成功" in text_gen or "开始按拓扑" in text_gen, text_gen[:120].replace("\n", " "))

    task_updates = [e for e in events if e.get("type") == "task_update"]
    with_record = [
        e for e in task_updates
        if isinstance((e.get("data") or {}).get("recordId"), str) and (e.get("data") or {}).get("recordId")
    ]
    record(
        "W11 task_update carries recordId",
        len(with_record) >= 1,
        f"task_updates={len(task_updates)} with_recordId={len(with_record)}",
    )

    imgs = rec_nodes = 0
    try:
        imgs, rec_nodes = count_canvas_images(tok, sid)
        if "done" not in types_gen and exit_gen in ("timeout", "eof"):
            polled_imgs, polled_rec = poll_canvas_after_sse(tok, sid)
            if polled_imgs > imgs:
                imgs, rec_nodes = polled_imgs, polled_rec
                record(
                    "canvas poll after SSE",
                    True,
                    f"imgs={imgs} rec_nodes={rec_nodes} (SSE exit={exit_gen})",
                )
    except Exception as exc:  # noqa: BLE001
        record("canvas after gen", False, str(exc))
    else:
        record("canvas images with url", imgs >= 1, f"images_with_url={imgs}")
        record("canvas nodes with generationRecordId", rec_nodes >= 1, f"nodes={rec_nodes}")

    stream_ok, stream_skip, stream_detail = evaluate_stream_done(
        types_gen,
        events,
        exit_reason=exit_gen,
        imgs=imgs,
        text=text_gen,
    )
    record("stream done", stream_ok, stream_detail, skip=stream_skip)

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
