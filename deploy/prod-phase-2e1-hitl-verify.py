#!/usr/bin/env python3
"""Production 2e.1 HITL verify — setup / cancel / assert-started.

Does not replace deploy/prod-phase-v2-bare-gen-verify.py (P7 unchanged).
Does not click the confirm chip and does not POST /studio/image/generate.
E2 remains a browser click of [data-testid=generation-propose-confirm].

Usage:
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3.11 deploy/prod-phase-2e1-hitl-verify.py setup
  python3.11 deploy/prod-phase-2e1-hitl-verify.py cancel
  2E1_SESSION=... 2E1_NODE=... python3.11 deploy/prod-phase-2e1-hitl-verify.py assert-started
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
        "Idempotency-Key": f"2e1_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    tool_names: list[str] = []
    routes: list[dict] = []
    canvas_actions: list[dict] = []
    parts: list[str] = []
    saw_done = False
    billed = False
    pending = False
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
                        data = ev.get("data") or {}
                        if et == "text_delta":
                            parts.append(str(data.get("text") or ""))
                        if et == "text_replace":
                            parts = [str(data.get("text") or "")]
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
                            payload = data.get("payload") or data.get("data") or data
                            inner = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else payload
                            if isinstance(inner, dict):
                                st = str(inner.get("status") or payload.get("status") or "")
                                if st == "pending_confirm":
                                    pending = True
                                if st in ("completed", "running", "generating", "success"):
                                    billed = True
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
    flow = routes[-1].get("flow_mode") if routes else None
    return {
        "tools": tool_names,
        "flow_mode": flow,
        "pending_via_actions": pending,
        "billed_via_actions": billed,
        "no_run_tools": "run_image_generation" not in tool_names
        and "run_video_generation" not in tool_names,
        "saw_done": saw_done,
    }


def login() -> tuple[str, str | None]:
    login_res = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})
    tok = (login_res.get("data") or {}).get("token")
    if not tok:
        return "", None
    model = os.environ.get("HARNESS_MODEL", "").strip() or None
    if not model:
        boot = http("GET", "/provider/bootstrap", t=tok)
        model = ((boot.get("data") or {}).get("preferences") or {}).get("defaultTextModel") or None
    return str(tok), model


def new_session(tok: str) -> str:
    canvas = http("POST", "/agent/canvas/create", {"title": f"2e1-{uuid.uuid4().hex[:6]}"}, tok)
    sid = (canvas.get("data") or {}).get("id") or (canvas.get("data") or {}).get("sessionId")
    return str(sid or "")


def load_canvas(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)
    data = sess.get("data") or sess
    raw = data.get("canvasData") or data.get("canvas") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def pending_nodes(canvas: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in canvas.get("nodes") or []:
        st = str((n.get("data") or {}).get("status") or "")
        if st == "pending_confirm":
            out.append(n)
    return out


def node_by_id(canvas: dict[str, Any], node_id: str) -> dict[str, Any] | None:
    for n in canvas.get("nodes") or []:
        if str(n.get("id")) == node_id:
            return n
    return None


def gold_turn(tok: str, sid: str, model: str | None) -> dict[str, Any]:
    return sse_chat(tok, sid, GOLD, f"t_2e1_{uuid.uuid4().hex[:8]}", model=model, timeout=SSE_TIMEOUT)


def cmd_setup() -> int:
    print("=== 2e.1 HITL setup (stop at pending_confirm; do not confirm) ===")
    print(f"BASE={BASE}\n")
    tok, model = login()
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        return 1
    sid = new_session(tok)
    record("Canvas session", bool(sid), sid)
    if not sid:
        return 1
    try:
        r = gold_turn(tok, sid, model)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("E1 gold turn completes", False, str(exc))
        return 1
    record("E1 flow_mode=canvas_agent", r["flow_mode"] == "canvas_agent", f"flow={r['flow_mode']}")
    record(
        "E1 tool_call upsert then propose",
        "upsert_media_node" in r["tools"]
        and "propose_generation" in r["tools"]
        and r["tools"].index("upsert_media_node") < r["tools"].index("propose_generation"),
        f"tools={r['tools'][:12]}",
    )
    record("E1 no run_* tools", r["no_run_tools"], f"tools={r['tools'][:8]}")
    record("E1 no billed complete before confirm", not r["billed_via_actions"], f"billed={r['billed_via_actions']}")
    time.sleep(1.0)
    pnodes = pending_nodes(load_canvas(tok, sid))
    nid = str(pnodes[0].get("id")) if pnodes else ""
    record("E1 pending_confirm on canvas", bool(nid) or r["pending_via_actions"], f"node={nid}")
    url = f"{BASE}/workflow/{sid}"
    print(f"\n2E1_SESSION={sid}")
    print(f"2E1_NODE={nid}")
    print(f"2E1_CANVAS_URL={url}")
    print("E2 next: open that URL, click [data-testid=generation-propose-confirm], then run assert-started")
    return 1 if FAIL else 0


def cmd_cancel() -> int:
    print("=== 2e.1 HITL cancel (E4; no studio) ===")
    print(f"BASE={BASE}\n")
    tok, model = login()
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        return 1
    sid = new_session(tok)
    record("Canvas session", bool(sid), sid)
    if not sid:
        return 1
    try:
        r = gold_turn(tok, sid, model)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("Cancel-session gold turn", False, str(exc))
        return 1
    record("Cancel-session no run_*", r["no_run_tools"], f"tools={r['tools'][:8]}")
    time.sleep(1.0)
    pnodes = pending_nodes(load_canvas(tok, sid))
    nid = str(pnodes[0].get("id")) if pnodes else ""
    record("Cancel-session pending_confirm", bool(nid), f"node={nid}")
    if not nid:
        return 1
    cleared = http("POST", "/agent/clear-propose", {"sessionId": sid, "nodeId": nid}, tok)
    data = cleared.get("data") or {}
    record("E4 clear-propose status=draft", data.get("status") == "draft", str(data)[:200])
    node = node_by_id(load_canvas(tok, sid), nid) or {}
    nd = node.get("data") or {}
    record("E4 canvas node is draft", str(nd.get("status") or "") == "draft", f"status={nd.get('status')}")
    record(
        "E4 no generationRecordId after cancel",
        not nd.get("generationRecordId"),
        f"generationRecordId={nd.get('generationRecordId')}",
    )
    return 1 if FAIL else 0


def cmd_assert_started() -> int:
    print("=== 2e.1 HITL assert-started (after browser confirm click) ===")
    sid = os.environ.get("2E1_SESSION", "").strip()
    nid = os.environ.get("2E1_NODE", "").strip()
    record("2E1_SESSION set", bool(sid), sid)
    record("2E1_NODE set", bool(nid), nid)
    if not sid or not nid:
        return 1
    tok, _model = login()
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        return 1
    node = node_by_id(load_canvas(tok, sid), nid) or {}
    nd = node.get("data") or {}
    st = str(nd.get("status") or "")
    rid = nd.get("generationRecordId")
    started = st in ("generating", "completed", "fallback_pending") or bool(rid)
    record(
        "E2 generate started (not silent click)",
        started and st != "pending_confirm",
        f"status={st} generationRecordId={rid}",
    )
    record("E2 left pending_confirm", st != "pending_confirm", f"status={st}")
    record("E2 is not draft-without-record", not (st == "draft" and not rid), f"status={st} rid={rid}")
    return 1 if FAIL else 0


def main() -> int:
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if cmd not in {"setup", "cancel", "assert-started"}:
        print("usage: prod-phase-2e1-hitl-verify.py setup|cancel|assert-started", file=sys.stderr)
        return 2
    if cmd == "setup":
        return cmd_setup()
    if cmd == "cancel":
        return cmd_cancel()
    return cmd_assert_started()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        raise SystemExit(2)
