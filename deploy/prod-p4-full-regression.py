#!/usr/bin/env python3
"""P4-07 production regression — atomic modalities + Phase A/B/C/P3 smoke.

Runs (in order):
  1. prod-atomic-studio-verify.py      — image/text/prompt atomic_create
  2. prod-atomic-confirm-gate-verify.py — video/audio await_atomic_confirm
  3. prod-single-node-gen-verify.py    — P3 regression (A5)
  4. prod-phase-b-user-verify.py       — Phase B (optional, SKIP_PHASE_B=1)
  5. prod-atomic-intent-shadow-verify.py — Phase C shadow (optional, SKIP_INTENT_SHADOW=1)

Usage:
  python3 deploy/prod-p4-full-regression.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPTS = [
    ROOT / "prod-atomic-studio-verify.py",
    ROOT / "prod-atomic-confirm-gate-verify.py",
    ROOT / "prod-single-node-gen-verify.py",
]
if os.environ.get("SKIP_PHASE_B", "").strip() not in ("1", "true", "yes"):
    SCRIPTS.append(ROOT / "prod-phase-b-user-verify.py")
if os.environ.get("SKIP_INTENT_SHADOW", "").strip() not in ("1", "true", "yes"):
    SCRIPTS.append(ROOT / "prod-atomic-intent-shadow-verify.py")


def main() -> int:
    print("=== P4-07 full production regression ===\n")
    failed: list[str] = []
    for script in SCRIPTS:
        print(f"--- {script.name} ---")
        rc = subprocess.call([sys.executable, str(script)])
        print()
        if rc != 0:
            failed.append(script.name)
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        return 1
    print("All regression scripts PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
