"""Build split manifest from shot_manifest (spec Phase 3b)."""

from __future__ import annotations

from typing import Any

from app.graph.product_visual_v2.synthesize import synthesize_gen_prompt_hint


def refs_to_depends(refs_policy: dict[str, Any] | None) -> list[str]:
    if not isinstance(refs_policy, dict):
        return []
    requires = refs_policy.get("requires") or []
    return [str(k).strip() for k in requires if str(k).strip() in ("white_bg", "product_turnaround")]


def build_gen_items_from_shots(
    shots: list[dict[str, Any]],
    *,
    visual_intent: dict[str, Any] | None,
    synthesized_hints: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Expand shots × variant_count into downstream manifest items."""
    items: list[dict[str, Any]] = []
    hints = synthesized_hints or {}
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        shot_id = str(shot.get("shot_id") or "").strip()
        type_id = str(shot.get("type_id") or "").strip()
        label = str(shot.get("label") or shot_id).strip()
        if not shot_id or not type_id:
            continue
        variants = max(1, min(3, int(shot.get("variant_count") or 1)))
        shot_prose = str(shot.get("shot_prose") or "").strip()
        depends = refs_to_depends(shot.get("refs_policy"))
        for v in range(1, variants + 1):
            key = shot_id if variants == 1 else f"{shot_id}__v{v}"
            title = label if variants == 1 else f"{label} · 候选{v}"
            prompt_hint = hints.get(key) or synthesize_gen_prompt_hint(
                shot_prose=shot_prose,
                shot_label=label,
                type_id=type_id,
                visual_intent=visual_intent,
            )
            items.append(
                {
                    "key": key,
                    "title": title,
                    "target_type": "image",
                    "chain": "product",
                    "role": "downstream",
                    "auto_generate": True,
                    "depends_on": depends,
                    "prompt_hint": prompt_hint,
                    "type_id": type_id,
                    "shot_id": shot_id,
                    "variant_index": v,
                    "macro_scheme_id": shot.get("macro_scheme_id"),
                    "shot_node_id": shot.get("node_id"),
                }
            )
    return items


def required_phase1_keys(shots: list[dict[str, Any]]) -> list[str]:
    keys: set[str] = set()
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        for dep in refs_to_depends(shot.get("refs_policy")):
            keys.add(dep)
    return sorted(keys)
