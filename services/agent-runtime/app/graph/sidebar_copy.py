"""User-facing assistant copy for Agent side rail (not LLM / debug context)."""

from __future__ import annotations

from app.graph.atomic_intent import turnaround_pipeline_user_note

TARGET_TYPE_LABELS: dict[str, str] = {
    "image": "图片",
    "text": "文本",
    "video": "视频",
    "audio": "音频",
    "prompt": "提示词",
}

# Shown for video/audio confirm gate — keep in sync with agentChipSet.ts
ATOMIC_CONFIRM_SNIPPET = "提交前需你确认"


def _display_title(spec: dict) -> str:
    title = str(spec.get("title") or spec.get("prompt") or "").strip()
    return title[:48] + ("…" if len(title) > 48 else "")


def topic_switch_prefix(prior_title: str | None, new_title: str) -> str:
    """When the new request clearly differs from the last atomic task."""
    prior = (prior_title or "").strip()
    new = (new_title or "").strip()
    if not prior or not new:
        return ""
    if prior == new or prior in new or new in prior:
        return ""
    # Share at most one meaningful token → still treat as switch
    prior_tokens = {t for t in prior.replace("，", " ").split() if len(t) >= 2}
    new_tokens = {t for t in new.replace("，", " ").split() if len(t) >= 2}
    if prior_tokens & new_tokens:
        return ""
    return "已按你的新需求处理："


def _ref_ack_clause(ref_keys: list[str]) -> str:
    keys = "、".join(f"@{k}" for k in ref_keys)
    return f"我会参考你提供的 {keys}，"


def format_atomic_parse_ack(
    spec: dict,
    *,
    prior_spec: dict | None = None,
    ref_keys: list[str] | None = None,
) -> str:
    """Brief acknowledgment after intent parse — no internal routing labels."""
    title = _display_title(spec)
    target = TARGET_TYPE_LABELS.get(str(spec.get("target_type") or ""), "内容")
    prefix = topic_switch_prefix(
        str(prior_spec.get("title") or "") if prior_spec else None,
        title,
    )
    ref_clause = _ref_ack_clause(ref_keys) if ref_keys else ""
    if str(spec.get("pipeline") or "") == "turnaround_image":
        if ref_clause:
            body = f"好的，{prefix}{ref_clause}生成「{title}」的角色设定图（四格）。"
        else:
            body = f"好的，{prefix}我来生成「{title}」的角色设定图（四格）。"
    elif spec.get("confirm_gate"):
        if ref_clause:
            body = (
                f"收到，{prefix}{ref_clause}将为你创建{target}「{title}」。"
                f"{ATOMIC_CONFIRM_SNIPPET}。"
            )
        else:
            body = (
                f"收到，{prefix}将为你创建{target}「{title}」。"
                f"{ATOMIC_CONFIRM_SNIPPET}。"
            )
    elif ref_clause:
        body = f"好的，{prefix}{ref_clause}生成{title}。"
    else:
        body = f"好的，{prefix}我来生成{target}「{title}」。"
    return body


def format_atomic_multi_ack(items: list[dict], *, prior_spec: dict | None = None) -> str:
    titles = "、".join(_display_title(i) for i in items)
    prefix = topic_switch_prefix(
        str(prior_spec.get("title") or "") if prior_spec else None,
        _display_title(items[0]),
    )
    return f"好的，{prefix}我将创建 {len(items)} 张图片：{titles}。"


def format_atomic_create_progress(spec: dict, *, count: int = 1) -> str:
    """After canvas node exists, before / during Studio generation."""
    title = _display_title(spec)
    target = TARGET_TYPE_LABELS.get(str(spec.get("target_type") or ""), "内容")
    if count > 1:
        head = f"已在画布创建 {count} 个{target}节点，正在生成…"
    else:
        head = f"已在画布创建节点，正在为「{title}」生成…"
    if str(spec.get("pipeline") or "") == "turnaround_image":
        head += turnaround_pipeline_user_note()
    else:
        head += "可在画布查看进度。"
    return head


def format_atomic_gen_success(title: str, *, count: int = 1) -> str:
    if count > 1:
        return f"已完成 {count} 项生成，请在画布查看结果。"
    return f"「{title}」生成完成，请在画布查看节点。"


def format_atomic_gen_partial(completed: list[str], failed: list[str]) -> str:
    return f"部分完成：{'、'.join(completed)}；未完成：{'、'.join(failed)}。请在画布查看。"


def format_atomic_gen_failed(title: str, status: str) -> str:
    return f"「{title}」生成未完成（{status}）。可在画布节点重试。"
