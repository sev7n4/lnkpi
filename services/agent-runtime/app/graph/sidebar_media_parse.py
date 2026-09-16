"""Pure helpers for sidebar media parse prepass (no I/O)."""

from __future__ import annotations

from app.graph.product_visual_v2.vision_qa import VisionQAResult

MAX_PARSE_IMAGE_URLS = 4

VISION_WALL_BUDGET_SEC = 180.0
VISION_MAX_ATTEMPTS = 3  # N=2 retries → max 3 attempts

VISION_UNSUPPORTED = "VISION_UNSUPPORTED"
VISION_PROVIDER_CONTEXT_INVALID = "VISION_PROVIDER_CONTEXT_INVALID"
VISION_BYOK_MISSING_KEY = "VISION_BYOK_MISSING_KEY"
VISION_RATE_LIMIT = "VISION_RATE_LIMIT"
VISION_TIMEOUT = "VISION_TIMEOUT"
VISION_FETCH_FAILED = "VISION_FETCH_FAILED"
VISION_UPSTREAM = "VISION_UPSTREAM"
VISION_UNKNOWN = "VISION_UNKNOWN"

_VISION_ERROR_REASONS: dict[str, str] = {
    VISION_UNSUPPORTED: (
        "当前模型不支持识图。请换成 DeepSeek Flash 或 Gemini / GPT-4o 后再问。"
        "我没有根据这张图编造产品信息。"
    ),
    VISION_PROVIDER_CONTEXT_INVALID: "识图凭证不完整，请重新选择模型后再试",
    VISION_BYOK_MISSING_KEY: "自定义渠道未配置 API Key",
    VISION_RATE_LIMIT: "识图请求过于频繁，请稍后再试",
    VISION_TIMEOUT: "识图超时，请稍后重试",
    VISION_FETCH_FAILED: "参考图读取失败，请重新上传",
    VISION_UPSTREAM: "识图失败",
    VISION_UNKNOWN: "识图失败，请稍后重试",
}

NON_VISION_PARSE_ERROR = _VISION_ERROR_REASONS[VISION_UNSUPPORTED]

_SUCCESS_PREFIX = "根据参考图："
_FAILURE_PREFIX = "未能根据参考图识别产品。"

# Transient failures must not poison thread URL cache (↺ reuse would stay empty forever).
_RETRYABLE_ERROR_MARKERS = (
    "操作超时",
    "timeout",
    "timed out",
    "429",
    "rate limit",
    "识图超时",
    "识图请求过于频繁",
    "暂时不可用",
    "downstream",
    "empty reply",
    "server disconnected",
    "connecterror",
    "remoteprotocol",
)

_RETRYABLE_ERROR_CLASSES = frozenset({VISION_RATE_LIMIT, VISION_TIMEOUT})


def media_parse_cache_key(url: str, provider_ref: str | None) -> str:
    return f"{url}||{provider_ref or ''}"


def map_vision_error_class(error_class: str | None) -> str:
    if error_class and error_class in _VISION_ERROR_REASONS:
        return _VISION_ERROR_REASONS[error_class]
    return _VISION_ERROR_REASONS[VISION_UNKNOWN]


def classify_vision_error(
    *,
    payload: dict | None = None,
    reason: str | None = None,
    exc: BaseException | None = None,
) -> str:
    if payload:
        raw = payload.get("errorClass") or payload.get("error_class")
        if raw:
            key = str(raw).strip()
            if key in _VISION_ERROR_REASONS:
                return key
        if reason is None:
            reason = str(payload.get("reason") or "").strip() or None
    text = (reason or (str(exc) if exc is not None else "") or "").strip()
    if not text:
        return VISION_UNKNOWN
    lowered = text.lower()
    if "429" in lowered or "rate limit" in lowered or "过于频繁" in text:
        return VISION_RATE_LIMIT
    if (
        "timeout" in lowered
        or "timed out" in lowered
        or "操作超时" in text
        or "识图超时" in text
    ):
        return VISION_TIMEOUT
    if (
        "fetch failed" in lowered
        or "下载失败" in text
        or "读取失败" in text
        or "拉取" in text
    ):
        return VISION_FETCH_FAILED
    if "不支持识图" in text or "unsupported" in lowered:
        return VISION_UNSUPPORTED
    if "凭证不完整" in text or "context invalid" in lowered:
        return VISION_PROVIDER_CONTEXT_INVALID
    if "未配置" in text and ("api key" in lowered or "api key" in text.lower() or "API Key" in text):
        return VISION_BYOK_MISSING_KEY
    if "byok" in lowered and ("key" in lowered or "api" in lowered):
        return VISION_BYOK_MISSING_KEY
    return VISION_UPSTREAM


def is_retryable_error_class(error_class: str | None) -> bool:
    return bool(error_class) and error_class in _RETRYABLE_ERROR_CLASSES


def is_retryable_parse_error(error: str | None) -> bool:
    if not error or not str(error).strip():
        return False
    lowered = str(error).lower()
    return any(marker.lower() in lowered for marker in _RETRYABLE_ERROR_MARKERS)


def image_urls_for_parse(attachments: list) -> list[str]:
    urls: list[str] = []
    for att in attachments:
        if not isinstance(att, dict):
            continue
        if str(att.get("mediaType") or "").lower() not in ("image",):
            continue
        url = str(att.get("url") or "").strip()
        if url and url not in urls:
            urls.append(url)
        if len(urls) >= MAX_PARSE_IMAGE_URLS:
            break
    return urls


