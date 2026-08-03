#!/usr/bin/env python3
"""Production V4 verify — HITL interrupt survives page refresh (thread-state + resume).

Simulates:
  1. User sends brief → graph pauses at await_confirm (interrupt SSE + checkpoint)
  2. Browser refresh → re-fetch thread-state with same threadId (no new turn)
  3. User confirms with same threadId → graph continues (not intake restart)
  4. Advance to await_topo → repeat refresh poll + lightweight topo query

Usage:
  python3 deploy/prod-v4-hitl-refresh-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-v4-hitl-refresh-verify.py
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
SSE_TIMEOUT_SEC = float(os.environ.get("V4_SSE_TIMEOUT_SEC", "420"))
REFRESH_POLLS = int(os.environ.get("V4_REFRESH_POLLS", "3"))

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
    user_decision: str | None = None,
    timeout: float = 420,
) -> tuple[list[dict], str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if user_decision:
        body["userDecision"] = user_decision
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


def interrupt_nodes(ts: dict[str, Any]) -> tuple[str | None, list[str]]:
    phase = ts.get("phase")
    phase_str = str(phase) if phase is not None else None
    next_nodes = [str(n) for n in (ts.get("nextNodes") or [])]
    return phase_str, next_nodes


def simulate_refresh_poll(tok: str, tid: str, *, polls: int) -> list[dict[str, Any]]:
    """Simulate frontend reconnect: only thread-state, no SSE."""
    out: list[dict[str, Any]] = []
    for _ in range(polls):
        out.append(thread_state(tok, tid))
        time.sleep(0.4)
    return out


def refresh_stable(
    snapshots: list[dict[str, Any]],
    *,
    expected_phase: str,
) -> tuple[bool, str]:
    if not snapshots:
        return False, "no snapshots"
    phases: list[str] = []
    interrupted_flags: list[bool] = []
    next_sets: list[tuple[str, ...]] = []
    for snap in snapshots:
        phase, next_nodes = interrupt_nodes(snap)
        phases.append(str(phase or ""))
        interrupted_flags.append(bool(snap.get("interrupted")))
        next_sets.append(tuple(next_nodes))
    ok = (
        all(p == expected_phase for p in phases)
        and all(interrupted_flags)
        and len(set(next_sets)) <= 1
    )
    detail = (
        f"phases={phases} interrupted={interrupted_flags} "
        f"nextNodes={list(next_sets[0]) if next_sets else []}"
    )
    return ok, detail


def main() -> int:
    print("=== V4 production verify (HITL refresh → interrupt recovery) ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("V4 Login", True)
    except Exception as exc:  # noqa: BLE001
        record("V4 Login", False, str(exc))
        return 1

    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = http("POST", "/sessions", {"title": f"V4-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Create session", True, sid)

    events, text, types, exit_reason = sse_collect(
        tok,
        sid,
        "天猫蓝牙耳机详情页营销方案，品牌 lnkpi，V4刷新复测",
        tid,
        timeout=SSE_TIMEOUT_SEC,
    )
    record(
        "V4-1 plan SSE completes",
        "error" not in types and len(text) > 0,
        f"exit={exit_reason} types={sorted(types)[:8]}",
    )
    interrupt_evs = [e for e in events if e.get("type") == "interrupt"]
    record(
        "V4-1 SSE interrupt event",
        bool(interrupt_evs),
        str((interrupt_evs[0].get("data") if interrupt_evs else {}))[:120],
    )

    ts1 = thread_state(tok, tid)
    phase1, next1 = interrupt_nodes(ts1)
    record(
        "V4-1 thread-state at await_confirm",
        phase1 == "await_confirm" and bool(ts1.get("interrupted")),
        f"phase={phase1} next={next1}",
    )

    refresh_a = simulate_refresh_poll(tok, tid, polls=REFRESH_POLLS)
    ok_a, detail_a = refresh_stable(refresh_a, expected_phase="await_confirm")
    record("V4-2 refresh poll stable (await_confirm)", ok_a, detail_a)

    _, confirm_text, confirm_types, confirm_exit = sse_collect(
        tok,
        sid,
        "1",
        tid,
        user_decision="confirm",
        timeout=SSE_TIMEOUT_SEC,
    )
    resumed = (
        "error" not in confirm_types
        and (
            "已确认方案" in confirm_text
            or "拆解" in confirm_text
            or "骨架" in confirm_text
            or "写入画布" in confirm_text
        )
    )
    record(
        "V4-3 resume after refresh (confirm plan)",
        resumed,
        f"exit={confirm_exit} text={confirm_text[:90].replace(chr(10), ' ')}",
    )

    _, copy_text, copy_types, copy_exit = sse_collect(
        tok,
        sid,
        "写入主文案",
        tid,
        user_decision="confirm",
        timeout=SSE_TIMEOUT_SEC,
    )
    record(
        "V4-4 advance to await_topo (write copy)",
        "error" not in copy_types and ("主文案" in copy_text or "确认出图" in copy_text),
        f"exit={copy_exit} text={copy_text[:80].replace(chr(10), ' ')}",
    )

    ts_topo = thread_state(tok, tid)
    phase_topo, next_topo = interrupt_nodes(ts_topo)
    at_topo = phase_topo == "await_topo" and bool(ts_topo.get("interrupted"))
    record(
        "V4-5 thread-state at await_topo",
        at_topo,
        f"phase={phase_topo} next={next_topo}",
    )

    if at_topo:
        refresh_b = simulate_refresh_poll(tok, tid, polls=REFRESH_POLLS)
        ok_b, detail_b = refresh_stable(refresh_b, expected_phase="await_topo")
        record("V4-6 refresh poll stable (await_topo)", ok_b, detail_b)

        _, query_text, query_types, query_exit = sse_collect(
            tok,
            sid,
            "查看主图",
            tid,
            timeout=180,
        )
        ts_after_query = thread_state(tok, tid)
        phase_after, _ = interrupt_nodes(ts_after_query)
        record(
            "V4-7 topo query keeps interrupt gate",
            "error" not in query_types
            and phase_after == "await_topo"
            and bool(ts_after_query.get("interrupted")),
            f"exit={query_exit} phase={phase_after} text={query_text[:70].replace(chr(10), ' ')}",
        )
    else:
        record("V4-6 refresh poll stable (await_topo)", False, f"skip: phase={phase_topo}", skip=True)
        record("V4-7 topo query keeps interrupt gate", False, f"skip: phase={phase_topo}", skip=True)

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
