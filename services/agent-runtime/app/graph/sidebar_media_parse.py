"""Pure helpers for sidebar media parse prepass (no I/O)."""

MAX_PARSE_IMAGE_URLS = 4

NON_VISION_PARSE_ERROR = (
    "当前侧栏模型不支持识图。请换成 DeepSeek Flash 或 Gemini 后再问。"
    "我没有根据这张图编造产品信息。"
)

_SUCCESS_PREFIX = "根据参考图："
_FAILURE_PREFIX = "未能根据参考图识别产品。"


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


def uncached_urls(urls: list[str], cache: dict | None) -> list[str]:
    if not cache:
        return list(urls)
    return [u for u in urls if u not in cache]


def merge_parse_records(urls: list[str], cache: dict) -> dict:
    summaries: list[str] = []
    fields: dict = {}
    unknown: set[str] = set()
    for url in urls:
        rec = cache.get(url) or {}
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


def format_parse_context_block(parse: dict) -> str:
    summary = str(parse.get("user_facing_summary") or "").strip() or "未知"
    category = str((parse.get("fields") or {}).get("category") or "").strip()
    category_line = category if category else "未知，勿编造"
    unknown = parse.get("unknown") or []
    unknown_hint = ""
    if unknown:
        unknown_hint = f"\n待确认项：{'、'.join(str(u) for u in unknown)}"
    return (
        "【侧栏参考图解析】\n"
        f"摘要：{summary}\n"
        f"品类：{category_line}{unknown_hint}\n"
        "请基于以上理解回答或写方案。不要声称只能看到文件名或画布节点标题。\n"
        "图中未出现的价格/平台/资质不要编，改为向用户确认。"
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
