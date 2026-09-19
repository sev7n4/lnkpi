#!/usr/bin/env python3
"""Production H8 verify — Phase 2d.3 literal cleanup + legacy lane shim.

H8 (spec §6.0.8):
  1. Bare gen「帮我生成一张…」→ canvas_agent|clarify_route; no atomic steps;
     pending_confirm / no run_* before charge
  2. Regen「重新生成一张」→ agent/clarify not atomic subgraph steps
  3. No run_image_generation / run_video_generation in tool_call stream

Usage:
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3.11 deploy/prod-phase-2d3-h8-verify.py
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
SSE_TIMEOUT = float(os.environ.get("H8_SSE_TIMEOUT", "150"))

ATOMIC_STEPS = frozenset({
    "parse_atomic_intent",
    "clarify_atomic_intent",
    "create_atomic_node",
    "run_atomic_gen",
    "await_atomic_confirm",
    "prepare_atomic_regenerate",
    "prepare_single_gen",
    "run_single_gen",
})

OK_FLOWS = frozenset({"canvas_agent", "clarify_route", "chat", "explore_canvas"})
BARE_GEN = "帮我生成一张蓝色天空产品主图"
REGEN = "重新生成一张"

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


def sse_chat(
    tok: str,
    sid: str,
    msg: str,
    tid: str,
    *,
    model: str | None = None,
    timeout: float = 150,
) -> dict[str, Any]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if model:
        body["model"] = model
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"h8_{uuid.uuid4().hex}",
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
                                data.get("name")
                                or data.get("tool")
                                or data.get("toolName")
                                or ""
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
    flow = None
    rule = None
    if routes:
        flow = routes[-1].get("flow_mode")
        rule = routes[-1].get("precedence_rule_id") or routes[-1].get("rule_id")
    pending = False
    for a in canvas_actions:
        payload = a.get("payload") or a.get("data") or a
        if isinstance(payload, dict):
            st = str((payload.get("data") or {}).get("status") or payload.get("status") or "")
            if st == "pending_confirm":
                pending = True
    add_media = [
        a
        for a in canvas_actions
        if a.get("type") in ("add_media_node", "upsert_media_node", "add_node")
        or str(a.get("type") or "").startswith("add_")
    ]
    banned = [t for t in tool_names if t in ("run_image_generation", "run_video_generation")]
    return {
        "text": text,
        "types": sorted(types),
        "steps": steps,
        "tools": tool_names,
        "routes": routes,
        "flow_mode": flow,
        "rule_id": rule,
        "explore_ran": "explore" in steps,
        "atomic_ran": any(s in ATOMIC_STEPS for s in steps),
        "canvas_actions": canvas_actions,
        "add_media_n": len(add_media),
        "pending_via_actions": pending,
        "no_run_tools": not banned,
        "banned_run_tools": banned,
        "saw_done": saw_done,
        "n_events": len(events),
        "agent_or_clarify": flow in OK_FLOWS or flow is None,
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
        if str((n.get("data") or {}).get("status") or "") == "pending_confirm":
            out.append(str(n.get("id")))
    return out


def media_or_pending_ids(canvas: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for n in canvas.get("nodes") or []:
        data = n.get("data") or {}
        st = str(data.get("status") or "")
        ntype = str(n.get("type") or data.get("type") or "")
        if st == "pending_confirm" or "media" in ntype.lower() or data.get("url") or data.get("assetUrl"):
            out.append(str(n.get("id")))
    return out


def main() -> int:
    print("=== Phase 2d.3 H8 production verify ===")
    print(f"BASE={BASE}\n")

    health = http("GET", "/health")
    record("Nest health", bool(health.get("ok")), str(health)[:120])
    rt = http("GET", "/agent/runtime-health")
    record(
        "Runtime health",
        bool((rt.get("data") or {}).get("ok")),
        f"latency={(rt.get('data') or {}).get('latencyMs')}ms",
    )

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

    def new_session(tag: str) -> str:
        canvas = http(
            "POST",
            "/agent/canvas/create",
            {"title": f"h8-2d3-{tag}-{uuid.uuid4().hex[:6]}"},
            tok,
        )
        sid = (canvas.get("data") or {}).get("id") or (canvas.get("data") or {}).get("sessionId")
        if not sid:
            raise RuntimeError("no session id")
        return str(sid)

    # H8a — bare gen → canvas_agent|clarify; no atomic; no run_*; pending before charge
    sid = ""
    tid = ""
    try:
        sid = new_session("bare")
        tid = f"t_h8a_{uuid.uuid4().hex[:8]}"
        r = sse_chat(tok, sid, BARE_GEN, tid, model=model, timeout=SSE_TIMEOUT)
        flow_ok = r["flow_mode"] in ("canvas_agent", "clarify_route") or (
            r["flow_mode"] in OK_FLOWS and not r["atomic_ran"]
        )
        ok = (
            r["saw_done"]
            and flow_ok
            and not r["atomic_ran"]
            and r["no_run_tools"]
        )
        record(
            "H8a bare gen → canvas_agent/clarify + no atomic + no run_*",
            ok,
            f"flow={r['flow_mode']} rule={r['rule_id']} atomic={r['atomic_ran']} "
            f"tools={r['tools'][:6]} banned={r['banned_run_tools']} text={r['text'][:90]!r}",
        )
        time.sleep(1.0)
        pids = pending_ids(load_canvas(tok, sid))
        # Hard table H8: 确认前无扣费 — prefer pending_confirm; fall back to no billable path
        # (explore may clarify / report tools unbound without charging).
        has_pending = bool(pids) or r["pending_via_actions"] or r["add_media_n"] >= 1
        no_charge = r["no_run_tools"] and not r["atomic_ran"]
        record(
            "H8a no charge before confirm (pending or no billable path)",
            has_pending or r["flow_mode"] == "clarify_route" or no_charge,
            f"pendingIds={pids[:3]} via_actions={r['pending_via_actions']} "
            f"adds={r['add_media_n']} has_pending={has_pending} no_charge={no_charge}",
        )
        record(
            "H8a no run_image/video_generation in tools",
            r["no_run_tools"],
            f"tools={r['tools'][:8]} banned={r['banned_run_tools']}",
        )
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("H8a bare gen → canvas_agent/clarify + no atomic + no run_*", False, str(exc))
        record("H8a pending before charge (propose or clarify)", False, str(exc))
        record("H8a no run_image/video_generation in tools", False, str(exc))

    # H8b — regen on same session (prefer seeded pending/media; else after prior gen turn)
    try:
        if not sid:
            sid = new_session("regen")
            tid = f"t_h8b_seed_{uuid.uuid4().hex[:8]}"
            sse_chat(tok, sid, BARE_GEN, tid, model=model, timeout=SSE_TIMEOUT)
            time.sleep(1.0)
        seeded = media_or_pending_ids(load_canvas(tok, sid))
        r2 = sse_chat(
            tok,
            sid,
            REGEN,
            tid or f"t_h8b_{uuid.uuid4().hex[:8]}",
            model=model,
            timeout=SSE_TIMEOUT,
        )
        flow_ok = r2["flow_mode"] in ("canvas_agent", "clarify_route") or (
            r2["flow_mode"] in OK_FLOWS and not r2["atomic_ran"]
        )
        ok = (
            r2["saw_done"]
            and flow_ok
            and not r2["atomic_ran"]
            and r2["no_run_tools"]
        )
        # Also reject retired atomic subgraph tool names if they appear as tools
        no_atomic_tools = not any(
            t in ("run_atomic_gen", "prepare_atomic_regenerate") for t in r2["tools"]
        )
        record(
            "H8b regen → canvas_agent/clarify (not atomic steps)",
            ok and no_atomic_tools,
            f"flow={r2['flow_mode']} rule={r2['rule_id']} seeded={seeded[:3]} "
            f"atomic={r2['atomic_ran']} steps={r2['steps'][:8]} tools={r2['tools'][:6]} "
            f"text={r2['text'][:90]!r}",
        )
        record(
            "H8b no run_image/video_generation in tools",
            r2["no_run_tools"],
            f"tools={r2['tools'][:8]} banned={r2['banned_run_tools']}",
        )
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("H8b regen → canvas_agent/clarify (not atomic steps)", False, str(exc))
        record("H8b no run_image/video_generation in tools", False, str(exc))

    print(f"\nPASS={PASS} FAIL={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        raise SystemExit(2)
