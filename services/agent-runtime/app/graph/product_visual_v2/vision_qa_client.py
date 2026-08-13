"""Vision QA client — calls Nest internal vision endpoint or direct chat/completions."""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

import httpx

from app.config import settings
from app.graph.atomic_parse_llm import extract_json_object
from app.graph.product_visual_v2.vision_qa import VisionQAResult
from app.graph.product_visual_v2_prompt import build_vision_qa_user_content, load_vision_qa_prompt

logger = logging.getLogger(__name__)

_VISION_MODEL = re.compile(
    r"(?:^|[/:])(?:gemini|gpt-4o|gpt-4-turbo|gpt-4-vision|gpt-5|claude-(?:opus|sonnet|haiku|3)|agnes)(?:[-./]|$)",
    re.I,
)
_NON_VISION = re.compile(
    r"(?:^|[/:])(?:deepseek|o[134](?:-|$|-mini|-pro)|text-embedding|whisper|tts|dall-e)(?:[-./]|$)",
    re.I,
)

_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


def supports_vision_model(model: str | None) -> bool:
    if not model or not str(model).strip():
        return False
    m = str(model).strip()
    if _NON_VISION.search(m):
        return False
    return bool(_VISION_MODEL.search(m))


def image_urls_from_state(state: dict) -> list[str]:
    route_ctx = state.get("route_context") or {}
    attachments = list(state.get("sidebar_attachments") or route_ctx.get("sidebar_attachments") or [])
    urls: list[str] = []
    for att in attachments:
        if not isinstance(att, dict):
            continue
        if str(att.get("mediaType") or "").lower() not in ("image",):
            continue
        url = str(att.get("url") or "").strip()
        if url and url not in urls:
            urls.append(url)
    return urls


def _parse_vision_json(raw: str) -> VisionQAResult:
    data = extract_json_object(raw)
    if not data:
        return VisionQAResult(
            pass_=False,
            reason="识图模型返回格式异常，请重试或换一张更清晰的产品图",
            vision_used=True,
        )
    product_summary = str(data.get("product_summary") or data.get("productSummary") or "").strip() or None
    return VisionQAResult(
        pass_=bool(data.get("pass")),
        reason=str(data.get("reason") or "").strip() or "图源审核完成",
        vision_used=True,
        product_summary=product_summary,
        is_white_bg=data.get("is_white_bg") if "is_white_bg" in data else None,
        is_sharp_enough=data.get("is_sharp_enough") if "is_sharp_enough" in data else None,
        product_identifiable=data.get("product_identifiable")
        if "product_identifiable" in data
        else None,
        product_summary=str(data.get("product_summary") or "").strip() or None,
    )


async def _call_vision_http(
    *,
    system_prompt: str,
    user_content: str,
    image_urls: list[str],
    model: str,
    api_key: str,
    base_url: str,
    max_retries: int = 2,
) -> VisionQAResult:
    if not api_key:
        return VisionQAResult(
            pass_=False,
            reason="未配置识图模型 API Key，无法完成图源审核",
            vision_used=False,
        )
    if not supports_vision_model(model):
        return VisionQAResult(
            pass_=False,
            reason=f"当前文本模型（{model}）不支持识图，请在 Agent 侧栏选择 Gemini / GPT-4o 等视觉模型",
            vision_used=False,
        )
    url = base_url.rstrip("/") + "/chat/completions"
    base_body: dict[str, Any] = {
        "model": model,
        "stream": False,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_content},
                    *[{"type": "image_url", "image_url": {"url": u}} for u in image_urls],
                ],
            },
        ],
    }

    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(max_retries + 1):
            if attempt > 0:
                await asyncio.sleep(0.4 * attempt)
            bodies = [
                {**base_body, "response_format": {"type": "json_object"}},
                base_body,
            ]
            for body in bodies:
                try:
                    resp = await client.post(
                        url,
                        json=body,
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                    )
                    if resp.status_code in _RETRYABLE_STATUS:
                        last_exc = httpx.HTTPStatusError(
                            f"upstream {resp.status_code}",
                            request=resp.request,
                            response=resp,
                        )
                        break
                    resp.raise_for_status()
                    payload = resp.json()
                    raw = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return _parse_vision_json(str(raw or ""))
                except httpx.HTTPStatusError as exc:
                    last_exc = exc
                    if exc.response.status_code not in _RETRYABLE_STATUS:
                        raise
                    break
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    break

    logger.warning("direct vision QA failed after retries: %s", last_exc)
    return VisionQAResult(
        pass_=False,
        reason=f"识图审核调用失败：{last_exc}",
        vision_used=False,
    )


async def run_vision_qa(
    *,
    nest: Any | None,
    state: dict,
    skills_dir: Path,
    vision_creds: dict[str, str | None] | None = None,
) -> VisionQAResult:
    """Run vision-first product image QA (R-Vision-QA)."""
    image_urls = image_urls_from_state(state)
    if not image_urls:
        return VisionQAResult(
            pass_=False,
            reason="未检测到产品参考图，请上传图片后重试",
            vision_used=False,
        )

    route_ctx = state.get("route_context") or {}
    utterance = str(route_ctx.get("utterance") or "").strip()
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            utterance = str(content).strip()
            break

    metrics = state.get("_qa_metrics") or {}
    scene_kind = metrics.get("scene_kind") if isinstance(metrics, dict) else None
    system_prompt, _version = load_vision_qa_prompt(skills_dir)
    user_content = build_vision_qa_user_content(
        user_text=utterance,
        scene_kind=str(scene_kind or ""),
        image_count=len(image_urls),
    )

    creds = vision_creds or {}
    cred_model = str(creds.get("model") or "").strip() or None

    run_fn = getattr(nest, "run_vision_qa", None) if nest is not None else None
    if run_fn is not None:
        try:
            data = await run_fn(
                image_urls=image_urls,
                user_text=utterance,
                scene_kind=scene_kind,
                system_prompt=system_prompt,
                user_content=user_content,
                model=cred_model,
            )
            if isinstance(data, dict):
                product_summary = str(
                    data.get("productSummary") or data.get("product_summary") or ""
                ).strip() or None
                return VisionQAResult(
                    pass_=bool(data.get("pass")),
                    reason=str(data.get("reason") or "").strip() or "图源审核完成",
                    vision_used=bool(data.get("visionUsed", data.get("vision_used", True))),
                    product_summary=product_summary,
                    is_white_bg=data.get("isWhiteBg", data.get("is_white_bg")),
                    is_sharp_enough=data.get("isSharpEnough", data.get("is_sharp_enough")),
                    product_identifiable=data.get(
                        "productIdentifiable", data.get("product_identifiable")
                    ),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("nest run_vision_qa failed: %s", exc)

    model = str(creds.get("model") or settings.openai_chat_model or "gpt-4o")
    api_key = str(creds.get("api_key") or settings.openai_api_key or "")
    base_url = str(creds.get("base_url") or settings.openai_base_url or "https://api.openai.com/v1")
    return await _call_vision_http(
        system_prompt=system_prompt,
        user_content=user_content,
        image_urls=image_urls,
        model=model,
        api_key=api_key,
        base_url=base_url,
    )
