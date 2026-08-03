#!/usr/bin/env python3
"""Production Phase B user-path verification: await_topo → topo ops → confirm gen.

Covers Phase A plan/confirm plus:
  - await_topo gate (thread-state phase)
  - topo_revise query/add (optional delete via TOPO_DELETE=1)
  - confirm_gen + gen SSE + canvas poll

Usage:
  python3 deploy/prod-phase-b-user-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-phase-b-user-verify.py
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
GEN_SSE_TIMEOUT_SEC = float(os.environ.get("GEN_SSE_TIMEOUT_SEC", "900"))
GEN_CANVAS_POLL_SEC = float(os.environ.get("GEN_CANVAS_POLL_SEC", "300"))
TOPO_DELETE = os.environ.get("TOPO_DELETE", "0") == "1"

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
) -> tuple[list[dict], str, set[str], str]:
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


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}


def count_canvas_images(tok: str, sid: str) -> tuple[int, int]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    nodes = (sess.get("canvasData") or {}).get("nodes") or []
    imgs = sum(1 for n in nodes if n.get("type") == "image" and (n.get("data") or {}).get("url"))
    rec_nodes = sum(1 for n in nodes if (n.get("data") or {}).get("generationRecordId"))
    return imgs, rec_nodes


def poll_canvas_after_sse(tok: str, sid: str, *, min_images: int = 1) -> tuple[int, int]:
    deadline = time.time() + GEN_CANVAS_POLL_SEC
    imgs = rec_nodes = 0
    while time.time() < deadline:
        try:
            imgs, rec_nodes = count_canvas_images(tok, sid)
            if imgs >= min_images:
                return imgs, rec_nodes
        except Exception:
            pass
        time.sleep(15)
    return count_canvas_images(tok, sid)


def main() -> int:
    print("=== Phase B production user-path verify ===")
    print(f"BASE={BASE}  TOPO_DELETE={TOPO_DELETE}\n")

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
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = http("POST", "/sessions", {"title": f"PhaseB-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Create session", True, sid)

    steps = [
        ("P0-1 plan", "天猫蓝牙耳机详情页营销方案，品牌 lnkpi，PhaseB复测"),
        ("P0-2 confirm plan", "1"),
    ]
    for name, msg in steps:
        _, text, types, exit_reason = sse_collect(tok, sid, msg, tid, timeout=420)
        ok = "error" not in types and len(text) > 0
        record(name, ok, f"exit={exit_reason} text={text[:80].replace(chr(10), ' ')}")

    ts = thread_state(tok, tid)
    phase = str(ts.get("phase") or "")
    record(
        "P1 await_topo thread-state",
        phase in ("await_topo", "await_confirm", "split") or "确认出图" in json.dumps(ts),
        f"phase={phase} interrupted={ts.get('interrupted')}",
    )

    _, qtext, qtypes, _ = sse_collect(tok, sid, "查看主图", tid, timeout=120)
    record(
        "P1 topo query",
        "error" not in qtypes and ("节点" in qtext or "主图" in qtext or "prompt" in qtext.lower()),
        qtext[:100].replace("\n", " "),
    )

    _, add_text, add_types, _ = sse_collect(tok, sid, "增加场景图", tid, timeout=180)
    record(
        "P1 topo add",
        "error" not in add_types and ("新增" in add_text or "场景" in add_text or "资产拓扑" in add_text),
        add_text[:100].replace("\n", " "),
    )

    if TOPO_DELETE:
        _, del_text, del_types, _ = sse_collect(tok, sid, "删掉 Banner", tid, timeout=180)
        record(
            "P1 topo delete (optional)",
            "error" not in del_types and ("移除" in del_text or "未找到" in del_text or "资产拓扑" in del_text),
            del_text[:100].replace("\n", " "),
        )

    events, gen_text, gen_types, exit_gen = sse_collect(
        tok, sid, "确认出图", tid, timeout=GEN_SSE_TIMEOUT_SEC
    )
    record(
        "P2 confirm gen stream",
        "error" not in gen_types
        and ("出图" in gen_text or "开始按拓扑" in gen_text or "task_update" in gen_types),
        f"exit={exit_gen} types={sorted(gen_types)[:8]}",
    )

    imgs, rec_nodes = count_canvas_images(tok, sid)
    if "done" not in gen_types and exit_gen in ("timeout", "eof"):
        polled_imgs, polled_rec = poll_canvas_after_sse(tok, sid)
        if polled_imgs > imgs:
            imgs, rec_nodes = polled_imgs, polled_rec
            record("P2 canvas poll after SSE", True, f"imgs={imgs} rec_nodes={rec_nodes}")
    record("P2 canvas images with url", imgs >= 1, f"images_with_url={imgs}")
    record("P2 canvas generationRecordId", rec_nodes >= 1, f"nodes={rec_nodes}")

    stream_ok = (
        "done" in gen_types
        or exit_gen in ("done", "done_marker")
        or "task_summary" in gen_types
        or imgs >= 1
    )
    record("P2 stream/gen terminal", stream_ok, f"exit={exit_gen} imgs={imgs}")

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
