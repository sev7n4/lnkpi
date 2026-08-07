from __future__ import annotations

MAX_SIDEBAR_ATTACHMENTS = 5


def normalize_sidebar_attachments(raw: list[dict] | None) -> list[dict]:
    if not raw:
        return []
    if len(raw) > MAX_SIDEBAR_ATTACHMENTS:
        raise ValueError(f"最多 {MAX_SIDEBAR_ATTACHMENTS} 个参考素材")
    out: list[dict] = []
    for item in raw:
        url = str(item.get("url") or "").strip()
        text = str(item.get("text") or "").strip()
        if url.startswith("blob:"):
            raise ValueError("blob URL 不允许")
        if not url and not text:
            raise ValueError("参考素材缺少 url 或 text")
        out.append(dict(item))
    return out
