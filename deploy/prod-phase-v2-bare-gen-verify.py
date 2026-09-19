#!/usr/bin/env python3
"""Production V2/B9 verify — bare gen must upsert + propose + pending_confirm.

Does not replace deploy/prod-phase-2d3-h8-verify.py (2d.3 no-charge regression).

Usage:
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3.11 deploy/prod-phase-v2-bare-gen-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT = float(os.environ.get("V2_SSE_TIMEOUT", "180"))
GOLD = "帮我生成一张蓝色天空产品主图"

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
        line += f" — {detail[:300]}"
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
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read() or b"{}")


def sse_chat(tok: str, sid: str, msg: str, tid: str, *, model: str | None = None, timeout: float = 180) -> dict[str, Any]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if model:
        body["model"] = model
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"v2_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    steps: list[str] = []
    tool_names: list[str] = []
    routes: list[dict] = []
    canvas_actions: list[dict] = []
    parts: list[str] = []
    saw_done = False
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
                    if saw_done:
                        break
                    time.sleep(0.2)
                    continue
                if not chunk:
                    if saw_done:
                        break
                    time.sleep(0.2)
                    continue
                buf += chunk.decode(errors="replace")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    for line in block.splitlines():
                        if not line.startswith("data:"):
                            continue
                        pl = line[5:].strip()
                        if pl == "[DONE]":
                            saw_done = True
                            break
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        events.append(ev)
                        et = str(ev.get("type") or "")
                        types.add(et)
                        data = ev.get("data") or {}
                        if et == "text_delta":
                            parts.append(str(data.get("text") or ""))
                        if et == "text_replace":
                            parts = [str(data.get("text") or "")]
                        if et == "step":
                            node_id = str((data.get("id") if isinstance(data, dict) else "") or "")
                            steps.append(node_id.replace("node:", ""))
                        if et == "tool_call":
                            name = str(
                                data.get("name") or data.get("tool") or data.get("toolName") or ""
                            )
                            if name:
                                tool_names.append(name)
                        if et == "route_decision":
                            rd = data.get("route_decision") if isinstance(data, dict) else None
                            if isinstance(rd, dict):
                                routes.append(rd)
                            elif isinstance(data, dict):
                                routes.append(data)
                        if et == "canvas_action" and isinstance(data, dict):
                            canvas_actions.append(data)
                        if et in ("done", "error"):
                            if et == "error":
                                parts.append(f"[ERROR: {data}]")
                            saw_done = True
                            break
                    if saw_done:
                        break
                if saw_done:
                    break
        except IncompleteRead:
            pass
    text = parts[-1] if len(parts) == 1 and parts[0] else "".join(parts)
    flow = routes[-1].get("flow_mode") if routes else None
    pending = False
    billed = False
    for a in canvas_actions:
        payload = a.get("payload") or a.get("data") or a
        if not isinstance(payload, dict):
            continue
        inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        st = str(inner.get("status") or payload.get("status") or "")
        if st == "pending_confirm":
            pending = True
        if st in ("completed", "running", "generating", "success"):
            billed = True
    return {
        "text": text,
        "steps": steps,
        "tools": tool_names,
        "flow_mode": flow,
        "pending_via_actions": pending,
        "billed_via_actions": billed,
        "no_run_tools": "run_image_generation" not in tool_names
        and "run_video_generation" not in tool_names,
        "saw_done": saw_done,
    }


def load_canvas(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)
    data = sess.get("data") or sess
    raw = data.get("canvasData") or data.get("canvas") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def pending_ids(canvas: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for n in canvas.get("nodes") or []:
        st = str((n.get("data") or {}).get("status") or "")
        if st == "pending_confirm":
            out.append(str(n.get("id")))
    return out


def main() -> int:
    print("=== V2 bare-gen propose production verify ===")
    print(f"BASE={BASE}\n")
    health = http("GET", "/health")
    record("Nest health", bool(health.get("ok")), str(health)[:120])
    rt = http("GET", "/agent/runtime-health")
    record("Runtime health", bool((rt.get("data") or {}).get("ok")), str((rt.get("data") or {}).get("latencyMs")))
    login = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})
    tok = (login.get("data") or {}).get("token")
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    model = os.environ.get("HARNESS_MODEL", "").strip() or None
    if not model:
        boot = http("GET", "/provider/bootstrap", t=tok)
        model = ((boot.get("data") or {}).get("preferences") or {}).get("defaultTextModel") or None
    record("Agent model", bool(model), str(model))
    canvas = http("POST", "/agent/canvas/create", {"title": f"v2-bare-{uuid.uuid4().hex[:6]}"}, tok)
    sid = (canvas.get("data") or {}).get("id") or (canvas.get("data") or {}).get("sessionId")
    record("Canvas session", bool(sid), str(sid))
    if not sid:
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    try:
        r = sse_chat(tok, str(sid), GOLD, f"t_v2_{uuid.uuid4().hex[:8]}", model=model, timeout=SSE_TIMEOUT)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("P7 gold turn completes", False, str(exc))
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    record("P7 flow_mode=canvas_agent", r["flow_mode"] == "canvas_agent", f"flow={r['flow_mode']}")
    record(
        "P7 tool_call upsert then propose",
        "upsert_media_node" in r["tools"]
        and "propose_generation" in r["tools"]
        and r["tools"].index("upsert_media_node") < r["tools"].index("propose_generation"),
        f"tools={r['tools'][:12]}",
    )
    time.sleep(1.0)
    pids = pending_ids(load_canvas(tok, str(sid)))
    record(
        "P7 pending_confirm on canvas",
        bool(pids) or r["pending_via_actions"],
        f"pendingIds={pids[:3]} via_actions={r['pending_via_actions']}",
    )
    record("P7 no run_* tools", r["no_run_tools"], f"tools={r['tools'][:8]}")
    record("P7 no billed complete before confirm", not r["billed_via_actions"], f"billed={r['billed_via_actions']}")
    print(f"\nPASS={PASS} FAIL={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        raise SystemExit(2)
