#!/usr/bin/env python3
"""Production smoke skeleton — product_visual CVS dry-run (Task 8).

Local dry-run (no network):
  python3 deploy/prod-product-visual-cvs-verify.py

Optional prod SSE (requires BASE_URL + auth):
  BASE_URL=http://119.29.173.89:8888 PHONE=... CODE=... python3 deploy/prod-product-visual-cvs-verify.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
RUNTIME = REPO / "services" / "agent-runtime"
sys.path.insert(0, str(RUNTIME))

from langchain_core.messages import HumanMessage  # noqa: E402

from app.graph.nodes.plan_product_visual import make_plan_product_visual_node  # noqa: E402
from app.graph.product_visual_models import parse_product_visual_plan  # noqa: E402
from app.graph.route_context import assemble_route_context  # noqa: E402
from app.graph.route_decide import decide_route  # noqa: E402

EVAL_PATH = RUNTIME / "skills" / "ecommerce-product-visual" / "eval-cvs-set.yaml"
VALID_SKILLS = {"ecommerce-product-visual", "enterprise-marketing-campaign"}

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
        line += f" — {detail[:220]}"
    print(line)


class FakeLLM:
    def __init__(self, content: str) -> None:
        self.content = content

    async def ainvoke(self, _messages: object) -> object:
        class Resp:
            def __init__(self, text: str) -> None:
                self.content = text

        return Resp(self.content)


async def _run_cvs01_dry_run() -> bool:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    case = next(c for c in doc["cases"] if c["id"] == "CVS-01-ecommerce-listing")
    state = {
        "messages": [HumanMessage(content=case["utterance"])],
        "requested_skill_id": case.get("requested_skill_id"),
        "sidebar_attachments": list(case.get("attachments") or []),
    }
    ctx = assemble_route_context(state)
    decision = decide_route(ctx, valid_skill_ids=VALID_SKILLS)
    if decision.get("flow_mode") != "product_visual":
        record("CVS-01 route", False, f"flow_mode={decision.get('flow_mode')}")
        return False
    record("CVS-01 route", True, "flow_mode=product_visual")

    fixture = case["plan_fixture"]
    raw = json.dumps(fixture, ensure_ascii=False)
    try:
        plan = parse_product_visual_plan(raw)
    except Exception as exc:  # noqa: BLE001
        record("CVS-01 plan fixture parse", False, str(exc))
        return False
    type_ids = {t.type_id for t in plan.image_types}
    required = set(case.get("assert_plan_types_include") or [])
    if not required.issubset(type_ids):
        record("CVS-01 plan types", False, f"missing {required - type_ids}")
        return False
    record("CVS-01 plan fixture parse", True, f"types={sorted(type_ids)}")

    llm = FakeLLM(raw)
    node = make_plan_product_visual_node(llm=llm, skills_dir=RUNTIME / "skills")
    out = await node({**state, "user_brief": case["utterance"], "skill_id": "ecommerce-product-visual"})
    ok = out.get("phase") != "error" and bool(out.get("product_visual_plan"))
    record("CVS-01 plan node dry-run", ok, out.get("phase", ""))
    return ok


def main() -> int:
    print("=== product_visual CVS verify (dry-run) ===\n")
    import asyncio

    asyncio.run(_run_cvs01_dry_run())
    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
