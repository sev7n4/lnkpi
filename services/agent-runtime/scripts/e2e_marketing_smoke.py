#!/usr/bin/env python3
"""Enterprise marketing E2E smoke (spec §12).

Default ``dry-run`` mode runs in-process checks with FakeLLM/FakeNest — no live
OpenAI, Studio, or Nest required (CI-friendly).

``live`` mode only probes Runtime/Nest ``/health`` and prints manual steps for
full stack verification (URLs, canvas UI, image writeback).

Usage (from ``services/agent-runtime``):

    uv run python scripts/e2e_marketing_smoke.py
    uv run python scripts/e2e_marketing_smoke.py --mode live
    uv run python scripts/e2e_marketing_smoke.py --mode live \\
        --runtime-url http://127.0.0.1:8000 --nest-url http://127.0.0.1:3000/api
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from langchain_core.messages import AIMessage, HumanMessage  # noqa: E402

from app.graph.builder import build_agent_graph  # noqa: E402
from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node  # noqa: E402
from app.skills.loader import discover_skills, load_skill  # noqa: E402

SKILLS_DIR = ROOT / "skills"
SKILL_ID = "enterprise-marketing-campaign"

PLAN_MARKDOWN = """# 卫生洁具企业营销方案

## 定位
高端卫浴电商详情页。

## 视觉资产/白底图
白底产品主图。

