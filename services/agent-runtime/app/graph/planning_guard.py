"""Planning Guard — distinguish plan/design vs generate/create utterances."""

from __future__ import annotations

import re
from typing import Literal

ActionKind = Literal["plan", "write", "generate", "expand", "unknown"]

PLANNING_VERBS = (
    "视觉方案",
    "视觉策划",
    "构图方案",
    "构图",
    "策划",
    "规划",
    "结构",
    "框架",
    "思路",
    "布局",
    "模块",
    "方案",
    "设计",
)

GENERATION_PATTERNS = (
    r"生成一张",
    r"生成一个",
    r"来一张",
    r"做一张",
    r"出一张",
    r"直接生成",
    r"帮我生成一张",
    r"帮我做一张",
    r"帮我生成一个",
)

WRITE_VERBS = ("写", "撰写", "起草", "输出文案", "输出")

EXPAND_MARKERS = ("提示词", "prompt", "扩写")

PLANNING_CONFIDENCE_CAP = 0.65


def detect_action(text: str) -> ActionKind:
    t = (text or "").strip()
    if not t:
        return "unknown"
    if any(m in t for m in EXPAND_MARKERS):
        return "expand"
    if is_explicit_generation_intent(t):
        return "generate"
    if any(v in t for v in WRITE_VERBS):
        return "write"
    if is_planning_intent(t):
        return "plan"
    return "unknown"


def is_planning_intent(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if any(v in t for v in PLANNING_VERBS):
        return True
    if "详情页" in t and any(x in t for x in ("构图", "方案", "结构", "布局", "模块")):
        return True
    return False


def is_explicit_generation_intent(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    for pat in GENERATION_PATTERNS:
        if re.search(pat, t):
            return True
    # 「设计一张海报」→ generate；「设计一个…方案」留给 planning
    if re.search(r"设计一张", t):
        return True
    return False


def has_planning_image_conflict(text: str) -> bool:
    """True when planning + ecommerce hero/detail assets without explicit generation."""
    t = (text or "").strip()
    if not t or is_explicit_generation_intent(t):
        return False
    if detect_action(t) == "write":
        return False
    if not is_planning_intent(t):
        return False
    has_hero = "主图" in t
    has_detail = "详情页" in t
    if has_hero and has_detail:
        return True
    if has_hero and any(x in t for x in ("方案", "构图", "布局", "结构")):
        return True
    return False


def planning_guard_confidence_cap(text: str, base_conf: float) -> float:
    if has_planning_image_conflict(text):
        return min(base_conf, PLANNING_CONFIDENCE_CAP)
    if is_planning_intent(text) and not is_explicit_generation_intent(text):
        return min(base_conf, PLANNING_CONFIDENCE_CAP)
    return base_conf


def planning_clarify_question(utterance: str) -> str:
    snippet = (utterance or "").strip()[:32]
    return (
        f"您提到「{snippet}…」涉及主图/详情页与构图方案。请确认：\n"
        "1）单张主图直接出图；\n"
        "2）完整详情页 Campaign 方案（多节点：主图/白底/场景等）；\n"
        "3）只要文字版构图策划（不出图）。\n"
        "回复 1 / 2 / 3，或补充具体需求。"
    )
