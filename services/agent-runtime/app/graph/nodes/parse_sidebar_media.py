"""Sidebar media parse prepass — Nest vision QA + per-URL cache."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from app.graph.product_visual_v2.vision_qa_client import supports_vision_model
from app.graph.route_context import latest_user_text
from app.graph.sidebar_media_parse import (
    VISION_BYOK_MISSING_KEY,
    VISION_MAX_ATTEMPTS,
    VISION_PROVIDER_CONTEXT_INVALID,
    VISION_UNSUPPORTED,
    VISION_WALL_BUDGET_SEC,
    classify_vision_error,
    image_urls_for_parse,
    is_retryable_error_class,
    is_retryable_parse_error,
    map_vision_error_class,
    media_parse_cache_key,
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


def _creds_fields(vision_creds: dict | None) -> dict[str, str | None]:
    creds = vision_creds or {}
    return {
        "provider_ref": (str(creds["provider_ref"]).strip() if creds.get("provider_ref") else None),
        "model": (str(creds["model"]).strip() if creds.get("model") else None),
        "api_key": (str(creds["api_key"]).strip() if creds.get("api_key") else None),
        "base_url": (str(creds["base_url"]).strip() if creds.get("base_url") else None),
        "source": (str(creds["source"]).strip() if creds.get("source") else None),
    }


def _gate_error_class(fields: dict[str, str | None]) -> str | None:
    """Runtime gates before Nest: unsupported model / incomplete Context / BYOK key."""
    model = fields.get("model")
    if model and not supports_vision_model(model):
        return VISION_UNSUPPORTED
    provider_ref = fields.get("provider_ref")
    base_url = fields.get("base_url")
    source = fields.get("source")
    api_key = fields.get("api_key")
    if not provider_ref or not model or not base_url or not source:
        return VISION_PROVIDER_CONTEXT_INVALID
    if not api_key:
        if source == "user":
            return VISION_BYOK_MISSING_KEY
        return VISION_PROVIDER_CONTEXT_INVALID
    return None


def _parse_from_cache(
    urls: list[str],
    cache: dict,
    model: str,
    *,
    provider_ref: str | None,
) -> dict[str, Any]:
    merged = merge_parse_records(urls, cache, provider_ref=provider_ref)
    vision_used = False
    error = None
    qa: dict[str, Any] = {}
    sent: list[str] = []
    for url in urls:
        rec = cache.get(media_parse_cache_key(url, provider_ref)) or {}
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


def _failure_record(
    *,
    need: list[str],
    error_class: str,
    model: str,
) -> dict[str, Any]:
    return {
        "vision_used": False,
        "user_facing_summary": "",
        "fields": {},
        "unknown": [],
        "image_urls": list(need),
        "error": map_vision_error_class(error_class),
        "error_class": error_class,
        "model": model,
    }


def make_parse_sidebar_media_node(*, nest: Any, vision_creds: dict | None, skills_dir: Any) -> Callable:
    _ = skills_dir  # builder signature; prompt path is locked to runtime package root
    async def parse_sidebar_media(state: dict) -> dict:
        urls = image_urls_for_parse(list(state.get("sidebar_attachments") or []))
        if not urls:
            return {"sidebar_media_parse": None}

        fields = _creds_fields(vision_creds)
        provider_ref = fields.get("provider_ref")
        model = fields.get("model") or ""

        cache = dict(state.get("sidebar_media_parse_cache") or {})
        need = uncached_urls(urls, cache, provider_ref=provider_ref)

        if not need:
            return {
                "sidebar_media_parse": _parse_from_cache(
                    urls, cache, model, provider_ref=provider_ref
                ),
                "sidebar_media_parse_cache": cache,
            }

        gate = _gate_error_class(fields)
        if gate is not None:
            rec = _failure_record(need=need, error_class=gate, model=model)
            for url in need:
                cache[media_parse_cache_key(url, provider_ref)] = rec
            return {
                "sidebar_media_parse": _parse_from_cache(
                    urls, cache, model, provider_ref=provider_ref
                ),
                "sidebar_media_parse_cache": cache,
            }

        system_prompt = _PROMPT.read_text(encoding="utf-8")
        user_content = _build_user_content(state, len(need))

        data: dict[str, Any] = {}
        vision_used = False
        error: str | None = None
        error_class: str | None = None
        started = time.monotonic()
        attempt = 0

        while attempt < VISION_MAX_ATTEMPTS:
            elapsed = time.monotonic() - started
            if elapsed >= VISION_WALL_BUDGET_SEC:
                if error_class is None:
                    error_class = classify_vision_error(reason="timeout")
                break
            attempt += 1
            try:
                raw = await nest.run_vision_qa(
                    system_prompt=system_prompt,
                    user_content=user_content,
                    image_urls=need,
                    provider_ref=fields["provider_ref"],
                    model=fields["model"],
                    api_key=fields["api_key"],
                    base_url=fields["base_url"],
                    source=fields["source"],
                )
                data = raw if isinstance(raw, dict) else {}
                vision_used = _vision_used(data)
                if vision_used:
                    error = None
                    error_class = None
                    break
                error_class = classify_vision_error(payload=data)
                error = map_vision_error_class(error_class)
                if (
                    is_retryable_error_class(error_class)
                    and attempt < VISION_MAX_ATTEMPTS
                    and (time.monotonic() - started) < VISION_WALL_BUDGET_SEC
                ):
                    continue
                break
            except Exception as exc:  # noqa: BLE001
                vision_used = False
                error_class = classify_vision_error(exc=exc)
                error = map_vision_error_class(error_class)
                data = {}
                if (
                    is_retryable_error_class(error_class)
                    and attempt < VISION_MAX_ATTEMPTS
                    and (time.monotonic() - started) < VISION_WALL_BUDGET_SEC
                ):
                    continue
                break

        summary = ""
        mapped_fields: dict[str, str] = {}
        unknown: list[str] = []
        qa: dict[str, Any] = {}
        if vision_used:
            summary = str(
                _pick(data, "user_facing_summary", "userFacingSummary")
                or _pick(data, "product_summary", "productSummary")
                or ""
            ).strip()
            mapped_fields = _map_fields(data)
            unknown = _unknown_list(data)
            qa = _map_qa(data)

        rec: dict[str, Any] = {
            "vision_used": vision_used,
            "user_facing_summary": summary,
            "fields": mapped_fields,
            "unknown": unknown,
            "image_urls": list(need),
        }
        if qa:
            rec["qa"] = qa
        if error:
            rec["error"] = error
        if error_class:
            rec["error_class"] = error_class

        if vision_used or not is_retryable_parse_error(error):
            for url in need:
                cache[media_parse_cache_key(url, provider_ref)] = rec
            parse_out = _parse_from_cache(urls, cache, model, provider_ref=provider_ref)
        else:
            # Surface error this turn, but leave URL uncached so ↺ / next ask retries Nest.
            ephemeral = dict(cache)
            for url in need:
                ephemeral[media_parse_cache_key(url, provider_ref)] = rec
            parse_out = _parse_from_cache(urls, ephemeral, model, provider_ref=provider_ref)

        return {
            "sidebar_media_parse": parse_out,
            "sidebar_media_parse_cache": cache,
        }

    return parse_sidebar_media
