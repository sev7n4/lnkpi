"""Deterministic §7 copy sanitization for planner assistant replies."""

from __future__ import annotations

import re

_FORBIDDEN_PHRASES = (
    "种子／出图方式",
    "种子/出图方式",
    "出图方式",
    "种子链",
    "嫁接",
    "种子",
)

_FORBIDDEN_IDS = (
    "ecommerce-product-visual",
    "model-turnaround",
    "storyboard-to-video",
    "image-to-video",
)

_TOKEN_RE = re.compile(
    r"(?i)\b(t2i|i2i|v_ref|parentId|parent_id|recipeId|recipe_id|recipe\s*id|"
    r"graft|lint|delta|gen_mode|seed_chain|seed)\b"
)
_ID_EQ_RE = re.compile(r"(?i)\b(parentId|parent_id|recipeId|recipe_id)\s*=\s*\S+")
_PAREN_RE = re.compile(r"[（(]([^）)]*)[）)]")
_KEEP_IN_PAREN = ("接上", "核心", "模板", "改版", "步骤")
_EDGE_PUNCT_RE = re.compile(r"^[\s，,;；/／|]+|[\s，,;；/／|]+$")
_EMPTY_PAREN_RE = re.compile(r"[（(]\s*[）)]")
_MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")
_CHIP_EXACT = frozenset({
    "确认落到画布",
    "先不改",
    "确认锁定这些核心步骤",
    "确认保存为改版",
    "保存为当前模板的改版",
    "存成一套新模板",
    "返回",
})
_CHIP_PREFIXES = (
    "确认锁定这些核心步骤",
    "将锁定这些核心步骤",
)


def _has_forbidden(fragment: str) -> bool:
    if _TOKEN_RE.search(fragment) or _ID_EQ_RE.search(fragment):
        return True
    for phrase in _FORBIDDEN_PHRASES:
        if phrase in fragment:
            return True
    low = fragment.lower()
    return any(ident in low for ident in _FORBIDDEN_IDS)


def _clean_fragment(fragment: str) -> str:
    out = fragment
    out = _ID_EQ_RE.sub("", out)
    for phrase in _FORBIDDEN_PHRASES:
        out = out.replace(phrase, "")
    for ident in _FORBIDDEN_IDS:
        out = re.sub(re.escape(ident), "", out, flags=re.I)
    out = _TOKEN_RE.sub("", out)
    return _MULTI_SPACE_RE.sub(" ", out)


def _replace_paren(match: re.Match[str]) -> str:
    raw = match.group(1)
    had_forbidden = _has_forbidden(raw)
    inner = _EDGE_PUNCT_RE.sub("", _clean_fragment(raw).strip())
    if not inner:
        return ""
    if had_forbidden and not any(keep in inner for keep in _KEEP_IN_PAREN):
        return ""
    open_ch = match.group(0)[0]
    close_ch = match.group(0)[-1]
    return f"{open_ch}{inner}{close_ch}"


def sanitize_planner_reply(text: str | None) -> str:
    if not text:
        return ""
    out = _PAREN_RE.sub(_replace_paren, str(text))
    out = _clean_fragment(out)
    out = _EMPTY_PAREN_RE.sub("", out)
    out = _MULTI_SPACE_RE.sub(" ", out)
    out = re.sub(r" *\n *", "\n", out)
    return out.strip()


def pick_planner_slot_utterance(texts: list[str] | None) -> str:
    cleaned = [str(item).strip() for item in (texts or []) if str(item).strip()]
    for text in reversed(cleaned):
        if text in _CHIP_EXACT:
            continue
        if any(text.startswith(prefix) for prefix in _CHIP_PREFIXES):
            continue
        return text
    return cleaned[-1] if cleaned else ""
