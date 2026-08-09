"""Explore canvas routing signals — existing-node ops vs atomic create."""

from __future__ import annotations

import re

_NODE_ID_PATTERN = re.compile(
    r"\b(?:prompt|image|text|video|audio|group)-[\w-]+\b",
    re.IGNORECASE,
)

_EXPLORE_QUERY_VERBS = (
    "看看",
    "有哪些",
    "列出",
    "查询",
    "检查",
    "状态",
    "什么情况",
    "怎么样",
)

_EXPLORE_MUTATE_VERBS = (
    "更新",
    "修改",
    "设置",
    "复制",
    "上传",
    "添加",
    "保存",
    "导出",
    "引入",
    "定位",
    "撤销",
    "重做",
    "打开",
    "挂",
    "应用",
    "attach",
)

_EXPLORE_LIFECYCLE_MARKERS = (
    "取消生成",
    "平台回退",
    "fallback",
    "诊断",
    "失败原因",
)


def has_canvas_node_id_reference(text: str) -> bool:
    return bool(_NODE_ID_PATTERN.search(text or ""))


def explore_explicit_intent(utterance: str) -> bool:
    """True when utterance is an existing-node / canvas explore op (not new gen)."""
    u = (utterance or "").strip()
    if not u:
        return False

    if ("资产库" in u or "素材库" in u or "公共素材" in u) and any(
        v in u for v in _EXPLORE_QUERY_VERBS
    ):
        return True

    if has_canvas_node_id_reference(u) and any(
        v in u for v in _EXPLORE_QUERY_VERBS + _EXPLORE_MUTATE_VERBS + ("取消", "确认")
    ):
        return True

    if "节点" in u:
        if any(v in u for v in _EXPLORE_MUTATE_VERBS):
            if ("添加" in u or "上传" in u) and not any(
                x in u for x in ("不要出图", "仅上传", "不要触发出图", "仅添加", "查询")
            ):
                pass
            else:
                return True
        if any(v in u for v in _EXPLORE_QUERY_VERBS):
            return True

    if any(v in u for v in ("撤销", "重做")) and ("画布" in u or "操作" in u):
        return True

    if "精修" in u and ("打开" in u or "编辑器" in u or "编辑" in u):
        return True

    if "取消" in u and any(x in u for x in ("生成", "任务", "回退", "fallback")):
        return True

    if "确认" in u and any(x in u for x in ("回退", "fallback", "平台")):
        return True

    if any(k in u for k in _EXPLORE_LIFECYCLE_MARKERS):
        return True

    return False


def explore_canvas_signal(
    utterance: str,
    *,
    blocked_by_atomic: bool,
) -> bool:
    """Shared noun/verb table for explore_canvas routing."""
    u = (utterance or "").strip()
    if not u:
        return False

    if explore_explicit_intent(u):
        return True

    if blocked_by_atomic:
        return False

    nouns = (
        "画布",
        "节点",
        "分镜",
        "canvas",
        "生成状态",
        "生成任务",
        "任务状态",
        "资产库",
        "素材库",
        "素材",
    )
    verbs = _EXPLORE_QUERY_VERBS + _EXPLORE_MUTATE_VERBS
    has_noun = any(n in u for n in nouns)
    has_verb = any(v in u for v in verbs)
    lifecycle = any(k in u for k in _EXPLORE_LIFECYCLE_MARKERS)
    return lifecycle or (has_noun and has_verb)
