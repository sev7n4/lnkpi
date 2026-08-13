"""Visual intent normalization for product_visual v2."""

from __future__ import annotations

from typing import Any

_LISTING_KEYWORDS: tuple[str, ...] = (
    "主图",
    "详情页",
    "详情",
    "listing",
    "模特",
    "海报",
    "营销",
    "细节图",
    "产品细节",
    "物流",
    "电商标准",
    "六类",
)

_GOAL_LABELS: dict[str, str] = {
    "packaging_design": "包装推广",
    "mixed_ecommerce": "电商 Listing 出图",
    "hero_listing": "电商主图",
    "product_detail": "详情页场景",
    "lifestyle": "生活场景",
    "interior_design": "空间设计",
}


def humanize_primary_goal(goal: str) -> str:
    cleaned = str(goal or "").strip()
    if not cleaned:
        return ""
    return _GOAL_LABELS.get(cleaned, cleaned.replace("_", " "))


def infer_primary_goal_from_text(user_text: str) -> str | None:
    text = str(user_text or "")
    hits = sum(1 for kw in _LISTING_KEYWORDS if kw in text)
    if hits >= 2 or ("主图" in text and ("详情" in text or "模特" in text)):
        return "mixed_ecommerce"
    if "主图" in text or "白底" in text:
        return "hero_listing"
    if any(k in text for k in ("包装", "礼盒", "快递防压")):
        return "packaging_design"
    return None


def normalize_visual_intent(intent: dict[str, Any] | None, user_text: str) -> dict[str, Any]:
    """Prefer listing/mixed goals when user enumerates standard ecommerce deliverables."""
    out = dict(intent or {})
    inferred = infer_primary_goal_from_text(user_text)
    current = str(out.get("primary_goal") or "").strip()

    if inferred and (not current or current == "packaging_design"):
        out["primary_goal"] = inferred

    output_types = out.get("output_types_requested")
    if not isinstance(output_types, list):
        output_types = []
    out["output_types_requested"] = [str(t).strip() for t in output_types if str(t).strip()]

    return out
