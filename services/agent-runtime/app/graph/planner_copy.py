"""Deterministic §7 copy sanitization for planner assistant replies."""

from __future__ import annotations

import json
import re
from typing import Any

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
_PREVIEW_TOOL = "preview_workflow_template"
PLANNER_PREVIEW_ARGS_KW = "planner_preview_args"

PLANNER_CONFIRM_CHIP = "确认落到画布"
PLANNER_CANCEL_CHIP = "先不改"
PLANNER_NO_PREVIEW_REPLY = "请先规划并确认模板改动，再落到画布。"
PLANNER_CANCEL_REPLY = "已取消落到画布。"
PLANNER_INSTANTIATED_REPLY = "已按模板落到画布。"


def is_planner_confirm_chip(text: str | None) -> bool:
    return (text or "").strip() == PLANNER_CONFIRM_CHIP


def is_planner_cancel_chip(text: str | None) -> bool:
    return (text or "").strip() == PLANNER_CANCEL_CHIP


def _tool_field(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _parse_tool_payload(content: Any) -> Any:
    if isinstance(content, dict):
        return content
    if isinstance(content, str) and content.strip():
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return content
    return content


def _normalize_preview_args(args: Any) -> dict[str, Any] | None:
    if not isinstance(args, dict):
        return None
    parent_id = str(args.get("parent_id") or args.get("parentId") or "").strip()
    parent_version = str(args.get("parent_version") or args.get("parentVersion") or "").strip()
    if not parent_id or not parent_version:
        return None
    delta = args.get("delta")
    if not isinstance(delta, dict):
        delta = {}
    return {"parent_id": parent_id, "parent_version": parent_version, "delta": delta}


def last_successful_preview_args(messages: list[Any] | None) -> dict[str, Any] | None:
    """Latest successful preview args from raw thread messages.

    Explore only checkpoints the final HITL ``AIMessage``, not the in-process
    tool-call / ToolMessage pair. Successful preview turns stamp normalized
    args on ``additional_kwargs[PLANNER_PREVIEW_ARGS_KW]`` so the confirm
    chip can recover them next turn.
    """
    pending: dict[str, dict[str, Any]] = {}
    successes: list[dict[str, Any]] = []
    for msg in messages or []:
        extra = _tool_field(msg, "additional_kwargs") or {}
        if isinstance(extra, dict):
            stamped = _normalize_preview_args(extra.get(PLANNER_PREVIEW_ARGS_KW))
            if stamped:
                successes.append(stamped)
        for tc in _tool_field(msg, "tool_calls") or []:
            if _tool_field(tc, "name") != _PREVIEW_TOOL:
                continue
            normalized = _normalize_preview_args(_tool_field(tc, "args") or {})
            tc_id = str(_tool_field(tc, "id") or "").strip()
            if normalized and tc_id:
                pending[tc_id] = normalized
        role = getattr(msg, "type", None) or _tool_field(msg, "role")
        if role not in ("tool",) and type(msg).__name__ != "ToolMessage":
            continue
        tc_id = str(_tool_field(msg, "tool_call_id") or "").strip()
        if tc_id not in pending:
            continue
        args = pending.pop(tc_id)
        payload = _parse_tool_payload(_tool_field(msg, "content"))
        if isinstance(payload, dict) and payload.get("error"):
            continue
        successes.append(args)
    return successes[-1] if successes else None


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


_PLANNER_CONFIRM_LINE = "请确认是否把改动落到画布"
_MACHINE_KEYS = frozenset({"loaded", "candidates", "tool_call_id", "error_type"})


def format_planner_preview_hitl(preview: dict | None) -> str:
    if not isinstance(preview, dict):
        return _PLANNER_CONFIRM_LINE
    parent = str(preview.get("parentTitle") or preview.get("title") or "这套模板").strip() or "这套模板"
    diffs = [str(line).strip() for line in (preview.get("diffLines") or []) if str(line).strip()]
    notes = [str(msg).strip() for msg in (preview.get("userMessages") or []) if str(msg).strip()]
    parts: list[str] = []
    if diffs:
        parts.append(f"相对「{parent}」的改动：")
        parts.extend(f"- {line}" for line in diffs)
    else:
        parts.append(f"相对「{parent}」，按原模板落到画布。")
    parts.extend(notes)
    if _PLANNER_CONFIRM_LINE not in "\n".join(parts):
        parts.append(_PLANNER_CONFIRM_LINE)
    return "\n".join(parts)


def is_machine_payload_reply(text: str | None) -> bool:
    raw = (text or "").strip()
    if not raw or raw[0] not in "{[":
        return False
    try:
        payload = json.loads(raw)
    except Exception:
        return "loaded" in raw and "candidates" in raw
    if isinstance(payload, dict):
        return bool(set(payload) & _MACHINE_KEYS)
    return False
