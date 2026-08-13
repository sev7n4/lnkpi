#!/usr/bin/env python3
"""Verify decompose failure handling (local) and revise recovery (production)."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

_AUDIT_MOD_PATH = Path(__file__).with_name("prod-crab-listing-e2e-audit.py")
_spec = importlib.util.spec_from_file_location("prod_crab_listing_e2e_audit", _AUDIT_MOD_PATH)
assert _spec and _spec.loader
_audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_audit)

CODE = _audit.CODE
PHONE = _audit.PHONE
UTTERANCE = _audit.UTTERANCE
absorb_journey_updates = _audit.absorb_journey_updates
find_crab_asset = _audit.find_crab_asset
http = _audit.http
sse_turn = _audit.sse_turn
thread_state = _audit.thread_state

OUT_PATH = Path(
    os.environ.get(
        "DECOMPOSE_VERIFY_OUT",
        "deploy/prod-decompose-failure-recovery-verify.json",
    )
)
RUNTIME_ROOT = Path(__file__).resolve().parents[1] / "services" / "agent-runtime"


def run_local_pytests() -> dict[str, Any]:
    tests = [
        "tests/test_decompose_failure_recovery.py",
        "tests/test_graph_routes.py::test_route_after_decompose_error_goes_done",
        "tests/test_journey_trace_snapshot.py::test_error_done_marks_failed_step_not_all_complete",
    ]
    cmd = [sys.executable, "-m", "pytest", *tests, "-q"]
    print("=== local pytest: decompose failure recovery ===", flush=True)
    proc = subprocess.run(cmd, cwd=str(RUNTIME_ROOT), capture_output=True, text=True)
    ok = proc.returncode == 0
    print(proc.stdout, flush=True)
    if proc.stderr:
        print(proc.stderr, flush=True)
    return {
        "ok": ok,
        "exit_code": proc.returncode,
        "stdout_tail": proc.stdout[-2000:],
    }


def assert_decompose_error_shape(ts: dict[str, Any]) -> None:
    pres = ts.get("presentation") or {}
    if ts.get("phase") == "done":
        assert isinstance(pres, dict), "expected presentation on done"
        assert pres.get("kind") == "callout_error", f"expected callout_error, got {pres.get('kind')}"
        body = pres.get("body") or {}
        text = str(body.get("text") or "")
        assert "构图" in text or "拆解" in text or "未能" in text, f"unexpected error text: {text!r}"
        jt = ts.get("journeyTrace") or {}
        steps = jt.get("steps") or []
        shot_plan = next((s for s in steps if s.get("id") == "shot_plan"), None)
        if shot_plan:
            assert shot_plan.get("status") == "failed", f"shot_plan should be failed, got {shot_plan}"
        return
    if ts.get("phase") == "error":
        assert not ts.get("interrupted") or not (
            (ts.get("nextNodes") or [None])[0] == "await_shot_topo_confirm"
            and len(ts.get("shotManifest") or []) == 0
        ), "v6 regression: error at empty topo gate interrupt"
        raise AssertionError(f"unexpected phase=error without done: {ts.get('nextNodes')}")


def prod_revise_recovery(tok: str) -> dict[str, Any]:
    crab = find_crab_asset(tok)
    sid = http("POST", "/sessions", {"title": f"decompose-recover-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"craba_{uuid.uuid4().hex[:10]}"
    attachment = {
        "id": f"att-{uuid.uuid4().hex[:8]}",
        "mediaType": "image",
        "sourceKind": "asset",
        "role": "product",
        "label": crab.get("label") or "大闸蟹实拍",
        "url": crab["url"],
    }
    steps: list[dict[str, Any]] = []

    def snap(step: int, msg: str, sse: dict[str, Any], ts: dict[str, Any]) -> None:
        entry = {
            "step": step,
            "user_message": msg[:160],
            "sse_exit": sse.get("exit"),
            "phase": ts.get("phase"),
            "nextNodes": ts.get("nextNodes"),
            "shotManifest_count": len(ts.get("shotManifest") or []),
            "presentation_kind": (ts.get("presentation") or {}).get("kind"),
        }
        steps.append(entry)
        print(
            f"[recover step {step}] phase={entry['phase']} shots={entry['shotManifest_count']} "
            f"pres={entry['presentation_kind']}",
            flush=True,
        )

    # Step 1 — reach topo gate
    ts0 = thread_state(tok, tid)
    sse1 = sse_turn(
        tok,
        sid,
        tid,
        UTTERANCE,
        attachments=[attachment],
        skill_id="product-visual",
        ts_before=ts0,
    )
    absorb_journey_updates(sse1.get("events") or [])
    ts1 = thread_state(tok, tid)
    snap(1, UTTERANCE, sse1, ts1)

    if ts1.get("phase") == "done" and (ts1.get("presentation") or {}).get("kind") == "callout_error":
        assert_decompose_error_shape(ts1)
        return {
            "mode": "natural_decompose_failure",
            "threadId": tid,
            "sessionId": sid,
            "steps": steps,
            "passed": True,
            "note": "Observed natural decompose failure; error shape OK (no empty topo gate)",
        }

    assert ts1.get("phase") in ("await_shot_topo_confirm", "await_shot_confirm"), ts1.get("phase")
    assert len(ts1.get("shotManifest") or []) > 0, "step1 shotManifest empty"
    count_before = len(ts1.get("shotManifest") or [])

    # Step 2 — revise triggers decompose rerun
    revise_msg = "调整构图，去掉营销海报，其他保持不变"
    ts_before = ts1
    sse2 = sse_turn(tok, sid, tid, revise_msg, ts_before=ts_before)
    absorb_journey_updates(sse2.get("events") or [])
    ts2 = thread_state(tok, tid)
    snap(2, revise_msg, sse2, ts2)
    assert len(ts2.get("shotManifest") or []) > 0, "revise left shotManifest empty"
    assert ts2.get("phase") in ("await_shot_topo_confirm", "await_shot_confirm", "decompose_from_ssot"), ts2

    # Step 3 — confirm gen after recovery
    confirm_msg = "确认构图并开始出图"
    ts_before = ts2
    sse3 = sse_turn(tok, sid, tid, confirm_msg, ts_before=ts_before)
    absorb_journey_updates(sse3.get("events") or [])
    ts3 = thread_state(tok, tid)
    snap(3, confirm_msg, sse3, ts3)
    assert ts3.get("phase") != "error", "confirm after revise should not error"
    assert ts3.get("phase") in (
        "await_delivery_confirm",
        "start_gen",
        "orchestrate_gen",
        "collect_gen",
        "done",
    ), f"unexpected phase after confirm: {ts3.get('phase')}"

    return {
        "mode": "revise_recovery",
        "threadId": tid,
        "sessionId": sid,
        "steps": steps,
        "shot_count_before": count_before,
        "shot_count_after_revise": len(ts2.get("shotManifest") or []),
        "passed": True,
    }


def main() -> int:
    report: dict[str, Any] = {"checks": []}

    local = run_local_pytests()
    report["local_pytest"] = local
    report["checks"].append({"name": "local_pytest", "ok": local["ok"]})

    try:
        try:
            http("POST", "/auth/send-code", {"phone": PHONE})
        except Exception:
            pass
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        prod = prod_revise_recovery(tok)
        report["prod_revise_recovery"] = prod
        report["checks"].append({"name": "prod_revise_recovery", "ok": bool(prod.get("passed"))})
    except Exception as exc:  # noqa: BLE001
        report["prod_revise_recovery"] = {"passed": False, "error": str(exc)}
        report["checks"].append({"name": "prod_revise_recovery", "ok": False, "error": str(exc)})

    report["passed"] = all(c.get("ok") for c in report["checks"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nVerify saved: {OUT_PATH}", flush=True)
    print(f"Overall: {'PASS' if report['passed'] else 'FAIL'}", flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
