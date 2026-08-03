#!/usr/bin/env python3
"""P4-06 production E2E — video/audio await_atomic_confirm gate (D2).

Flow:
  1. Video utterance → interrupt at await_atomic_confirm (SSE + thread-state)
  2. Refresh poll stable at gate
  3. Resume「确认生成」→ passes gate (gen started or completed)
  4. Audio utterance → interrupt at await_atomic_confirm
  5. Resume「取消」→ done, not stuck

Usage:
  python3 deploy/prod-atomic-confirm-gate-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-atomic-confirm-gate-verify.py
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
SSE_TIMEOUT_SEC = float(os.environ.get("P4_SSE_TIMEOUT_SEC", "300"))
CONFIRM_TIMEOUT_SEC = float(os.environ.get("P4_CONFIRM_TIMEOUT_SEC", "420"))
REFRESH_POLLS = int(os.environ.get("P4_REFRESH_POLLS", "3"))

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
    timeout: float = 300,
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


def gate_snapshot(ts: dict[str, Any]) -> tuple[str | None, list[str], bool]:
    phase = ts.get("phase")
    phase_str = str(phase) if phase is not None else None
    next_nodes = [str(n) for n in (ts.get("nextNodes") or [])]
    return phase_str, next_nodes, bool(ts.get("interrupted"))


def refresh_poll(tok: str, tid: str, *, polls: int) -> list[dict[str, Any]]:
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
        phase, next_nodes, interrupted = gate_snapshot(snap)
        phases.append(str(phase or ""))
        interrupted_flags.append(interrupted)
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


def at_atomic_confirm_gate(ts: dict[str, Any]) -> bool:
    phase, next_nodes, interrupted = gate_snapshot(ts)
    if not interrupted:
        return False
    if phase == "await_atomic_confirm":
        return True
    return "await_atomic_confirm" in next_nodes


def expected_gate_phase(ts: dict[str, Any]) -> str:
    """Phase string for refresh-stable checks (interrupt_before uses parent phase)."""
    phase, next_nodes, _ = gate_snapshot(ts)
    if phase == "await_atomic_confirm":
        return "await_atomic_confirm"
    if "await_atomic_confirm" in next_nodes:
        return str(phase or "await_atomic_confirm")
    return str(phase or "")


def passed_confirm_gate(text: str, ts: dict[str, Any], types: set[str]) -> bool:
    if "error" in types:
        return False
    if at_atomic_confirm_gate(ts):
        return False
    if "已确认" in text or ("开始" in text and "生成" in text):
        return True
    phase, _, interrupted = gate_snapshot(ts)
    if phase in ("done", "error"):
        return True
    return not interrupted


def main() -> int:
    print("=== P4-06 production verify (video/audio await_atomic_confirm) ===")
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

    # --- Video confirm path ---
    sid_v = http("POST", "/sessions", {"title": f"P4-06-vid-{int(time.time())}"}, t=tok)["data"]["id"]
    tid_v = f"{sid_v}:{uuid.uuid4()}"
    record("Create video session", True, sid_v)

    events_v, text_v, types_v, exit_v = sse_collect(
        tok,
        sid_v,
        "做一个15秒产品展示视频",
        tid_v,
        timeout=SSE_TIMEOUT_SEC,
    )
    record(
        "P4-06-1 video SSE reaches gate",
        "error" not in types_v,
        f"exit={exit_v} text={text_v[:90].replace(chr(10), ' ')}",
    )

    interrupt_evs = [e for e in events_v if e.get("type") == "interrupt"]
    interrupt_data = (interrupt_evs[0].get("data") if interrupt_evs else {}) or {}
    record(
        "P4-06-1b SSE interrupt event",
        bool(interrupt_evs),
        str(interrupt_data)[:120],
    )

    ts_v = thread_state(tok, tid_v)
    at_gate_v = at_atomic_confirm_gate(ts_v)
    phase_v, next_v, int_v = gate_snapshot(ts_v)
    record(
        "P4-06-2 thread-state at await_atomic_confirm (video)",
        at_gate_v,
        f"phase={phase_v} interrupted={int_v} next={next_v}",
    )

    if at_gate_v:
        gate_phase = expected_gate_phase(ts_v)
        ok_refresh, detail_refresh = refresh_stable(
            refresh_poll(tok, tid_v, polls=REFRESH_POLLS),
            expected_phase=gate_phase,
        )
        record("P4-06-3 refresh poll stable (video gate)", ok_refresh, detail_refresh)

        _, confirm_text, confirm_types, confirm_exit = sse_collect(
            tok,
            sid_v,
            "确认生成",
            tid_v,
            user_decision="confirm",
            timeout=CONFIRM_TIMEOUT_SEC,
        )
        ts_after = thread_state(tok, tid_v)
        passed = passed_confirm_gate(confirm_text, ts_after, confirm_types)
        phase_after, _, int_after = gate_snapshot(ts_after)
        record(
            "P4-06-4 resume confirm (video)",
            passed,
            f"exit={confirm_exit} phase={phase_after} interrupted={int_after} "
            f"text={confirm_text[:80].replace(chr(10), ' ')}",
        )
    else:
        record("P4-06-3 refresh poll stable (video gate)", False, "skip: not at gate", skip=True)
        record("P4-06-4 resume confirm (video)", False, "skip: not at gate", skip=True)

    # --- Audio cancel path ---
    sid_a = http("POST", "/sessions", {"title": f"P4-06-aud-{int(time.time())}"}, t=tok)["data"]["id"]
    tid_a = f"{sid_a}:{uuid.uuid4()}"
    record("Create audio session", True, sid_a)

    _, text_a, types_a, exit_a = sse_collect(
        tok,
        sid_a,
        "给这段文案配一段旁白",
        tid_a,
        timeout=SSE_TIMEOUT_SEC,
    )
    ts_a = thread_state(tok, tid_a)
    at_gate_a = at_atomic_confirm_gate(ts_a)
    phase_a, next_a, int_a = gate_snapshot(ts_a)
    record(
        "P4-06-5 thread-state at await_atomic_confirm (audio)",
        at_gate_a,
        f"exit={exit_a} phase={phase_a} interrupted={int_a} next={next_a} text={text_a[:70]}",
    )

    if at_gate_a:
        _, cancel_text, cancel_types, cancel_exit = sse_collect(
            tok,
            sid_a,
            "取消",
            tid_a,
            timeout=SSE_TIMEOUT_SEC,
        )
        ts_cancel = thread_state(tok, tid_a)
        phase_c, _, int_c = gate_snapshot(ts_cancel)
        cancelled = (
            "error" not in cancel_types
            and ("已取消" in cancel_text or phase_c == "done")
            and not at_atomic_confirm_gate(ts_cancel)
        )
        record(
            "P4-06-6 resume cancel (audio)",
            cancelled,
            f"exit={cancel_exit} phase={phase_c} interrupted={int_c} "
            f"text={cancel_text[:80].replace(chr(10), ' ')}",
        )
    else:
        record("P4-06-6 resume cancel (audio)", False, "skip: not at gate", skip=True)

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
