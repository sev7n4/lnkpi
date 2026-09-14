"""Sidebar media parse prepass — Nest vision QA + per-URL cache."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.product_visual_v2.vision_qa_client import supports_vision_model
from app.graph.route_context import latest_user_text
from app.graph.sidebar_media_parse import (
    NON_VISION_PARSE_ERROR,
    image_urls_for_parse,
    merge_parse_records,
    uncached_urls,
)

_PROMPT = Path(__file__).resolve().parents[3] / "skills/_shared/sidebar-media-parse/1.0.0.md"

_FIELD_ALIASES = (
    ("category", "category"),
    ("appearance", "appearance"),
    ("material_hint", "materialHint"),
    ("text_in_image", "textInImage"),
)
_QA_ALIASES = (
    ("product_summary", "productSummary"),
    ("is_white_bg", "isWhiteBg"),
    ("is_sharp_enough", "isSharpEnough"),
    ("product_identifiable", "productIdentifiable"),
)


def _pick(data: dict, snake: str, camel: str) -> Any:
    if camel in data and data[camel] is not None:
        return data[camel]
    if snake in data and data[snake] is not None:
        return data[snake]
    return None


def _map_fields(data: dict) -> dict[str, str]:
    fields: dict[str, str] = {}
    for snake, camel in _FIELD_ALIASES:
        value = str(_pick(data, snake, camel) or "").strip()
        if value:
            fields[snake] = value
    return fields


def _map_qa(data: dict) -> dict[str, Any]:
    qa: dict[str, Any] = {}
    for snake, camel in _QA_ALIASES:
        value = _pick(data, snake, camel)
        if value is None or value == "":
            continue
        qa[snake] = value
    return qa


def _vision_used(data: dict) -> bool:
    return bool(data.get("visionUsed", data.get("vision_used", False)))


def _unknown_list(data: dict) -> list[str]:
    raw = data.get("unknown")
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if item]


def _error_message(model: str, *, payload: dict | None = None, exc: BaseException | None = None) -> str:
    if not supports_vision_model(model):
        return NON_VISION_PARSE_ERROR
    if payload:
        reason = str(payload.get("reason") or "").strip()
        if reason:
            return reason
    if exc is not None:
        return str(exc) or "识图失败"
    return "识图失败"


def _parse_from_cache(urls: list[str], cache: dict, model: str) -> dict[str, Any]:
    merged = merge_parse_records(urls, cache)
    vision_used = False
    error = None
    qa: dict[str, Any] = {}
    sent: list[str] = []
    for url in urls:
        rec = cache.get(url) or {}
        if rec.get("vision_used"):
            vision_used = True
        if rec.get("error") and error is None:
            error = rec.get("error")
        if rec.get("qa") and not qa:
            qa = rec["qa"]
        for item in rec.get("image_urls") or []:
            if item not in sent:
                sent.append(item)
    parse: dict[str, Any] = {
        "vision_used": vision_used,
        "model": model,
        "image_urls": sent,
        **merged,
    }
    if qa:
        parse["qa"] = qa
    if error and not vision_used:
        parse["error"] = error
    return parse


def _build_user_content(state: dict, image_count: int) -> str:
    bits = [f"请解析这 {image_count} 张侧栏参考图。"]
    user_text = latest_user_text(state.get("messages") or []).strip()
    if user_text:
        bits.append(f"【用户说明】\n{user_text}")
    return "\n\n".join(bits)


def make_parse_sidebar_media_node(*, nest: Any, vision_creds: dict | None, skills_dir: Any) -> Callable:
    _ = skills_dir  # builder signature; prompt path is locked to runtime package root
    async def parse_sidebar_media(state: dict) -> dict:
        urls = image_urls_for_parse(list(state.get("sidebar_attachments") or []))
        if not urls:
            return {"sidebar_media_parse": None}

        cache = dict(state.get("sidebar_media_parse_cache") or {})
        need = uncached_urls(urls, cache)
        model = str((vision_creds or {}).get("model") or "")

        if not need:
            return {
                "sidebar_media_parse": _parse_from_cache(urls, cache, model),
                "sidebar_media_parse_cache": cache,
            }

        system_prompt = _PROMPT.read_text(encoding="utf-8")
        user_content = _build_user_content(state, len(need))

        data: dict[str, Any] = {}
        vision_used = False
        error: str | None = None
        try:
            raw = await nest.run_vision_qa(
                system_prompt=system_prompt,
                user_content=user_content,
                image_urls=need,
                model=model,
            )
            data = raw if isinstance(raw, dict) else {}
            vision_used = _vision_used(data)
            if not vision_used:
                error = _error_message(model, payload=data)
        except Exception as exc:  # noqa: BLE001
            vision_used = False
            error = _error_message(model, exc=exc)

        summary = ""
        fields: dict[str, str] = {}
        unknown: list[str] = []
        qa: dict[str, Any] = {}
        if vision_used:
            summary = str(
                _pick(data, "user_facing_summary", "userFacingSummary")
                or _pick(data, "product_summary", "productSummary")
                or ""
            ).strip()
            fields = _map_fields(data)
            unknown = _unknown_list(data)
            qa = _map_qa(data)

        rec: dict[str, Any] = {
            "vision_used": vision_used,
            "user_facing_summary": summary,
            "fields": fields,
            "unknown": unknown,
            "image_urls": list(need),
        }
        if qa:
            rec["qa"] = qa
        if error:
            rec["error"] = error
        for url in need:
            cache[url] = rec

        return {
            "sidebar_media_parse": _parse_from_cache(urls, cache, model),
            "sidebar_media_parse_cache": cache,
        }

    return parse_sidebar_media
