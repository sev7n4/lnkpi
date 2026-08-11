"""L1 macro scheme selection (spec §1.4, R-Macro-Scheme-Select)."""

from __future__ import annotations

from typing import Any

from app.graph.product_visual_v2.limits import MAX_MACRO_SCHEMES_SELECTED
from app.graph.product_visual_v2.models import MacroScheme


def should_skip_macro_hitl(macro_schemes: list[MacroScheme] | list[dict] | None) -> bool:
    return len(_as_dicts(macro_schemes)) <= 1


def normalize_recommended_macros(macro_schemes: list[MacroScheme]) -> list[MacroScheme]:
    """Ensure at most one recommended; if none, recommend first."""
    if not macro_schemes:
        return []
    recommended = [m for m in macro_schemes if m.recommended]
    if len(recommended) > 1:
        raise ValueError("at most one macro scheme may be recommended")
    if not recommended:
        out = [m.model_copy() for m in macro_schemes]
        out[0] = out[0].model_copy(update={"recommended": True})
        return out
    return macro_schemes


def validate_macro_selection(selected_ids: list[str]) -> str | None:
    cleaned = [str(s).strip() for s in selected_ids if str(s).strip()]
    if not cleaned:
        return "至少选择一个宏观方案"
    if len(cleaned) > MAX_MACRO_SCHEMES_SELECTED:
        return f"最多选择 {MAX_MACRO_SCHEMES_SELECTED} 个宏观方案"
    if len(set(cleaned)) != len(cleaned):
        return "宏观方案不可重复选择"
    return None


def apply_macro_selection(
    macro_schemes: list[MacroScheme] | list[dict],
    selected_ids: list[str],
) -> dict[str, Any]:
    err = validate_macro_selection(selected_ids)
    if err:
        raise ValueError(err)
    valid = {str(m["id"] if isinstance(m, dict) else m.id) for m in macro_schemes}
    for sid in selected_ids:
        if sid not in valid:
            raise ValueError(f"unknown macro scheme {sid!r}")
    return {
        "selected_macro_scheme_ids": list(selected_ids),
        "phase": "canvas_ssot_commit",
    }


def default_macro_selection(macro_schemes: list[MacroScheme] | list[dict]) -> list[str]:
    schemes = _as_dicts(macro_schemes)
    if not schemes:
        return []
    recommended = [str(s["id"]) for s in schemes if s.get("recommended")]
    if recommended:
        return recommended[:1]
    return [str(schemes[0]["id"])]


def _as_dicts(macro_schemes: list[MacroScheme] | list[dict] | None) -> list[dict]:
    out: list[dict] = []
    for item in macro_schemes or []:
        if isinstance(item, MacroScheme):
            out.append(item.model_dump(mode="json"))
        elif isinstance(item, dict):
            out.append(item)
    return out
