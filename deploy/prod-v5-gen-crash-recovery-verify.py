#!/usr/bin/env python3
"""Production V5 verify — gen crash/recovery: completed nodes are not re-run.

Modes (``V5_MODE``):
  soft (default) — During an active gen SSE stream, poll canvas until ≥2 image
    nodes have ``generationRecordId``/url; assert recordIds stay stable while
    generation continues; after stream ``done``, re-send「确认出图」and assert
    completed nodes are not put back to ``generating`` with new recordIds.

  manual — Print CVM restart checklist for true crash drill; optional
    ``RECOVERY_THREAD_ID`` + ``RECOVERY_SESSION_ID`` skip setup and only run
    post-recovery assertions (see script output).

True container kill is not automated on production (ops SSH). Unit coverage:
``tests/test_gen_subgraph.py::test_checkpoint_recovery_does_not_rerun_completed``.

Usage:
  python3 deploy/prod-v5-gen-crash-recovery-verify.py
  V5_MODE=soft GEN_SSE_TIMEOUT_SEC=900 python3 deploy/prod-v5-gen-crash-recovery-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
V5_MODE = os.environ.get("V5_MODE", "soft").strip().lower()
GEN_SSE_TIMEOUT_SEC = float(os.environ.get("GEN_SSE_TIMEOUT_SEC", "900"))
MIN_DONE_IMAGES = int(os.environ.get("V5_MIN_DONE_IMAGES", "2"))
POLL_INTERVAL_SEC = float(os.environ.get("V5_POLL_INTERVAL_SEC", "12"))

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
    on_event: Any | None = None,
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
                    if on_event:
                        on_event(ev)
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
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def snapshot_images(canvas: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for n in canvas.get("nodes") or []:
        if n.get("type") != "image":
            continue
        data = n.get("data") or {}
        out[str(n["id"])] = {
            "recordId": data.get("generationRecordId"),
            "url": data.get("url"),
            "status": data.get("status"),
            "title": data.get("title") or data.get("manifestKey"),
        }
    return out


def done_image_count(snap: dict[str, dict[str, Any]]) -> int:
    return sum(
        1
        for v in snap.values()
        if v.get("url") or (v.get("recordId") and v.get("status") in ("completed", "done", None))
    )


def record_ids_stable(before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]) -> tuple[bool, str]:
    """Nodes with recordId in ``before`` must keep the same recordId in ``after``."""
    mismatches: list[str] = []
    for nid, b in before.items():
        rid = b.get("recordId")
        if not rid:
            continue
        a = after.get(nid)
        if not a:
            mismatches.append(f"{nid}: missing")
            continue
        if a.get("recordId") != rid:
            mismatches.append(f"{nid}: {rid} -> {a.get('recordId')}")
    return (not mismatches, "; ".join(mismatches[:5]))


def print_manual_crash_checklist(tid: str, sid: str) -> None:
    print(
        "\n--- V5 manual crash drill (ops) ---\n"
        "1. Run soft verify until await_topo, note threadId/sessionId.\n"
        "2. Send「确认出图」from UI; wait for ≥2 nodes generating.\n"
        "3. On CVM: ``docker restart lnkpi-agent-runtime`` (or systemd restart).\n"
        "4. Re-run with:\n"
        f"   RECOVERY_THREAD_ID={tid} RECOVERY_SESSION_ID={sid} V5_MODE=manual \\\n"
        "     python3 deploy/prod-v5-gen-crash-recovery-verify.py\n"
        "5. Assert completed canvas nodes keep generationRecordId; pending nodes resume.\n"
    )


def run_soft(tok: str, sid: str, tid: str) -> int:
    steps = [
        ("V5 setup plan", "天猫蓝牙耳机详情页营销方案，品牌 lnkpi，V5出图恢复复测"),
        ("V5 setup confirm", "1"),
        ("V5 setup write copy", "写入主文案"),
    ]
    for name, msg in steps:
        _, text, types, exit_reason = sse_collect(tok, sid, msg, tid, timeout=420)
        record(name, "error" not in types and len(text) > 0, f"exit={exit_reason}")

    ts = thread_state(tok, tid)
    phase = str(ts.get("phase") or "")
    record("V5 await_topo gate", phase == "await_topo", f"phase={phase} interrupted={ts.get('interrupted')}")
    if phase != "await_topo":
        return 1

    poll_snaps: list[dict[str, dict[str, Any]]] = []
    stop_poll = threading.Event()
    task_done_keys: list[str] = []

    def on_event(ev: dict[str, Any]) -> None:
        if ev.get("type") == "task_update":
            data = ev.get("data") or {}
            if data.get("status") == "done" and data.get("id"):
                task_done_keys.append(str(data["id"]))

    def poll_loop() -> None:
        while not stop_poll.is_set():
            try:
                poll_snaps.append(snapshot_images(get_canvas(tok, sid)))
            except Exception:  # noqa: BLE001
                pass
            stop_poll.wait(POLL_INTERVAL_SEC)

    poller = threading.Thread(target=poll_loop, daemon=True)
    poller.start()

    events, gen_text, gen_types, gen_exit = sse_collect(
        tok,
        sid,
        "确认出图",
        tid,
        user_decision="confirm",
        timeout=GEN_SSE_TIMEOUT_SEC,
        on_event=on_event,
    )
    stop_poll.set()
    poller.join(timeout=5)

    record(
        "V5 gen stream",
        "error" not in gen_types and ("出图" in gen_text or "task_update" in gen_types),
        f"exit={gen_exit} types={sorted(gen_types)[:10]} task_done_keys={len(task_done_keys)}",
    )

    final_snap = snapshot_images(get_canvas(tok, sid))
    done_n = done_image_count(final_snap)
    record("V5 final canvas done images", done_n >= MIN_DONE_IMAGES, f"done={done_n}")

    mid_snap: dict[str, dict[str, Any]] = {}
    for snap in poll_snaps:
        if done_image_count(snap) >= MIN_DONE_IMAGES:
            mid_snap = snap
            break
    if mid_snap:
        stable, detail = record_ids_stable(mid_snap, final_snap)
        record("V5 mid-stream recordId stable to end", stable, detail)
    else:
        record(
            "V5 mid-stream recordId stable to end",
            False,
            f"only {len(poll_snaps)} poll snaps, need {MIN_DONE_IMAGES} done mid-stream",
            skip=True,
        )

    ts_done = thread_state(tok, tid)
    record(
        "V5 thread-state after gen",
        str(ts_done.get("phase") or "") in ("done", "orchestrate_gen", "split"),
        f"phase={ts_done.get('phase')}",
    )

    before_reconfirm = final_snap
    _, re_text, re_types, re_exit = sse_collect(tok, sid, "确认出图", tid, timeout=120)
    after_reconfirm = snapshot_images(get_canvas(tok, sid))
    no_rerun = True
    rerun_detail: list[str] = []
    for nid, b in before_reconfirm.items():
        if not b.get("url"):
            continue
        a = after_reconfirm.get(nid) or {}
        if a.get("status") == "generating" and a.get("recordId") != b.get("recordId"):
            no_rerun = False
            rerun_detail.append(nid)
    record(
        "V5 re-confirm does not re-gen completed nodes",
        no_rerun and "error" not in re_types,
        f"exit={re_exit} rerun={rerun_detail[:3]} text={re_text[:60].replace(chr(10), ' ')}",
    )

    print_manual_crash_checklist(tid, sid)
    return 0 if FAIL == 0 else 1


def run_manual(tok: str) -> int:
    tid = os.environ.get("RECOVERY_THREAD_ID", "").strip()
    sid = os.environ.get("RECOVERY_SESSION_ID", "").strip()
    if not tid or not sid:
        print("Set RECOVERY_THREAD_ID and RECOVERY_SESSION_ID after manual crash drill.")
        print_manual_crash_checklist("<threadId>", "<sessionId>")
        record("V5 manual recovery", False, "missing RECOVERY_* env")
        return 1

    ts = thread_state(tok, tid)
    record("V5 manual thread-state", bool(ts.get("threadId")), f"phase={ts.get('phase')}")

    snap = snapshot_images(get_canvas(tok, sid))
    done_n = done_image_count(snap)
    record("V5 manual canvas partial done", done_n >= 1, f"done={done_n}")

    _, text, types, exit_reason = sse_collect(tok, sid, "确认出图", tid, timeout=GEN_SSE_TIMEOUT_SEC)
    after = snapshot_images(get_canvas(tok, sid))
    stable, detail = record_ids_stable(
        {k: v for k, v in snap.items() if v.get("recordId")},
        after,
    )
    record("V5 manual resume recordId stable", stable, detail)
    record(
        "V5 manual resume stream",
        "error" not in types,
        f"exit={exit_reason} text={text[:80].replace(chr(10), ' ')}",
    )
    return 0 if FAIL == 0 else 1


def main() -> int:
    print("=== V5 production verify (gen crash / recovery) ===")
    print(f"BASE={BASE}  V5_MODE={V5_MODE}\n")

    if V5_MODE == "manual":
        try:
            http("POST", "/auth/send-code", {"phone": PHONE})
        except Exception:
            pass
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        return run_manual(tok)

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("V5 Login", True)
    except Exception as exc:  # noqa: BLE001
        record("V5 Login", False, str(exc))
        return 1

    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = http("POST", "/sessions", {"title": f"V5-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    record("Create session", True, sid)

    rc = run_soft(tok, sid, tid)
    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return rc


if __name__ == "__main__":
    sys.exit(main())
