"""Unit tests for gen_node (Send-API single-task generation worker).

gen_node is invoked via ``Send("gen_node", {"key": k, "gen_by_key": ..., "plan_node_id": ...})``
so each test calls the node directly with that payload dict and asserts on the
returned state update (never on graph wiring — that's test_gen_scheduler).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.gen_node import make_gen_node


class FakeNest:
    """Records calls; configurable per-key failure modes."""

    def __init__(
        self,
        *,
        fail_keys: set[str] | None = None,
        soft_error_keys: set[str] | None = None,
        fallback_keys: set[str] | None = None,
        fail_times: dict[str, int] | None = None,
        video_keys: set[str] | None = None,
    ) -> None:
        self.fail_keys = fail_keys or set()
        self.soft_error_keys = soft_error_keys or set()
        self.fallback_keys = fallback_keys or set()
        self.fail_times = fail_times or {}
        self.video_keys = video_keys or set()
        self._fail_counts: dict[str, int] = {}
        self.image_calls: list[str] = []
        self.video_calls: list[str] = []
        self.task_updates: list[dict[str, Any]] = []
        self.text_chunks: list[str] = []
        self.ref_calls: list[tuple[str, list[str]]] = []

    async def emit_task_update(self, **payload: Any) -> None:
        self.task_updates.append(payload)

    async def emit_task_summary(self, **payload: Any) -> None:
        pass

    async def emit_text(self, text: str) -> None:
        self.text_chunks.append(text)

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        self.ref_calls.append((node_id, list(ref_order)))
        return {"nodeId": node_id, "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        key = self._key_for(node_id)
        self.image_calls.append(key)
        return self._gen(key, node_id)

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        key = self._key_for(node_id)
        self.video_calls.append(key)
        return self._gen(key, node_id)

    def _key_for(self, node_id: str) -> str:
        # node_id pattern: node-{key}
        return node_id.replace("node-", "") if node_id.startswith("node-") else node_id

    def _gen(self, key: str, node_id: str) -> dict[str, Any]:
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


def _item(
    key: str,
    *,
    node_id: str | None = "node-" + "k",
    title: str = "t",
    target_type: str = "image",
    depends_on: list[str] | None = None,
    chain: str | None = None,
    role: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "node_id": node_id,
        "title": title,
        "target_type": target_type,
        "depends_on": depends_on or [],
        "chain": chain,
        "role": role,
    }


def _state(key: str, by_key: dict[str, dict], plan_node_id: str | None = None) -> dict[str, Any]:
    return {"key": key, "gen_by_key": by_key, "plan_node_id": plan_node_id}


@pytest.mark.asyncio
async def test_gen_node_success_returns_completed():
    nest = FakeNest()
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id="node-k")}
    out = await node(_state("k", by_key))
    assert out == {"gen_completed_keys": ["k"]}
    assert nest.image_calls == ["k"]
    assert any(u.get("status") == "done" for u in nest.task_updates)


@pytest.mark.asyncio
async def test_gen_node_missing_node_id_fails_without_calling_nest():
    nest = FakeNest()
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id=None, title="无节点")}
    out = await node(_state("k", by_key))
    assert out["gen_failed_keys"] == ["k"]
    assert out["gen_fail_details"]["k"]["reason"] == "missing_node_id"
    assert nest.image_calls == []  # never called run_image_generation
    assert any(u.get("status") == "failed" for u in nest.task_updates)


@pytest.mark.asyncio
async def test_gen_node_hard_fail_after_retries():
    nest = FakeNest(fail_keys={"k"})
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id="node-k")}
    out = await node(_state("k", by_key))
    # max_auto_retries=2 → 3 total attempts
    assert nest.image_calls == ["k", "k", "k"]
    assert out["gen_failed_keys"] == ["k"]
    assert "gen failed" in out["gen_fail_details"]["k"]["reason"]
    assert any(u.get("status") == "failed" for u in nest.task_updates)


@pytest.mark.asyncio
async def test_gen_node_soft_error_retries_then_fails():
    nest = FakeNest(soft_error_keys={"k"})
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id="node-k")}
    out = await node(_state("k", by_key))
    assert nest.image_calls == ["k", "k", "k"]
    assert out["gen_failed_keys"] == ["k"]
    # soft_error (status="error") is recoverable → exhausted retries → failed


@pytest.mark.asyncio
async def test_gen_node_fallback_pending_needs_user_no_chat_line():
    nest = FakeNest(fallback_keys={"k"})
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id="node-k", title="Banner")}
    out = await node(_state("k", by_key))
    assert nest.image_calls == ["k"]  # fallback_pending is non-recoverable → no retry
    assert out["gen_needs_user_keys"] == ["k"]
    assert out["gen_fail_details"]["k"]["reason"] == "fallback_pending"
    assert any(u.get("status") == "needs_user" for u in nest.task_updates)
    # P1-5: fallback_pending must NOT emit a chat line (canvas dialog handles it)
    for chunk in nest.text_chunks:
        assert "Banner" not in chunk


@pytest.mark.asyncio
async def test_gen_node_recoverable_then_success():
    nest = FakeNest(fail_times={"k": 2})  # fail twice, succeed on 3rd
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id="node-k")}
    out = await node(_state("k", by_key))
    assert nest.image_calls == ["k", "k", "k"]
    assert out == {"gen_completed_keys": ["k"]}
    assert any(u.get("status") == "retrying" for u in nest.task_updates)


@pytest.mark.asyncio
async def test_gen_node_video_calls_run_video_generation():
    nest = FakeNest()
    node = make_gen_node(nest=nest)
    by_key = {"k": _item("k", node_id="node-k", target_type="video")}
    out = await node(_state("k", by_key))
    assert nest.video_calls == ["k"]
    assert nest.image_calls == []
    assert out == {"gen_completed_keys": ["k"]}


@pytest.mark.asyncio
async def test_gen_node_attaches_chain_refs_in_correct_order():
    """downstream product node: refs = [plan, seed, turnaround, ...deps]."""
    nest = FakeNest()
    node = make_gen_node(nest=nest)
    by_key = {
        "plan": _item("plan", node_id="n-plan", chain=None, role=None),
        "white_bg": _item("white_bg", node_id="n-w", chain="product", role="seed"),
        "turnaround": _item("turnaround", node_id="n-ta", chain="product", role="turnaround", depends_on=["white_bg"]),
        "hero": _item("hero", node_id="n-hero", chain="product", role="downstream", depends_on=["turnaround", "white_bg"]),
    }
    await node(_state("hero", by_key, plan_node_id="n-plan"))
    assert nest.ref_calls
    hero_ref = [r for r in nest.ref_calls if r[0] == "n-hero"][-1]
    # order: plan → seed → turnaround (deps already covered by turnaround)
    assert hero_ref[1] == ["n-plan", "n-w", "n-ta"]
