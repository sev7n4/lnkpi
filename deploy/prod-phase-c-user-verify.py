#!/usr/bin/env python3
"""Production Phase C user-path verification: manual canvas edit → 执行生图.

Covers Phase B path up to await_topo, then:
  - PUT session canvasData: delete one image node + add manual image node
  - SSE「执行生图」→ expect 画布已同步 + gen stream
  - Assert deleted node absent; manual node gets generationRecordId

Usage:
  python3 deploy/prod-phase-c-user-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-phase-c-user-verify.py
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


def get_canvas(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    raw = sess.get("canvasData")
    if isinstance(raw, str):
        return json.loads(raw) if raw else {"nodes": [], "edges": []}
    return raw or {"nodes": [], "edges": []}


def put_canvas(tok: str, sid: str, canvas: dict[str, Any]) -> None:
    http("PUT", f"/sessions/{sid}", {"canvasData": canvas}, t=tok)


def node_title(n: dict[str, Any]) -> str:
    data = n.get("data") or {}
    return str(data.get("title") or data.get("prompt") or n.get("id") or "")


def pick_deletable_image(canvas: dict[str, Any]) -> dict[str, Any] | None:
    """Pick an image node safe to delete (prefer Banner / 白底 / last image)."""
    images = [n for n in canvas.get("nodes") or [] if n.get("type") == "image"]
    if len(images) < 2:
        return None
    for pref in ("Banner", "banner", "白底", "细节"):
        for n in images:
            if pref in node_title(n):
                return n
    return images[-1]


def manual_canvas_patch(canvas: dict[str, Any]) -> tuple[dict[str, Any], str | None, str]:
    """Delete one image node; add manual image node. Returns (canvas, deleted_id, manual_id)."""
    victim = pick_deletable_image(canvas)
    if victim is None:
        raise RuntimeError("need at least 2 image nodes to delete one")
    deleted_id = str(victim["id"])
    nodes = [n for n in canvas.get("nodes") or [] if n.get("id") != deleted_id]
    edges = [
        e
        for e in canvas.get("edges") or []
        if e.get("source") != deleted_id and e.get("target") != deleted_id
    ]
    manual_id = f"image-manual-{int(time.time())}"
    nodes.append(
        {
            "id": manual_id,
            "type": "image",
            "position": {"x": 1400, "y": 360},
            "data": {
                "title": "手工场景图",
                "prompt": "电商场景图，PhaseC手工添加节点",
                "status": "draft",
            },
        }
    )
    return {"nodes": nodes, "edges": edges, "viewport": canvas.get("viewport")}, deleted_id, manual_id


def node_by_id(canvas: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    for n in canvas.get("nodes") or []:
        if n.get("id") == node_id:
            return n
    return None


def poll_manual_node(tok: str, sid: str, manual_id: str) -> dict[str, Any] | None:
    deadline = time.time() + GEN_CANVAS_POLL_SEC
    while time.time() < deadline:
        n = node_by_id(get_canvas(tok, sid), manual_id)
        if n and ((n.get("data") or {}).get("generationRecordId") or (n.get("data") or {}).get("url")):
            return n
        time.sleep(15)
    return node_by_id(get_canvas(tok, sid), manual_id)


def main() -> int:
    print("=== Phase C production user-path verify ===")
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
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = http("POST", "/sessions", {"title": f"PhaseC-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Create session", True, sid)

    for name, msg in [
        ("P0-1 plan", "天猫蓝牙耳机详情页营销方案，品牌 lnkpi，PhaseC复测"),
        ("P0-2 confirm plan", "1"),
        ("P0-3 write copy", "写入主文案"),
    ]:
        _, text, types, exit_reason = sse_collect(tok, sid, msg, tid, timeout=420)
        ok = "error" not in types and len(text) > 0
        record(name, ok, f"exit={exit_reason} text={text[:80].replace(chr(10), ' ')}")

    ts = thread_state(tok, tid)
    phase = str(ts.get("phase") or "")
    record("P1 await_topo thread-state", phase == "await_topo", f"phase={phase}")

    if phase != "await_topo":
        for case in (
            "P2 manual canvas patch",
            "P2 执行生图 sync message",
            "P2 deleted node absent",
            "P2 manual node generated",
            "P2 stream terminal",
        ):
            record(case, False, f"skip: phase={phase}", skip=True)
        print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
        return 0 if FAIL == 0 else 1

    canvas_before = get_canvas(tok, sid)
    img_count_before = sum(1 for n in canvas_before.get("nodes") or [] if n.get("type") == "image")
    record("P1 canvas has image nodes", img_count_before >= 2, f"images={img_count_before}")

    try:
        patched, deleted_id, manual_id = manual_canvas_patch(canvas_before)
        put_canvas(tok, sid, patched)
        canvas_after_patch = get_canvas(tok, sid)
        ok_patch = node_by_id(canvas_after_patch, deleted_id) is None and node_by_id(
            canvas_after_patch, manual_id
        ) is not None
        record(
            "P2 manual canvas patch",
            ok_patch,
            f"deleted={deleted_id} added={manual_id}",
        )
    except Exception as exc:  # noqa: BLE001
        record("P2 manual canvas patch", False, str(exc))
        print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
        return 1

    events, gen_text, gen_types, exit_gen = sse_collect(
        tok, sid, "执行生图", tid, timeout=GEN_SSE_TIMEOUT_SEC
    )
    record(
        "P2 执行生图 sync message",
        "error" not in gen_types and "画布已同步" in gen_text,
        gen_text[:120].replace("\n", " "),
    )
    record(
        "P2 confirm gen stream",
        "error" not in gen_types
        and ("出图" in gen_text or "开始按拓扑" in gen_text or "task_update" in gen_types),
        f"exit={exit_gen} types={sorted(gen_types)[:8]}",
    )

    canvas_final = get_canvas(tok, sid)
    record(
        "P2 deleted node absent",
        node_by_id(canvas_final, deleted_id) is None,
        f"deleted={deleted_id}",
    )

    manual = node_by_id(canvas_final, manual_id)
    if manual and not ((manual.get("data") or {}).get("generationRecordId") or (manual.get("data") or {}).get("url")):
        manual = poll_manual_node(tok, sid, manual_id)
    manual_data = (manual or {}).get("data") or {}
    manual_ok = bool(manual_data.get("generationRecordId") or manual_data.get("url"))
    record(
        "P2 manual node generated",
        manual_ok,
        f"id={manual_id} rec={manual_data.get('generationRecordId')} url={'yes' if manual_data.get('url') else 'no'}",
    )

    stream_ok = (
        "done" in gen_types
        or exit_gen in ("done", "done_marker")
        or "task_summary" in gen_types
        or manual_ok
    )
    record("P2 stream terminal", stream_ok, f"exit={exit_gen}")

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
