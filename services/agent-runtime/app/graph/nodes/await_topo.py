from __future__ import annotations

from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

# 修复 P0-1（拓扑确认门节点内容修改）：
# 原来只有 topo_revise（只支持删节点），用户说"把模特定妆改为双人模特"会被误判为
# topo_revise，进 topo_revise 节点后因只支持删除而返回"未识别具体改动"。
# 现在拆分为：
# - node_revise: 节点内容修改（改为/调整/增加/换）→ 回退到 plan 走 modify 模式
# - topo_revise: 纯拓扑删除（删掉/去掉/移除）→ 进 topo_revise 节点
Decision = Literal["none", "confirm_gen", "topo_revise", "node_revise"]

_NONE_TIP = "请确认出图，或说明如何调整（例如「删掉 Banner」或「把模特定妆改为双人模特」）；主文案可用「写入主文案」。"

_CONFIRM_GEN_HINTS = (
    "确认出图",
    "开始出图",
    "出图吧",
    "可以出图",
    "生成图片",
    "开始生成",
)

# 节点内容修改动词：改现有节点的属性/内容，或新增节点
# 这些应该回退到 plan 走 modify 模式（LLM 增量修改方案）
_NODE_REVISE_HINTS = (
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

# 纯拓扑级修改：删除节点 / 改连接关系
# topo_revise 节点用启发式处理（不需要 LLM）
_TOPO_REVISE_HINTS = (
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

# node_revise 时的上下文衔接提示（修复 P1-2：修改失败后无上下文衔接）
_NODE_REVISE_ACK = (
    "好的，正在基于当前方案调整您提到的部分，保留其余节点不变，请稍候…"
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def classify_topo_decision(text: str) -> Decision:
    t = text.strip()
    if not t:
        return "none"
    lowered = t.lower()
    if any(h in t or h in lowered for h in _CONFIRM_GEN_HINTS):
        return "confirm_gen"
    # 优先检测节点内容修改（改为/调整/增加等）→ 走 plan modify 分支
    # 注意：必须在 topo_revise 之前检测，因为"增加"语义上更偏节点内容修改
    if any(h in t for h in _NODE_REVISE_HINTS):
        return "node_revise"
    if any(h in t for h in _TOPO_REVISE_HINTS):
        return "topo_revise"
    if t in ("确认", "1", "A", "a") or t.lower() == "ok":
        return "confirm_gen"
    return "none"


def make_await_topo_node() -> Callable:
    async def await_topo(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        decision = classify_topo_decision(text)
        if decision == "none":
            return {
                "user_decision": "none",
                "awaiting_user": True,
                "phase": "await_topo",
                "messages": [AIMessage(content=_NONE_TIP)],
            }
        if decision == "topo_revise":
            return {
                "user_decision": "topo_revise",
                "awaiting_user": True,
                "phase": "await_topo",
            }
        if decision == "node_revise":
            # 修复 P0-1 + P1-2：节点内容修改 → 回退到 plan 走 modify 模式
            # 设置 mode=modify 让 plan 用 _MODIFY_INSTRUCTION 增量修改（保留未提及节点）
            # 同时清空 pending_orchestrate 避免误触发出图
            return {
                "user_decision": "node_revise",
                "awaiting_user": False,
                "phase": "await_topo",
                "mode": "modify",
                "pending_orchestrate": False,
                "messages": [AIMessage(content=_NODE_REVISE_ACK)],
            }
        return {
            "user_decision": "confirm_gen",
            "awaiting_user": False,
            "phase": "await_topo",
            "pending_orchestrate": False,
            "messages": [AIMessage(content="开始按拓扑出图，请稍候…")],
        }

    return await_topo
