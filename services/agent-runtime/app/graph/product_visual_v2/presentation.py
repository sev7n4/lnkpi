"""Presentation envelope builder for product_visual v2 sidebar UX."""

from __future__ import annotations

from typing import Any

from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.scheme_draft import normalize_macro_schemes
from app.graph.product_visual_v2.utterance import (
    collect_superseded_style_keywords,
    has_conflicting_style_utterance,
    strip_superseded_style_keywords,
)

STEPPER_ORDER: list[str] = [
    "image_qa",
    "scheme_draft",
    "macro_select",
    "ssot_persist",
    "shot_plan",
    "topo_preview",
    "generating",
    "delivery",
    "done",
]

PHASE_TO_STEPPER: dict[str, str] = {
    "await_image_qa": "image_qa",
    "await_retake_upload": "image_qa",
    "image_qa_check": "image_qa",
    "dialog_draft": "scheme_draft",
    "await_scheme_select": "scheme_draft",
    "plan_product_visual": "scheme_draft",
    "await_macro_scheme_select": "macro_select",
    "canvas_ssot_commit": "ssot_persist",
    "decompose_from_ssot": "ssot_persist",
    "await_shot_confirm": "shot_plan",
    "await_shot_topo_confirm": "topo_preview",
    "await_topo": "topo_preview",
    "start_gen": "generating",
    "orchestrate_gen": "generating",
    "orchestrate_shots": "generating",
    "collect_gen": "generating",
    "await_delivery_confirm": "delivery",
    "done": "done",
}


def phase_to_stepper(phase: str) -> str:
    """Map runtime phase / gate id to stepper step id."""
    if phase in PHASE_TO_STEPPER:
        return PHASE_TO_STEPPER[phase]
    if phase.startswith("await_"):
        stripped = phase.removeprefix("await_")
        if stripped in STEPPER_ORDER:
            return stripped
    return "scheme_draft"


def _completed_steps(current: str) -> list[str]:
    if current not in STEPPER_ORDER:
        return []
    idx = STEPPER_ORDER.index(current)
    return STEPPER_ORDER[:idx]


def build_context_recap(state: dict[str, Any]) -> str:
    """Render ≤120 char demand summary from effective_utterance + visual_intent."""
    effective = str(state.get("effective_utterance") or "").strip()
    intent = state.get("visual_intent") or {}
    primary = str(intent.get("primary_goal") or "").strip()
    superseded = collect_superseded_style_keywords(state)

    recap = primary or effective
    if not recap:
        route = state.get("route_context") or {}
        recap = str(route.get("utterance") or "").strip()

    recap = strip_superseded_style_keywords(recap, superseded)

    output_types = intent.get("output_types_requested") or []
    if output_types and isinstance(output_types, list):
        type_str = "、".join(str(t).strip() for t in output_types[:3] if str(t).strip())
        if type_str and type_str not in recap:
            candidate = f"{recap}：{type_str}" if recap else type_str
            if len(candidate) <= 120:
                recap = candidate

    return recap[:120]


def _shot_count(state: dict[str, Any]) -> int:
    shots = state.get("shot_manifest") or []
    if not isinstance(shots, list):
        return 0
    return len([s for s in shots if isinstance(s, dict)])


def _scene_count(state: dict[str, Any]) -> int:
    manifest = state.get("split_manifest") or []
    if isinstance(manifest, list) and manifest:
        downstream = [
            it
            for it in manifest
            if isinstance(it, dict) and str(it.get("role") or "") == "downstream"
        ]
        if downstream:
            return len(downstream)
    shots = state.get("shot_manifest") or []
    if not isinstance(shots, list):
        return 0
    total = 0
    for shot in shots:
        if isinstance(shot, dict):
            total += max(1, min(3, int(shot.get("variant_count") or 1)))
    return total


def _eta_min(scene_count: int) -> int:
    if scene_count <= 0:
        return 3
    return max(3, 2 + scene_count)


_ROLE_CATEGORY: dict[str, str] = {
    "seed": "基础",
    "turnaround": "基础",
    "downstream": "场景",
}

_ROLE_ORDER: dict[str, int] = {
    "seed": 0,
    "turnaround": 1,
    "downstream": 2,
}


def _topo_credits_hint(manifest: list[Any]) -> str:
    count = sum(
        1
        for it in manifest
        if isinstance(it, dict)
        and it.get("key")
        and it.get("auto_generate", True) is not False
    )
    credits = max(10, count * 10)
    return f"约 {credits} 积分"


