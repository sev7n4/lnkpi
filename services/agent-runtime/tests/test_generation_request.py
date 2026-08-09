"""T22: GenerationRequest DTO — sidebar vs Dock parity."""

from __future__ import annotations

from langchain_core.messages import HumanMessage

from app.graph.generation_request import (
    build_generation_request_from_atomic_state,
    build_generation_request_from_dock,
    generation_request_parity_keys,
)

STYLE3 = "@T1 请按风格3出图"
T1_REF = {"refKey": "T1", "mediaType": "text", "text": "风格3说明正文"}


def test_style3_sidebar_dock_parity():
    sidebar_state = {
        "messages": [HumanMessage(content=STYLE3)],
        "sidebar_mentioned_keys": ["T1"],
        "sidebar_attachments": [dict(T1_REF)],
        "atomic_spec": {
            "target_type": "image",
            "prompt": STYLE3,
            "title": STYLE3[:24],
            "confirm_gate": False,
        },
        "atomic_node_id": "image-style3",
    }
    dock_node = {
        "id": "image-style3",
        "type": "image",
        "data": {"prompt": STYLE3},
    }
    sidebar_req = build_generation_request_from_atomic_state(sidebar_state)
    dock_req = build_generation_request_from_dock(
        dock_node,
        refs=[T1_REF],
        mentioned_keys=["T1"],
    )
    assert generation_request_parity_keys(sidebar_req) == generation_request_parity_keys(dock_req)
    assert sidebar_req["slots"] == {"ref": "T1", "style": "3"}
    assert sidebar_req["modality"] == "image"
    assert sidebar_req["prompt"] == STYLE3


def test_atomic_state_uses_spec_prompt():
    state = {
        "messages": [HumanMessage(content="帮我生成一张蓝牙耳机主图")],
        "atomic_spec": {
            "target_type": "image",
            "prompt": "帮我生成一张蓝牙耳机主图",
            "title": "蓝牙耳机主图",
        },
    }
    req = build_generation_request_from_atomic_state(state)
    assert req["prompt"] == "帮我生成一张蓝牙耳机主图"
    assert req["modality"] == "image"
    assert req["mentioned_keys"] == []
