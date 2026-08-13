"""Tests for product_visual v2 UX fixes (P0-P2)."""

from __future__ import annotations

import pytest

from app.graph.nodes.await_shot_topo_confirm import make_await_shot_topo_confirm_node
from app.graph.nodes.done import make_done_node
from app.graph.product_visual_v2.dialog_draft_fallback import build_fallback_dialog_draft
from app.graph.product_visual_v2.errors import build_error_presentation, format_flow_end_message
from app.graph.product_visual_v2.limits import MAX_SHOTS_PER_MACRO_SCHEME, enforce_shot_limits
from app.graph.product_visual_v2.presentation import build_context_recap
from app.graph.product_visual_v2.visual_intent import humanize_primary_goal, normalize_visual_intent


def _shot(idx: int, macro: str = "A") -> dict:
    return {
        "shot_id": f"hero__{idx}",
        "type_id": "hero",
        "label": f"构图{idx}",
        "macro_scheme_id": macro,
        "variant_count": 1,
    }


def test_enforce_shot_limits_truncates_per_macro():
    shots = [_shot(i) for i in range(1, 12)]
    trimmed, notes = enforce_shot_limits(shots, ["A"])
    assert len(trimmed) == MAX_SHOTS_PER_MACRO_SCHEME
    assert any("合并" in n for n in notes)


def test_format_flow_end_message_maps_codes():
    assert "简化方案" in format_flow_end_message("dialog_draft_parse_failed", {})
    assert "自动合并" in format_flow_end_message("macro 'A' has 11 shots (max 8)", {})


def test_build_error_presentation_stepper_done():
    pres = build_error_presentation(
        {"last_error": "shot_manifest_missing", "visual_intent": {"primary_goal": "packaging_design"}},
    )
    assert pres["stepper"]["current"] == "done"
    assert pres["kind"] == "callout_error"
    assert "packaging_design" not in pres["context_recap"]


def test_build_context_recap_humanizes_goal():
    recap = build_context_recap(
        {
            "visual_intent": {"primary_goal": "packaging_design"},
            "effective_utterance": "",
        }
    )
    assert recap == "包装推广"


def test_normalize_visual_intent_listing_over_packaging():
    intent = normalize_visual_intent(
        {"primary_goal": "packaging_design"},
        "需要主图、详情页、模特展示场景图和营销海报",
    )
    assert intent["primary_goal"] == "mixed_ecommerce"


def test_fallback_dialog_draft_has_macros_and_sections():
    draft = build_fallback_dialog_draft("大闸蟹主图详情页模特海报")
    assert len(draft.macro_schemes) >= 2
    assert "## 我理解您的需求" in draft.draft_prose
    labels = draft.visual_intent.get("output_types_requested") or []
    assert labels


def test_humanize_primary_goal():
    assert humanize_primary_goal("mixed_ecommerce") == "电商 Listing 出图"


@pytest.mark.asyncio
async def test_done_v2_error_uses_friendly_message():
    done = make_done_node()
    out = await done(
        {
            "flow_mode": "product_visual",
            "product_visual_scheme_v2": True,
            "phase": "error",
            "last_error": "dialog_draft_parse_failed",
        }
    )
    assert out["phase"] == "done"
    assert "dialog_draft_parse_failed" not in out["messages"][0].content
    assert out.get("presentation", {}).get("stepper", {}).get("current") == "done"


@pytest.mark.asyncio
async def test_topo_gate_confirm_without_manifest_returns_error():
    from langchain_core.messages import HumanMessage

    gate = make_await_shot_topo_confirm_node()
    out = await gate(
        {
            "messages": [HumanMessage(content="确认构图并开始出图")],
            "shot_manifest": [],
        }
    )
    assert out["phase"] == "error"
    assert out["last_error"] == "shot_manifest_missing"
