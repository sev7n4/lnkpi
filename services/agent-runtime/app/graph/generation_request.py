"""P2: unified GenerationRequest DTO — sidebar atomic path ≡ Dock (RU-9, R-ALIGN-02)."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from app.graph.atomic_intent_ir import AtomicIntent, derive_studio_prompt, intent_slots_dict, resolve_atomic_intent
from app.graph.route_context import latest_user_text
from app.graph.sidebar_attachments import assign_sidebar_ref_keys, resolve_sidebar_mentioned_keys

GenerationModality = Literal["image", "video", "text", "prompt", "audio"]

_DOCK_MODALITY = {
    "image": "image",
    "video": "video",
    "text": "text",
    "prompt": "prompt",
    "audio": "audio",
}


class StudioRefPayload(TypedDict, total=False):
    refKey: str
    mediaType: str
    label: str
    text: str
    url: str


class GenerationRequest(TypedDict, total=False):
    prompt: str
    refs: list[StudioRefPayload]
    mentioned_keys: list[str]
    modality: GenerationModality
    node_id: str | None
    slots: dict[str, str]


def _refs_from_sidebar(
    attachments: list[dict] | None,
    mentioned_keys: list[str] | None,
) -> list[StudioRefPayload]:
    raw = list(attachments or [])
    keys = assign_sidebar_ref_keys(raw) or list(mentioned_keys or [])
    refs: list[StudioRefPayload] = []
    for idx, att in enumerate(raw):
        if not isinstance(att, dict):
            continue
        ref_key = str(att.get("refKey") or att.get("ref_key") or (keys[idx] if idx < len(keys) else "")).strip()
        media = str(att.get("mediaType") or att.get("media_type") or "text").strip().lower()
        payload: StudioRefPayload = {"refKey": ref_key, "mediaType": media}
        label = str(att.get("label") or "").strip()
        if label:
            payload["label"] = label
        text = str(att.get("text") or att.get("content") or "").strip()
        url = str(att.get("url") or "").strip()
        if text:
            payload["text"] = text
        if url:
            payload["url"] = url
        refs.append(payload)
    return refs


def _intent_from_state(state: dict[str, Any], utterance: str, mentioned_keys: list[str]) -> AtomicIntent:
    route_decision = state.get("route_decision")
    if isinstance(route_decision, dict):
        snapshot = route_decision.get("atomic_intent")
        if isinstance(snapshot, dict) and snapshot.get("utterance"):
            utterance = str(snapshot.get("utterance") or utterance)
            mk = list(snapshot.get("mentioned_keys") or mentioned_keys)
            return resolve_atomic_intent(utterance, mentioned_keys=mk or None)
    return resolve_atomic_intent(utterance, mentioned_keys=mentioned_keys or None)


def build_generation_request_from_atomic_state(state: dict[str, Any]) -> GenerationRequest:
    """Sidebar atomic path: prompt + refs + mentioned_keys aligned with Dock."""
    spec = state.get("atomic_spec") if isinstance(state.get("atomic_spec"), dict) else {}
    utterance = latest_user_text(state.get("messages") or []) or str(spec.get("prompt") or "")
    mentioned = resolve_sidebar_mentioned_keys(state)
    intent = _intent_from_state(state, utterance, mentioned)
    prompt = str(spec.get("prompt") or derive_studio_prompt(intent)).strip()
    modality = str(spec.get("target_type") or intent.output_modality or "image")  # type: ignore[assignment]
    node_id = str(state.get("atomic_node_id") or state.get("focus_node_id") or "").strip() or None
    refs = _refs_from_sidebar(state.get("sidebar_attachments"), mentioned)
    return GenerationRequest(
        prompt=prompt,
        refs=refs,
        mentioned_keys=list(mentioned),
        modality=modality,  # type: ignore[typeddict-item]
        node_id=node_id,
        slots=intent_slots_dict(intent),
    )


def build_generation_request_from_dock(
    node: dict[str, Any],
    *,
    upstream: dict[str, Any] | None = None,
    refs: list[StudioRefPayload] | None = None,
    mentioned_keys: list[str] | None = None,
) -> GenerationRequest:
    """Dock path — field names aligned with web useNodeGeneration → studioApi.generateImage."""
    del upstream  # reserved for referenceImageUrl merge parity
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    node_type = str(node.get("type") or "image")
    prompt = str(data.get("prompt") or data.get("content") or "").strip()
    keys = list(mentioned_keys or [])
    intent = resolve_atomic_intent(prompt, mentioned_keys=keys or None)
    modality = _DOCK_MODALITY.get(node_type, "image")
    node_id = str(node.get("id") or "").strip() or None
    return GenerationRequest(
        prompt=prompt or derive_studio_prompt(intent),
        refs=list(refs or []),
        mentioned_keys=keys,
        modality=modality,  # type: ignore[typeddict-item]
        node_id=node_id,
        slots=intent_slots_dict(intent),
    )


def generation_request_parity_keys(request: GenerationRequest) -> dict[str, Any]:
    """Normalize for sidebar vs Dock parity assertions (AC-05)."""
    refs = request.get("refs") or []
    ref_sig = sorted(
        (
            str(r.get("refKey") or ""),
            str(r.get("mediaType") or ""),
            str(r.get("text") or ""),
            str(r.get("url") or ""),
        )
        for r in refs
        if isinstance(r, dict)
    )
    return {
        "prompt": str(request.get("prompt") or ""),
        "mentioned_keys": list(request.get("mentioned_keys") or []),
        "modality": request.get("modality"),
        "slots": dict(request.get("slots") or {}),
        "refs": ref_sig,
    }