def build_topo_card_nodes(manifest: list[Any]) -> list[dict[str, Any]]:
    """Build user-facing topo card rows from split_manifest."""
    items = [x for x in (manifest or []) if isinstance(x, dict) and x.get("key")]
    items.sort(
        key=lambda it: (
            _ROLE_ORDER.get(str(it.get("role") or ""), 9),
            str(it.get("key") or ""),
        )
    )
    key_to_title = {str(it["key"]): str(it.get("title") or it["key"]) for it in items}
    nodes: list[dict[str, Any]] = []
    for it in items:
        key = str(it["key"])
        deps = [str(d) for d in (it.get("depends_on") or []) if str(d) in key_to_title]
        entry: dict[str, Any] = {
            "key": key,
            "title": str(it.get("title") or key),
            "category": _ROLE_CATEGORY.get(str(it.get("role") or ""), "场景"),
        }
        if deps:
            entry["depends_on_labels"] = [key_to_title.get(d, d) for d in deps]
        nid = str(it.get("node_id") or "").strip()
        if nid:
            entry["node_id"] = nid
        nodes.append(entry)
    return nodes


def mermaid_for_presentation(manifest: list[Any]) -> str:
    """Return mermaid source (no fences) for collapsed topo preview."""
    from app.graph.mermaid_topo import manifest_to_mermaid

    raw = manifest_to_mermaid(list(manifest)).strip()
    lines = raw.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines)


_SHOT_TYPE_LABELS: dict[str, str] = {
    "packaging_hero": "包装主视觉",
    "packaging_structure": "包装结构",
    "lifestyle_gifting": "送礼场景",
    "product_hero": "产品主图",
    "white_bg": "白底图",
    "scene": "场景图",
}


def build_shot_table_rows(shots: list[Any]) -> list[dict[str, Any]]:
    """Structured rows for shot_table presentation (UX-PV-05)."""
    rows: list[dict[str, Any]] = []
    for raw in shots:
        if not isinstance(raw, dict):
            continue
        shot_id = str(raw.get("shot_id") or "").strip()
        if not shot_id:
            continue
        type_id = str(raw.get("type") or raw.get("type_id") or raw.get("shot_type") or "").strip()
        type_label = _SHOT_TYPE_LABELS.get(type_id, type_id or "构图")
        label = str(raw.get("label") or shot_id).strip()
        prose = str(raw.get("shot_prose") or "").strip()
        summary = prose[:80] + ("…" if len(prose) > 80 else "") if prose else ""
        rows.append(
            {
                "shot_id": shot_id,
                "label": label,
                "type": type_label,
                "summary": summary,
                "node_id": raw.get("node_id"),
            }
        )
    return rows


def estimate_scene_count(state: dict[str, Any]) -> int:
    """Best-effort scene count before shot_manifest exists (macro A+B footer UX-PV-03)."""
    shots = state.get("shot_manifest") or []
    if isinstance(shots, list):
        n = len([s for s in shots if isinstance(s, dict)])
        if n > 0:
            return n
    labels = state.get("user_request_labels") or []
    if isinstance(labels, list):
        label_n = len([x for x in labels if str(x).strip()])
        if label_n > 0:
            return label_n
    intent = state.get("visual_intent") or {}
    output_types = intent.get("output_types_requested") or []
    if isinstance(output_types, list):
        type_n = len([t for t in output_types if str(t).strip()])
        if type_n > 0:
            return type_n
    return 3


