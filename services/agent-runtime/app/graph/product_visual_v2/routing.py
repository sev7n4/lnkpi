"""V2 graph routing helpers (spec §2.1, §4.2)."""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.graph.product_visual_v2.macro_select import should_skip_macro_hitl


def is_v2_enabled(state: dict | None = None) -> bool:
    if isinstance(state, dict) and state.get("product_visual_scheme_v2") is not None:
        return bool(state["product_visual_scheme_v2"])
    return bool(getattr(settings, "product_visual_scheme_v2", False))


def route_after_image_qa_check_v2(state: dict) -> str:
    if state.get("phase") == "error":
        return "done"
    result = state.get("image_qa_result")
    if result in ("pass", "remediated"):
        if state.get("requires_standard_product_assets"):
            return "phase1_seed_eager"
        return "dialog_draft"
    if result == "fail":
        return "await_image_qa"
    return "end"


def route_after_dialog_draft(state: dict) -> str:
    if state.get("phase") == "error":
        return "done"
    schemes = state.get("macro_schemes") or []
    if should_skip_macro_hitl(schemes):
        return "canvas_ssot_commit"
    return "await_macro_scheme_select"


def route_after_macro_scheme_select(state: dict) -> str:
    decision = state.get("macro_scheme_decision") or "none"
    if decision == "revise":
        return "dialog_draft"
    if decision in ("confirm", "auto"):
        return "canvas_ssot_commit"
    return "end"
