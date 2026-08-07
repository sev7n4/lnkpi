"""Task 4: atomic create applies sidebar localRefs after batch create."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.atomic_create_node import make_create_atomic_node


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {
            "nodes": [
                {"key": item["key"], "nodeId": f"node-{idx + 1}"}
                for idx, item in enumerate(items)
            ],
        }

    async def apply_sidebar_attachments(
        self,
        *,
        node_ids: list[str],
        attachments: list[dict],
        ref_order: list[str] | None,
        mode: str,
        mentioned_keys: list[str] | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "apply_sidebar_attachments",
                {
                    "node_ids": node_ids,
                    "attachments": attachments,
                    "ref_order": ref_order,
                    "mode": mode,
                    "mentioned_keys": mentioned_keys,
                },
            )
        )
        return {"applied": len(node_ids)}

    async def update_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("update_nodes_batch", items))
        return {"actions": []}


@pytest.mark.asyncio
async def test_atomic_create_applies_sidebar_local_refs():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    attachments = [{"materialId": "mat-1", "role": "reference"}]
    ref_order = ["mat-1"]

    out = await create(
        {
            "atomic_spec": {
                "target_type": "image",
                "prompt": "主图",
                "title": "主图",
            },
            "sidebar_attachments": attachments,
            "sidebar_ref_order": ref_order,
        }
    )

    assert out["atomic_node_id"] == "node-1"
    apply_calls = [c for c in nest.calls if c[0] == "apply_sidebar_attachments"]
    assert len(apply_calls) == 1
    payload = apply_calls[0][1]
    assert payload["node_ids"] == ["node-1"]
    assert payload["attachments"] == attachments
    assert payload["ref_order"] == ref_order
    assert payload["mode"] == "localRefs"


@pytest.mark.asyncio
async def test_atomic_create_skips_apply_when_no_attachments():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)

    await create(
        {
            "atomic_spec": {
                "target_type": "image",
                "prompt": "主图",
                "title": "主图",
            },
        }
    )

    assert not any(c[0] == "apply_sidebar_attachments" for c in nest.calls)


@pytest.mark.asyncio
async def test_atomic_create_applies_refs_to_all_created_nodes():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    attachments = [{"materialId": "mat-1"}]

    out = await create(
        {
            "atomic_items": [
                {"target_type": "image", "prompt": "图1", "title": "图1"},
                {"target_type": "image", "prompt": "图2", "title": "图2"},
            ],
            "sidebar_attachments": attachments,
        }
    )

    assert len(out["atomic_items"]) == 2
    apply_calls = [c for c in nest.calls if c[0] == "apply_sidebar_attachments"]
    assert len(apply_calls) == 1
    assert apply_calls[0][1]["node_ids"] == ["node-1", "node-2"]
    assert apply_calls[0][1]["mode"] == "localRefs"


@pytest.mark.asyncio
async def test_atomic_create_patches_mentioned_keys_after_sidebar_apply():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    attachments = [{"materialId": "mat-1", "role": "reference"}]

    await create(
        {
            "atomic_spec": {
                "target_type": "image",
                "prompt": "主图",
                "title": "主图",
            },
            "sidebar_attachments": attachments,
            "sidebar_mentioned_keys": ["I1", "T1"],
        }
    )

    apply_calls = [c for c in nest.calls if c[0] == "apply_sidebar_attachments"]
    assert len(apply_calls) == 1
    assert apply_calls[0][1]["mentioned_keys"] == ["I1", "T1"]
    assert not any(c[0] == "update_nodes_batch" for c in nest.calls)


@pytest.mark.asyncio
async def test_atomic_create_patches_mentioned_keys_without_attachments():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)

    await create(
        {
            "atomic_spec": {
                "target_type": "image",
                "prompt": "主图",
                "title": "主图",
            },
            "sidebar_mentioned_keys": ["I1"],
        }
    )

    apply_calls = [c for c in nest.calls if c[0] == "apply_sidebar_attachments"]
    assert len(apply_calls) == 1
    assert apply_calls[0][1]["mentioned_keys"] == ["I1"]
    assert apply_calls[0][1]["attachments"] == []


@pytest.mark.asyncio
async def test_atomic_create_parses_mentioned_keys_from_user_message():
    from langchain_core.messages import HumanMessage

    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    attachments = [{"materialId": "mat-1"}]

    await create(
        {
            "atomic_spec": {
                "target_type": "image",
                "prompt": "主图",
                "title": "主图",
            },
            "sidebar_attachments": attachments,
            "messages": [HumanMessage(content="按 @I1 风格生成主图")],
        }
    )

    apply_calls = [c for c in nest.calls if c[0] == "apply_sidebar_attachments"]
    assert apply_calls[0][1]["mentioned_keys"] == ["I1"]


@pytest.mark.asyncio
async def test_atomic_create_skips_mentioned_keys_patch_when_empty():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)

    await create(
        {
            "atomic_spec": {
                "target_type": "image",
                "prompt": "主图",
                "title": "主图",
            },
            "sidebar_mentioned_keys": [],
        }
    )

    assert not any(c[0] == "apply_sidebar_attachments" for c in nest.calls)
    assert not any(c[0] == "update_nodes_batch" for c in nest.calls)