def compute_expected_delivery(
    selected_macro_ids: list[str],
    shots: list[dict[str, Any]],
    *,
    allocation_mode: str = "mixed",
    copy: ProductVisualCopy | None = None,
    state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute finalize count and A+B allocation note for macro selection UX."""
    selected = [str(s).strip() for s in selected_macro_ids if str(s).strip()]
    k = len(selected)
    scene_count = len([s for s in shots if isinstance(s, dict)]) if isinstance(shots, list) else 0
    if scene_count <= 0 and state is not None:
        scene_count = estimate_scene_count(state)

    if allocation_mode == "full_matrix":
        total_finalize = scene_count * k if scene_count > 0 else 0
    else:
        total_finalize = scene_count

    allocation_note = ""
    if copy and k >= 2:
        p_str = str(total_finalize) if total_finalize > 0 else "若干"
        allocation_note = copy.get("macro.ab_hint_mixed", k=str(k), p=p_str)

    return {
        "scene_count": scene_count,
        "total_finalize": total_finalize,
        "allocation_note": allocation_note,
    }


def build_presentation_envelope(
    *,
    kind: str,
    phase: str,
    state: dict[str, Any],
    copy: ProductVisualCopy,
) -> dict[str, Any]:
    """Build structured presentation envelope for sidebar rendering."""
    current = phase_to_stepper(phase)
    envelope: dict[str, Any] = {
        "kind": kind,
        "stepper": {
            "current": current,
            "completed": _completed_steps(current),
        },
        "context_recap": build_context_recap(state),
    }

    if phase == "await_shot_confirm":
        shots = state.get("shot_manifest") or []
        n = _shot_count(state)
        hint = copy.get("shot_confirm.hint", n=str(n))
        label = copy.get("shot_confirm.primary_label")
        envelope["primary_action"] = {"label": label, "message": "确认出图"}
        envelope["body"] = {
            "text": hint,
            "shots": build_shot_table_rows(shots if isinstance(shots, list) else []),
        }
    elif phase == "await_shot_topo_confirm":
        n = _shot_count(state)
        manifest = state.get("split_manifest") or []
        scene_count = _scene_count(state)
        eta_min = _eta_min(scene_count)
        hint = copy.get(
            "merged_shot_topo.hint",
            n=str(n),
            scene_count=str(scene_count),
            eta_min=str(eta_min),
        )
        label = copy.get("merged_shot_topo.primary_label")
        envelope["primary_action"] = {
            "label": label,
            "message": copy.get("merged_shot_topo.primary_message"),
        }
        body: dict[str, Any] = {
            "text": hint,
            "shot_count": n,
            "nodes": build_topo_card_nodes(manifest),
            "eta_min": eta_min,
            "scene_count": scene_count,
            "credits_hint": _topo_credits_hint(manifest),
        }
        if manifest:
            body["mermaid"] = mermaid_for_presentation(manifest)
        envelope["body"] = body
    elif phase == "await_topo":
        manifest = state.get("split_manifest") or []
        scene_count = _scene_count(state)
        eta_min = _eta_min(scene_count)
        hint = copy.get("topo.hint", scene_count=str(scene_count))
        label = copy.get("topo.primary_label", eta_min=str(eta_min))
        envelope["primary_action"] = {"label": label, "message": "确认出图"}
        topo_body: dict[str, Any] = {
            "text": hint,
            "nodes": build_topo_card_nodes(manifest),
            "eta_min": eta_min,
            "scene_count": scene_count,
            "credits_hint": _topo_credits_hint(manifest),
        }
        if manifest:
            topo_body["mermaid"] = mermaid_for_presentation(manifest)
        envelope["body"] = topo_body
    elif phase == "await_macro_scheme_select":
        from app.graph.product_visual_v2.macro_select import default_macro_selection

        selected = [
            str(s).strip()
            for s in (state.get("selected_macro_scheme_ids") or default_macro_selection(state.get("macro_schemes") or []))
            if str(s).strip()
        ]
        delivery = compute_expected_delivery(
            selected,
            state.get("shot_manifest") or [],
            copy=copy,
            state=state,
        )
        body: dict[str, Any] = {
            "schemes": normalize_macro_schemes(state.get("macro_schemes") or []),
            "max_select": 2,
        }
        if len(selected) >= 2 and delivery["allocation_note"]:
            body["footer_hint"] = delivery["allocation_note"]
            body["expected_delivery_count"] = delivery["total_finalize"]
        guidance_callout = copy.get("guidance.macro_style_in_cards")
        if guidance_callout and guidance_callout != "guidance.macro_style_in_cards":
            body["callout"] = guidance_callout
        if has_conflicting_style_utterance(state):
            note = copy.get("context.latest_utterance_note")
            if note:
                body["callout_conflict"] = note
        envelope["body"] = body
    elif phase in ("start_gen", "orchestrate_gen", "collect_gen"):
        scene_count = _scene_count(state)
        eta_min = _eta_min(scene_count)
        envelope["kind"] = "task_progress_card"
        envelope["body"] = {
            "banner": copy.get("generating.banner", eta_min=str(eta_min)),
            "card_title": copy.get("generating.card_title"),
            "progress_line_template": copy.get("generating.progress_line"),
            "eta_min": eta_min,
        }
    elif phase == "await_delivery_confirm":
        from app.graph.product_visual_v2.delivery import build_delivery_groups

        expected = state.get("expected_delivery_count")
        if not isinstance(expected, int) or expected <= 0:
            shots = state.get("shot_manifest") or []
            expected = len([s for s in shots if isinstance(s, dict)])
        groups = build_delivery_groups(state)
        envelope["kind"] = "delivery_cards"
        envelope["body"] = {
            "hint": copy.get("delivery.hint"),
            "groups": groups,
            "expected_delivery_count": expected,
            "footer_hint": copy.get("delivery.footer_hint", n=str(expected)),
        }
        envelope["primary_action"] = {
            "label": copy.get("delivery.primary_label"),
            "message": "确认全部定稿",
        }

    return envelope