def uncached_urls(
    urls: list[str],
    cache: dict | None,
    *,
    provider_ref: str | None = None,
) -> list[str]:
    if not cache:
        return list(urls)
    out: list[str] = []
    for url in urls:
        key = media_parse_cache_key(url, provider_ref)
        rec = cache.get(key)
        if rec is None:
            # Legacy url-only keys: treat as miss when scoped key required.
            out.append(url)
            continue
        # Successful parses stay cached; retryable errors are treated as cache miss.
        if rec.get("vision_used"):
            continue
        if is_retryable_parse_error(str(rec.get("error") or "") if rec.get("error") else None):
            out.append(url)
            continue
        if rec.get("error") and not rec.get("vision_used"):
            # Non-retryable failure (e.g. non-vision model) — keep cache hit.
            continue
        # Empty / incomplete record without vision — re-fetch.
        if not rec.get("user_facing_summary") and not rec.get("fields"):
            out.append(url)
            continue
    return out


def merge_parse_records(
    urls: list[str],
    cache: dict,
    *,
    provider_ref: str | None = None,
) -> dict:
    summaries: list[str] = []
    fields: dict = {}
    unknown: set[str] = set()
    for url in urls:
        rec = cache.get(media_parse_cache_key(url, provider_ref)) or {}
        summary = str(rec.get("user_facing_summary") or "").strip()
        if summary:
            summaries.append(summary)
        for key, value in (rec.get("fields") or {}).items():
            if key not in fields and value:
                fields[key] = value
        for item in rec.get("unknown") or []:
            if item:
                unknown.add(str(item))
    return {
        "user_facing_summary": "；".join(summaries),
        "fields": fields,
        "unknown": sorted(unknown),
    }


def _qa_source(parse: dict) -> dict:
    qa = parse.get("qa")
    return qa if isinstance(qa, dict) else {}


def parse_as_vision_qa_result(parse: dict) -> VisionQAResult:
    """Map sidebar_media_parse state/cache dict → VisionQAResult (no HTTP)."""
    qa = _qa_source(parse)
    is_white_bg = qa.get("is_white_bg", parse.get("is_white_bg"))
    is_sharp_enough = qa.get("is_sharp_enough", parse.get("is_sharp_enough"))
    product_identifiable = qa.get("product_identifiable", parse.get("product_identifiable"))
    raw_summary = (
        qa.get("product_summary")
        or parse.get("product_summary")
        or parse.get("user_facing_summary")
    )
    summary = str(raw_summary).strip() if raw_summary else None
    pass_ = bool(is_white_bg and is_sharp_enough and product_identifiable)
    reason = str(qa.get("reason") or parse.get("error") or "").strip()
    if not reason:
        reason = "图源审核完成" if pass_ else "图源未通过识图审核"
    return VisionQAResult(
        pass_=pass_,
        reason=reason,
        vision_used=bool(parse.get("vision_used")),
        product_summary=summary or None,
        is_white_bg=is_white_bg,
        is_sharp_enough=is_sharp_enough,
        product_identifiable=product_identifiable,
    )


_PARSE_ASK_UNKNOWN_MARKERS = ("上架", "投放", "营销方案", "全链路", "详情页")


def parse_block_asks_unknown(text: str) -> bool:
    t = text or ""
    return any(m in t for m in _PARSE_ASK_UNKNOWN_MARKERS)


def format_parse_context_block(parse: dict, *, ask_unknown: bool = False) -> str:
    summary = str(parse.get("user_facing_summary") or "").strip() or "未知"
    category = str((parse.get("fields") or {}).get("category") or "").strip()
    category_line = category if category else "未知，勿编造"
    unknown = parse.get("unknown") or []
    unknown_hint = ""
    if ask_unknown and unknown:
        unknown_hint = f"\n待确认项：{'、'.join(str(u) for u in unknown)}"
    if ask_unknown:
        commerce = "图中未出现的价格/平台/资质不要编，改为向用户确认。"
    else:
        commerce = (
            "图中未出现的价格/平台/资质不要编造；不要向用户追问这些项，"
            "也不要因此推迟摆盘或 propose_generation。"
        )
    return (
        "【侧栏参考图解析】\n"
        f"摘要：{summary}\n"
        f"品类：{category_line}{unknown_hint}\n"
        "请基于以上理解回答或写方案。不要声称只能看到文件名或画布节点标题。\n"
        f"{commerce}"
    )


def prefix_assistant_reply(reply: str, parse: dict | None) -> str:
    if parse is None:
        return reply
    if parse.get("vision_used"):
        summary = str(parse.get("user_facing_summary") or "").strip()
        prefix = f"{_SUCCESS_PREFIX}{summary}"
        if reply.startswith(prefix) or reply.startswith(_SUCCESS_PREFIX):
            return reply
        return f"{prefix}\n\n{reply}" if reply else prefix
    error = str(parse.get("error") or "").strip()
    prefix = f"{_FAILURE_PREFIX}{error}"
    if reply.startswith(prefix) or reply.startswith(_FAILURE_PREFIX):
        return reply
    return f"{prefix}\n\n{reply}" if reply else prefix