## 视觉资产/主图
基于白底的电商主图。
"""


@dataclass
class Check:
    id: str
    label: str
    ok: bool
    detail: str = ""
    manual: bool = False


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)

    def add(self, check: Check) -> None:
        self.checks.append(check)

    @property
    def passed(self) -> bool:
        return all(c.ok for c in self.checks if not c.manual)

    def print_summary(self) -> None:
        print("\n=== Agent Runtime marketing smoke (spec §12) ===\n")
        for c in self.checks:
            tag = "PASS" if c.ok else ("MANUAL" if c.manual else "FAIL")
            suffix = f" — {c.detail}" if c.detail else ""
            print(f"[{tag}] {c.label}{suffix}")
        auto = [c for c in self.checks if not c.manual]
        ok = sum(1 for c in auto if c.ok)
        print(f"\nAutomated: {ok}/{len(auto)} passed")
        manual = [c for c in self.checks if c.manual]
        if manual:
            print(f"Manual follow-up: {len(manual)} item(s) — see README § Acceptance checklist")


class FakeLLM:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        if not self.responses:
            raise RuntimeError("FakeLLM: no responses left")
        return AIMessage(content=self.responses.pop(0))


class FakeNest:
    """Records canvas tool calls; optional per-key generation failure."""

    def __init__(self, *, fail_keys: set[str] | None = None) -> None:
        self.fail_keys = fail_keys or set()
        self.calls: list[tuple[str, Any]] = []
        self.nodes: dict[str, dict[str, Any]] = {}
        self._seq = 0
        self.key_by_node: dict[str, str] = {}

    async def upsert_prompt_node(
        self,
        *,
        prompt: str,
        content: str,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        nid = node_id or "prompt-plan-1"
        self.calls.append(
            ("upsert_prompt_node", {"prompt": prompt, "content": content, "node_id": node_id})
        )
        self.nodes[nid] = {
            "id": nid,
            "type": "prompt",
            "data": {"prompt": prompt, "content": content, "title": prompt},
        }
        return {"nodeId": nid, "actions": []}

    async def get_node(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("get_node", {"node_id": node_id}))
        return self.nodes[node_id]

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        mapping = []
        for item in items:
            self._seq += 1
            nid = f"{item['targetType']}-{self._seq}"
            key = item["key"]
            self.key_by_node[nid] = key
            mapping.append({"key": key, "nodeId": nid})
            self.nodes[nid] = {
                "id": nid,
                "type": item["targetType"],
                "data": {
                    "title": item.get("title", ""),
                    "manifestKey": key,
                    "prompt": item.get("prompt", ""),
                },
            }
        return {"nodes": mapping, "actions": []}

    async def connect_nodes(self, edges: list[dict[str, str]]) -> dict[str, Any]:
        self.calls.append(("connect_nodes", edges))
        return {"actions": []}

    async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
        self.calls.append(("set_node_prompt", {"node_id": node_id, "prompt": prompt}))
        return {"nodeId": node_id, "actions": []}

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        self.calls.append(("attach_refs", {"node_id": node_id, "ref_order": ref_order}))
        return {"nodeId": node_id, "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        key = self.key_by_node.get(node_id, node_id)
        self.calls.append(("run_image_generation", {"node_id": node_id, "key": key}))
        if key in self.fail_keys:
            raise RuntimeError(f"gen failed: {key}")
        return {
            "nodeId": node_id,
            "status": "completed",
            "url": f"https://example.test/{node_id}.png",
            "actions": [],
        }


def _batch_keys(nest: FakeNest) -> set[str]:
    for name, payload in nest.calls:
        if name == "add_nodes_batch":
            return {item["key"] for item in payload}
    return set()


def check_skill_package(report: Report) -> None:
    entries = discover_skills(SKILLS_DIR)
    ids = {e.skill_id for e in entries}
    ok = SKILL_ID in ids
    detail = ""
    if ok:
        loaded = load_skill(next(e for e in entries if e.skill_id == SKILL_ID))
        skill_dir = loaded.index.path
        has_skill_md = (skill_dir / "SKILL.md").is_file()
        has_assets = (skill_dir / "assets" / "canvas-manifest.yaml").is_file()
        keys = {i["key"] for i in (loaded.canvas_manifest or {}).get("items", [])}
        ok = has_skill_md and has_assets and "white_bg" in keys and "hero_main" in keys
        detail = f"manifest keys={sorted(keys)[:4]}…" if ok else "missing manifest items"
    report.add(
        Check(
            id="skill_load",
            label=f"Load `{SKILL_ID}` marketing skill",
            ok=ok,
            detail=detail,
        )
    )
    report.add(
        Check(
            id="agentskills_io",
            label="Skill package follows agentskills.io (SKILL.md + assets/)",
            ok=ok and (SKILLS_DIR / SKILL_ID / "SKILL.md").is_file(),
            detail="see skills/enterprise-marketing-campaign/",
        )
    )


async def check_plan_confirm_split(report: Report) -> None:
    """Single graph + checkpointer thread: plan → confirm → split → orchestrate_gen."""
    nest = FakeNest()
    llm = FakeLLM(responses=[PLAN_MARKDOWN, "确认"])
    graph = build_agent_graph(nest=nest, llm=llm, skills_dir=SKILLS_DIR)
    config = {"configurable": {"thread_id": "e2e-smoke-plan"}}

    state1 = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="帮我设计一套卫生洁具的营销方案")],
            "session_id": "e2e-session",
            "thread_id": "e2e-smoke-plan",
            "user_id": "e2e-user",
        },
        config,
    )
    skill_ok = state1.get("skill_id") == SKILL_ID
    report.add(
        Check(
            id="skill_intake",
            label="Sanitary-ware prompt selects enterprise-marketing-campaign",
            ok=skill_ok,
        )
    )
    prompt_ok = any(c[0] == "upsert_prompt_node" for c in nest.calls) and bool(
        state1.get("plan_node_id")
    )
    report.add(
        Check(
            id="prompt_node",
            label="Canvas prompt plan node created (upsert_prompt_node)",
            ok=prompt_ok,
            detail=f"plan_node_id={state1.get('plan_node_id')}",
        )
    )
    state_ok = "nodes" not in state1 and "edges" not in state1
    report.add(
        Check(
            id="state_light",
            label="LangGraph State has no full canvas nodes/edges",
            ok=state_ok,
        )
    )

    state2 = await graph.ainvoke(
        {"messages": [HumanMessage(content="确认，按这个拆并出图")]},
        config,
    )
    keys = _batch_keys(nest)
    skeleton_ok = "white_bg" in keys and "hero_main" in keys
    report.add(
        Check(
            id="image_skeleton",
            label="After confirm: image skeletons (white_bg + hero_main)",
            ok=skeleton_ok,
            detail=f"keys={sorted(keys)}",
        )
    )
    has_edges = any(c[0] == "connect_nodes" for c in nest.calls)
    has_prompts = any(c[0] == "set_node_prompt" for c in nest.calls)
    has_refs = any(c[0] == "attach_refs" for c in nest.calls)
    report.add(
        Check(
            id="split_topology",
            label="Split adds edges + prompts + upstream refs",
            ok=has_edges and has_prompts and has_refs,
            detail=f"edges={has_edges} prompts={has_prompts} refs={has_refs}",
        )
    )
    gen_calls = [c for c in nest.calls if c[0] == "run_image_generation"]
    report.add(
        Check(
            id="auto_gen",
            label="orchestrate_gen invokes run_image_generation",
            ok=len(gen_calls) >= 2,
            detail=f"calls={len(gen_calls)}",
        )
    )
    report.add(
        Check(
            id="url_writeback",
            label="≥2 images write back url (白底 + 主图)",
            ok=len(gen_calls) >= 2 and state2.get("gen_completed"),
            detail="dry-run uses mock urls; live: verify in canvas UI",
            manual=True,
        )
    )
    state_ok = "nodes" not in state2 and "edges" not in state2
    report.add(
        Check(
            id="state_light_2",
            label="Post-split State still has no full canvas / Base64",
            ok=state_ok,
        )
    )


async def check_partial_failure(report: Report) -> None:
    nest = FakeNest(fail_keys={"hero_main"})
    nest.key_by_node = {"node-white_bg": "white_bg", "node-hero_main": "hero_main"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = [
        {"key": "white_bg", "target_type": "image", "auto_generate": True, "depends_on": [], "node_id": "node-white_bg"},
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": ["white_bg"], "node_id": "node-hero_main"},
    ]
    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )
    ok = result["gen_completed"] == ["node-white_bg"] and len(result["gen_failed"]) == 1
    report.add(
        Check(
            id="partial_fail",
            label="Partial failure list when downstream gen fails",
            ok=ok,
            detail=f"completed={result['gen_completed']} failed={len(result['gen_failed'])}",
        )
    )


async def check_revise_same_plan_node(report: Report) -> None:
    nest = FakeNest()
    llm = FakeLLM(responses=[PLAN_MARKDOWN, "# 修订\n更偏天猫详情页。\n"])
    graph = build_agent_graph(nest=nest, llm=llm, skills_dir=SKILLS_DIR)
    config = {"configurable": {"thread_id": "e2e-smoke-revise"}}

    state1 = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="帮我设计卫生洁具营销方案")],
            "session_id": "e2e-revise",
            "thread_id": "e2e-smoke-revise",
            "user_id": "e2e-user",
        },
        config,
    )
    plan_id_before = state1.get("plan_node_id")
    upsert_before = [c for c in nest.calls if c[0] == "upsert_prompt_node"]

    state2 = await graph.ainvoke(
        {"messages": [HumanMessage(content="改成更偏天猫详情页")]},
        config,
    )
    upsert_after = [c for c in nest.calls if c[0] == "upsert_prompt_node"]
    same_id = state2.get("plan_node_id") == plan_id_before
    reused = len(upsert_after) > len(upsert_before) and all(
        c[1].get("node_id") == plan_id_before for c in upsert_after[len(upsert_before) :]
    )
    report.add(
        Check(
            id="revise",
            label="revise updates same plan_node_id (no new plan node)",
            ok=bool(plan_id_before) and same_id and reused,
            detail=f"plan_node_id={plan_id_before}",
        )
    )


async def run_dry_run() -> Report:
    report = Report()
    check_skill_package(report)
    await check_plan_confirm_split(report)
    await check_partial_failure(report)
    await check_revise_same_plan_node(report)
    return report


def _fetch_json(url: str, timeout: float = 5.0) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def run_live(runtime_url: str, nest_url: str) -> Report:
    report = Report()
    runtime_health = f"{runtime_url.rstrip('/')}/health"
    try:
        data = _fetch_json(runtime_health)
        ok = data.get("ok") is True and data.get("service") == "agent-runtime"
        report.add(
            Check(
                id="runtime_health",
                label=f"Runtime health {runtime_health}",
                ok=ok,
                detail=str(data),
            )
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        report.add(
            Check(
                id="runtime_health",
                label=f"Runtime health {runtime_health}",
                ok=False,
                detail=str(exc),
            )
        )

    nest_health = f"{nest_url.rstrip('/')}/health"
    try:
        _fetch_json(nest_health)
        report.add(
            Check(
                id="nest_health",
                label=f"Nest reachable {nest_health}",
                ok=True,
            )
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        report.add(
            Check(
                id="nest_health",
                label=f"Nest reachable {nest_health}",
                ok=False,
                detail=str(exc),
            )
        )

    report.add(
        Check(
            id="live_manual",
            label="Live stack: web chat → confirm → canvas urls visible",
            ok=True,
            detail="see README «Dual-process run» + «Acceptance checklist»",
            manual=True,
        )
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("dry-run", "live"),
        default="dry-run",
        help="dry-run = in-process (default); live = probe health + manual steps",
    )
    parser.add_argument("--runtime-url", default="http://127.0.0.1:8000")
    parser.add_argument("--nest-url", default="http://127.0.0.1:3000/api")
    args = parser.parse_args()

    if args.mode == "live":
        report = run_live(args.runtime_url, args.nest_url)
    else:
        report = asyncio.run(run_dry_run())

    report.print_summary()
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
