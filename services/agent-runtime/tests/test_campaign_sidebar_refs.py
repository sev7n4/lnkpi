"""Campaign sidebar attachments are materialized as visible canvas references."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.apply_sidebar_refs import make_apply_sidebar_refs_node


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def apply_sidebar_attachments(
        self,
        *,
        node_ids: list[str],
        attachments: list[dict[str, Any]],
        ref_order: list[str] | None,
        mode: str,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "apply_sidebar_attachments",
                {
                    "node_ids": node_ids,
                    "attachments": attachments,
                    "ref_order": ref_order,
                    "mode": mode,
                },
            )
        )
        return {"sourceNodeIds": ["media-brand"]}

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        self.calls.append(("attach_refs", {"node_id": node_id, "ref_order": ref_order}))
        return {"actions": []}


@pytest.mark.asyncio
async def test_campaign_apply_attaches_sidebar_sources_to_seed_node():
    nest = FakeNest()
    apply_sidebar_refs = make_apply_sidebar_refs_node(nest=nest)
    attachments = [
        {
            "id": "brand",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "brand.jpg",
            "url": "https://cdn.example.com/brand.jpg",
        }
    ]

    out = await apply_sidebar_refs(
        {
            "sidebar_attachments": attachments,
            "sidebar_ref_order": ["brand"],
            "split_manifest": [
                {"key": "copy", "target_type": "text", "node_id": "text-1"},
                {
                    "key": "hero",
                    "target_type": "image",
                    "role": "seed",
                    "node_id": "image-seed",
                },
            ],
        }
    )

    assert out == {}
    assert nest.calls == [
        (
            "apply_sidebar_attachments",
            {
                "node_ids": ["image-seed"],
                "attachments": attachments,
                "ref_order": ["brand"],
                "mode": "attach_edges",
            },
        ),
        ("attach_refs", {"node_id": "image-seed", "ref_order": ["media-brand"]}),
    ]


@pytest.mark.asyncio
async def test_campaign_apply_falls_back_to_local_refs_without_target_node():
    nest = FakeNest()
    apply_sidebar_refs = make_apply_sidebar_refs_node(nest=nest)
    attachments = [
        {
            "id": "brief",
            "mediaType": "text",
            "sourceKind": "asset",
            "label": "卖点",
            "text": "静音排水",
        }
    ]

    await apply_sidebar_refs(
        {
            "sidebar_attachments": attachments,
            "sidebar_ref_order": ["brief"],
            "split_manifest": [{"key": "copy", "target_type": "text", "node_id": "text-1"}],
        }
    )

    assert nest.calls == [
        (
            "apply_sidebar_attachments",
            {
                "node_ids": ["text-1"],
                "attachments": attachments,
                "ref_order": ["brief"],
                "mode": "localRefs",
            },
        )
    ]
