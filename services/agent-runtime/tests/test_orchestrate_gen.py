"""Tests for orchestrate_gen: topo order, concurrency, skip on dep failure."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node


class FakeNest:
    def __init__(
        self,
        *,
        fail_keys: set[str] | None = None,
        soft_error_keys: set[str] | None = None,
        fallback_keys: set[str] | None = None,
        fail_times: dict[str, int] | None = None,
    ) -> None:
        self.fail_keys = fail_keys or set()
        self.soft_error_keys = soft_error_keys or set()
        self.fallback_keys = fallback_keys or set()
        self.fail_times = fail_times or {}
        self._fail_counts: dict[str, int] = {}
        self.calls: list[str] = []
        self.video_calls: list[str] = []
        self.task_updates: list[dict[str, Any]] = []
        self.key_by_node: dict[str, str] = {}
        self.ref_calls: list[tuple[str, list[str]]] = []

    async def emit_task_update(self, **payload: Any) -> None:
        self.task_updates.append(payload)

    async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
        self.task_list = items

    async def emit_task_summary(self, **payload: Any) -> None:
        self.task_summary = payload

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        self.ref_calls.append((node_id, list(ref_order)))
        return {"nodeId": node_id, "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        key = self.key_by_node.get(node_id, node_id)
        self.calls.append(key)
        self._fail_counts[key] = self._fail_counts.get(key, 0) + 1
        if key in self.fallback_keys:
            return {"nodeId": node_id, "status": "fallback_pending", "actions": []}
        need = self.fail_times.get(key, 0)
        if need and self._fail_counts[key] <= need:
            raise RuntimeError(f"timeout: {key}")
        if key in self.fail_keys:
            raise RuntimeError(f"gen failed: {key}")
        if key in self.soft_error_keys:
            return {"nodeId": node_id, "status": "error", "actions": []}
        return {"nodeId": node_id, "status": "completed"}

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        key = self.key_by_node.get(node_id, node_id)
        self.video_calls.append(key)
        self.calls.append(key)
        return {"nodeId": node_id, "status": "completed", "url": "https://cdn.example/v.mp4"}


def _manifest(*pairs: tuple[str, list[str]]) -> list[dict[str, Any]]:
    """Build image auto_generate manifest; node_id = node-{key}."""
    items = []
    for key, deps in pairs:
        items.append(
            {
                "key": key,
                "target_type": "image",
                "auto_generate": True,
                "depends_on": deps,
                "node_id": f"node-{key}",
            }
        )
    return items


@pytest.mark.asyncio
async def test_orchestrate_white_bg_success_then_hero_called():
    nest = FakeNest()
    nest.key_by_node = {"node-white_bg": "white_bg", "node-hero_main": "hero_main"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = _manifest(
        ("hero_main", ["white_bg"]),
        ("white_bg", []),
    )
    # video must be ignored even if present
    manifest.append(
        {
            "key": "show_video",
            "target_type": "video",
            "auto_generate": False,
            "depends_on": ["hero_main"],
            "node_id": "node-show_video",
        }
    )

    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )

    assert nest.calls == ["white_bg", "hero_main"]
    assert result["gen_completed"] == ["node-white_bg", "node-hero_main"]
    assert getattr(nest, "task_list", None) is None  # must not replace split task_list
    assert result["gen_failed"] == []
    assert result["gen_queue"] == ["node-white_bg", "node-hero_main"]
    assert result["phase"] == "orchestrate_gen"
    assert any(isinstance(m, AIMessage) for m in result["messages"])


@pytest.mark.asyncio
async def test_orchestrate_white_bg_fail_skips_hero():
    nest = FakeNest(fail_keys={"white_bg"})
    nest.key_by_node = {"node-white_bg": "white_bg", "node-hero_main": "hero_main"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = _manifest(
        ("hero_main", ["white_bg"]),
        ("white_bg", []),
    )

    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )

    assert nest.calls == ["white_bg", "white_bg", "white_bg"]
    assert "hero_main" not in nest.calls
    assert result["gen_completed"] == []
    by_key = {f["key"]: f for f in result["gen_failed"]}
    assert "white_bg" in by_key
    assert by_key["hero_main"]["reason"] == "dependency_failed"


@pytest.mark.asyncio
async def test_orchestrate_soft_error_status_skips_dependents():
    nest = FakeNest(soft_error_keys={"white_bg"})
    nest.key_by_node = {"node-white_bg": "white_bg", "node-hero_main": "hero_main"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = _manifest(
        ("hero_main", ["white_bg"]),
        ("white_bg", []),
    )

    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )

    assert nest.calls == ["white_bg", "white_bg", "white_bg"]
    assert "hero_main" not in nest.calls
    assert result["gen_completed"] == []
    by_key = {f["key"]: f for f in result["gen_failed"]}
    assert by_key["white_bg"]["reason"] == "error"
    assert by_key["hero_main"]["reason"] == "dependency_failed"


@pytest.mark.asyncio
async def test_fallback_pending_needs_user_no_retry():
    nest = FakeNest(fallback_keys={"banner"})
    nest.key_by_node = {"node-banner": "banner"}
    node = make_orchestrate_gen_node(nest=nest)
    result = await node(
        {
            "split_manifest": _manifest(("banner", [])),
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )
    assert nest.calls == ["banner"]
    assert any(u.get("status") == "needs_user" for u in nest.task_updates)
    assert result["gen_failed"][0]["reason"] == "fallback_pending"


@pytest.mark.asyncio
async def test_retries_recoverable_then_succeeds():
    nest = FakeNest(fail_times={"banner": 2})
    nest.key_by_node = {"node-banner": "banner"}
    node = make_orchestrate_gen_node(nest=nest)
    result = await node(
        {
            "split_manifest": _manifest(("banner", [])),
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )
    assert nest.calls == ["banner", "banner", "banner"]
    assert result["gen_completed"] == ["node-banner"]
    assert any(u.get("status") == "retrying" for u in nest.task_updates)


@pytest.mark.asyncio
async def test_video_auto_generate_invokes_run_video():
    nest = FakeNest()
    nest.key_by_node = {"node-hero_main": "hero_main", "node-show_video": "show_video"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = _manifest(("hero_main", []))
    manifest.append(
        {
            "key": "show_video",
            "title": "产品展示视频",
            "target_type": "video",
            "auto_generate": True,
            "depends_on": ["hero_main"],
            "node_id": "node-show_video",
        }
    )
    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )
    assert nest.video_calls == ["show_video"]
    assert "node-show_video" in result["gen_completed"]


@pytest.mark.asyncio
async def test_orchestrate_attaches_chain_refs_before_gen():
    nest = FakeNest()
    nest.key_by_node = {
        "n-w": "white_bg",
        "n-ta": "product_turnaround",
        "n-hero": "hero_main",
    }
    node = make_orchestrate_gen_node(nest=nest, max_concurrency=1)
    out = await node(
        {
            "plan_node_id": "n-plan",
            "split_manifest": [
                {
                    "key": "white_bg",
                    "title": "白底",
                    "target_type": "image",
                    "auto_generate": True,
                    "chain": "product",
                    "role": "seed",
                    "depends_on": [],
                    "node_id": "n-w",
                },
                {
                    "key": "product_turnaround",
                    "title": "四视图",
                    "target_type": "image",
                    "auto_generate": True,
                    "chain": "product",
                    "role": "turnaround",
                    "depends_on": ["white_bg"],
                    "node_id": "n-ta",
                },
                {
                    "key": "hero_main",
                    "title": "主图",
                    "target_type": "image",
                    "auto_generate": True,
                    "chain": "product",
                    "role": "downstream",
                    "depends_on": ["product_turnaround", "white_bg"],
                    "node_id": "n-hero",
                },
            ],
            "gen_completed": [],
            "gen_failed": [],
        }
    )
    assert nest.calls == ["white_bg", "product_turnaround", "hero_main"]
    hero_refs = [r for r in nest.ref_calls if r[0] == "n-hero"]
    assert hero_refs
    assert hero_refs[-1][1] == ["n-plan", "n-w", "n-ta"]
    assert out.get("gen_completed")
