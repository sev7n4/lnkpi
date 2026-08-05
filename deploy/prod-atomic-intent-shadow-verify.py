#!/usr/bin/env python3
"""Production shadow verify — planning guard + fixture agreement (Phase C).

Usage:
  python3 deploy/prod-atomic-intent-shadow-verify.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
import uuid
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT.parent / "services" / "agent-runtime"
sys.path.insert(0, str(RUNTIME))

spec = importlib.util.spec_from_file_location("studio_verify", ROOT / "prod-atomic-studio-verify.py")
studio = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(studio)

from app.graph.intent_parse_schema import intent_result_to_parse_outcome  # noqa: E402
from app.graph.planning_guard import validate_llm_parse  # noqa: E402

PLANNING_UTTERANCE = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
GENERATE_UTTERANCE = "生成一张蓝牙耳机主图"


def main() -> int:
    print("=== Phase C intent shadow production verify ===")
    print(f"BASE={studio.BASE}\n")

    try:
        studio.http("POST", "/auth/send-code", {"phone": studio.PHONE})
    except Exception:
        pass
    try:
        tok = studio.http("POST", "/auth/login", {"phone": studio.PHONE, "code": studio.CODE})["data"]["token"]
        studio.record("Login", True)
    except Exception as exc:  # noqa: BLE001
        studio.record("Login", False, str(exc))
        return 1

    rt = studio.http("GET", "/agent/runtime-health", t=tok)
    studio.record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = studio.http("POST", "/sessions", {"title": f"C-shadow-plan-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, _types, _exit = studio.sse_collect(tok, sid, PLANNING_UTTERANCE, tid, timeout=120)
    studio.record(
        "planning not image direct",
        "image 节点（直达）" not in text or "方案" in text or "确认" in text,
        text[:120],
    )
    studio.record(
        "planning campaign or clarify",
        "方案" in text or "拟定拆解" in text or "请确认" in text or "1）" in text,
        text[:80],
    )

    sid2 = studio.http("POST", "/sessions", {"title": f"C-shadow-gen-{int(time.time())}"}, t=tok)["data"]["id"]
    tid2 = f"{sid2}:{uuid.uuid4()}"
    _, text2, _types2, _exit2 = studio.sse_collect(tok, sid2, GENERATE_UTTERANCE, tid2, timeout=180)
    studio.record(
        "generate image atomic path",
        "image 节点" in text2 and "直达" in text2,
        text2[:100],
    )

    eval_path = RUNTIME / "skills" / "atomic-create" / "eval-intent-llm-set.yaml"
    cases = yaml.safe_load(eval_path.read_text(encoding="utf-8"))["cases"]
    ok = 0
    for case in cases:
        fix = case.get("llm_fixture")
        if not fix:
            continue
        guard = validate_llm_parse(fix, case["utterance"])  # type: ignore[arg-type]
        outcome = guard or intent_result_to_parse_outcome(fix, case["utterance"])  # type: ignore[arg-type]
        gold = case["gold"]
        if gold.get("outcome") == "clarify" and outcome.get("kind") == "clarify":
            ok += 1
        elif gold.get("outcome") == "success" and outcome.get("kind") == "success":
            ok += 1
    rate = ok / len(cases)
    studio.record("fixture agreement rate", rate >= 0.90, f"{ok}/{len(cases)}={rate:.1%}")
    print(
        json.dumps(
            {
                "fixture_agreement_rate": round(rate, 4),
                "shadow_env": os.environ.get("INTENT_LLM_PARSE_SHADOW"),
            },
            ensure_ascii=False,
        )
    )

    print(f"\n=== Summary PASS={studio.PASS} FAIL={studio.FAIL} ===")
    return 0 if studio.FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
