#!/usr/bin/env python3
"""Run N consecutive production crab listing E2E audits and summarize."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROUNDS = int(os.environ.get("AUDIT_BATCH_ROUNDS", "5"))
START_INDEX = int(os.environ.get("AUDIT_BATCH_START", "10"))
SCRIPT = Path(__file__).with_name("prod-crab-listing-e2e-audit.py")
OUT_DIR = Path(os.environ.get("AUDIT_BATCH_DIR", "deploy"))


def run_round(index: int) -> dict[str, Any]:
    out_path = OUT_DIR / f"prod-crab-listing-audit-v{index}.json"
    env = {**os.environ, "AUDIT_OUT": str(out_path.resolve())}
    print(f"\n=== batch round v{index} -> {out_path} ===", flush=True)
    started = time.time()
    proc = subprocess.run(
        [sys.executable, str(SCRIPT.resolve())],
        env=env,
        cwd=str(Path(__file__).resolve().parents[1]),
        capture_output=False,
    )
    elapsed = round(time.time() - started, 1)
    row: dict[str, Any] = {
        "round": f"v{index}",
        "out": str(out_path),
        "exit_code": proc.returncode,
        "elapsed_sec": elapsed,
    }
    if out_path.exists():
        doc = json.loads(out_path.read_text(encoding="utf-8"))
        row.update(
            {
                "status": doc.get("status"),
                "threadId": doc.get("threadId"),
                "journeyTraceOk": doc.get("journeyTraceOk"),
                "businessOk": doc.get("businessOk"),
                "issues": doc.get("issues") or [],
                "steps": len(doc.get("steps") or []),
                "shotManifest_final": len(
                    (doc.get("final_thread_state") or {}).get("shotManifest") or []
                ),
            }
        )
        final = doc.get("final_thread_state") or {}
        pres = final.get("presentation") or {}
        row["presentation_kind"] = pres.get("kind") if isinstance(pres, dict) else None
    else:
        row["error"] = "audit output missing"
    return row


def main() -> int:
    print(f"=== crab listing batch: {ROUNDS} rounds (v{START_INDEX}..v{START_INDEX + ROUNDS - 1}) ===", flush=True)
    results: list[dict[str, Any]] = []
    for i in range(START_INDEX, START_INDEX + ROUNDS):
        results.append(run_round(i))

    passed = sum(1 for r in results if r.get("exit_code") == 0)
    summary = {
        "rounds": ROUNDS,
        "passed": passed,
        "failed": ROUNDS - passed,
        "results": results,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    summary_path = OUT_DIR / f"prod-crab-listing-audit-batch-v{START_INDEX}-{START_INDEX + ROUNDS - 1}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n=== batch summary: {passed}/{ROUNDS} passed ===", flush=True)
    for r in results:
        print(
            f"  {r['round']}: exit={r.get('exit_code')} status={r.get('status')} "
            f"shots={r.get('shotManifest_final')} journey={r.get('journeyTraceOk')} "
            f"business={r.get('businessOk')} ({r.get('elapsed_sec')}s)",
            flush=True,
        )
    print(f"Summary saved: {summary_path}", flush=True)
    return 0 if passed == ROUNDS else 1


if __name__ == "__main__":
    raise SystemExit(main())
