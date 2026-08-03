"""Unified intent classification constants and functions (W9).

This module consolidates intent-related keywords that were previously scattered across:
- intake.py: _MODIFY_HINTS, _MARKETING_HINTS
- await_topo.py: _NODE_REVISE_HINTS, _TOPO_REVISE_HINTS, _CONFIRM_GEN_HINTS
- await_confirm.py: _CONFIRM_HINTS, _REVISE_HINTS
"""

from __future__ import annotations

from typing import Literal

# Intake node: marketing intent keywords
MARKETING_HINTS = (
    "营销",
    "主图",
    "详情页",
    "banner",
    "campaign",
    "洁具",
    "卫浴",
    "电商",
    "天猫",
    "拆画布",
    "出图",
    "分镜",
)

# Intake node: modification intent keywords
MODIFY_HINTS = (
    "改成",
    "改一下",
    "修改",
    "调整",
    "换成",
    "改为",
    "更偏",
    "强调",
    "增加",
    "加上",
    "删掉",
    "删除",
    "去掉",
    "移除",
    "再改",
    "改一版",
    "自己说明",
    "自己说",
    "改拓扑",
)

# await_topo node: confirm generation keywords
CONFIRM_GEN_HINTS = (
    "确认出图",
    "开始出图",
    "出图吧",
    "可以出图",
    "生成图片",
    "开始生成",
)

# await_topo node: node content revision keywords
NODE_REVISE_HINTS = (
    "改为",
    "改成",
    "调整",
    "换",
    "更偏",
    "强调",
    "修改",
    "增加",
    "加上",
    "补一个",
    "补一张",
    "再加",
)

# await_topo node: topology query keywords (handled in topo_revise)
TOPO_QUERY_HINTS = (
    "查看",
    "查询",
    "看一下",
    "prompt是什么",
    "什么prompt",
)

# await_topo node: topology revision keywords
TOPO_REVISE_HINTS = (
    "要改拓扑",
    "改拓扑",
    "删掉",
    "删除",
    "去掉",
    "移除",
    "不要",
    "依赖",
    "连到",
)

# await_confirm node: confirm keywords
CONFIRM_HINTS = (
    "确认方案",
    "确认",
    "同意",
    "可以",
    "没问题",
    "按这个",
    "开始拆",
    "ok",
    "okay",
    "yes",
    "confirm",
)

# await_confirm node: revise keywords
REVISE_HINTS = (
    "改成",
    "修改",
    "调整",
    "换",
    "不要",
    "重新",
    "revise",
    "改一下",
    "更偏",
    "要修改",
    "自己说",
)

# await_confirm node: fresh brief keywords
FRESH_BRIEF_HINTS = (
    "请为",
    "写一份",
    "帮我设计",
    "帮我做",
    "帮我写",
)

# await_confirm node: confirm negation keywords
CONFIRM_NEGATIONS = (
    "无修改",
    "不修改",
    "不用改",
    "无需修改",
    "没有修改",
)


def marketing_intent(text: str) -> bool:
    """Check if text indicates marketing/campaign canvas orchestration intent."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    return any(h in lowered for h in MARKETING_HINTS)


def modify_intent(text: str) -> bool:
    """Check if text indicates modification intent for existing plan/skeleton."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    return any(h in lowered for h in MODIFY_HINTS)


TopoDecision = Literal["none", "confirm_gen", "topo_revise", "node_revise"]


def classify_topo_decision(text: str) -> TopoDecision:
    """Classify user decision in await_topo phase."""
    t = text.strip()
    if not t:
        return "none"
    lowered = t.lower()
    if any(h in t or h in lowered for h in CONFIRM_GEN_HINTS):
        return "confirm_gen"
    if any(h in t for h in TOPO_QUERY_HINTS):
        return "topo_revise"
    if any(h in t for h in TOPO_REVISE_HINTS):
        return "topo_revise"
    if any(h in t for h in ("增加", "加上", "补一个", "补一张", "再加")):
        return "topo_revise"
    if any(h in t for h in ("改为", "改成", "调整", "换成", "修改")):
        return "topo_revise"
    # Plan-level revise (no concrete single-node op) → full modify flow
    if any(h in t for h in NODE_REVISE_HINTS):
        return "node_revise"
    if t in ("确认", "1", "A", "a") or t.lower() == "ok":
        return "confirm_gen"
    return "none"


ConfirmDecision = Literal["none", "confirm", "revise"]


def classify_user_decision(text: str) -> ConfirmDecision | None:
    """Classify user decision in await_confirm phase. Returns None when ambiguous."""
    raw = text.strip()
    lowered = raw.lower()
    if not lowered:
        return "none"

    token = raw.split()[0].strip().rstrip(".).、）") if raw else ""
    token_u = token.upper()
    if token in ("1",) or token_u in ("A", "Ａ"):
        return "confirm"
    if token in ("2", "3") or token_u in ("B", "C", "Ｂ", "Ｃ"):
        return "revise"

    if any(n in lowered for n in CONFIRM_NEGATIONS):
        return "confirm"

    if any(h in lowered for h in REVISE_HINTS):
        return "revise"
    if any(h in lowered for h in CONFIRM_HINTS):
        if len(lowered) > 24 and any(h in lowered for h in FRESH_BRIEF_HINTS):
            return None
        return "confirm"

    if any(k in lowered for k in ("营销方案", "帮我设计", "帮我做")):
        return "none"
    return None


# await_copy_confirm node: copy-specific confirm/revise keywords
COPY_CONFIRM_HINTS = (
    "写入主文案",
    "确认写入",
    "可以写入",
    "用这个",
    "就这个",
    "写入",
)

CopyDecision = Literal["none", "confirm", "revise"]


def classify_copy_decision(text: str) -> CopyDecision:
    """Classify user decision in await_copy_confirm phase."""
    lowered = text.strip().lower()
    if not lowered:
        return "none"
    if any(h in lowered for h in REVISE_HINTS):
        return "revise"
    if any(h in lowered for h in COPY_CONFIRM_HINTS):
        return "confirm"
    return "none"