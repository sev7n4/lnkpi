from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.intent import classify_topo_decision

# 修复 P0-1（拓扑确认门节点内容修改）：
# 原来只有 topo_revise（只支持删节点），用户说"把模特定妆改为双人模特"会被误判为
# topo_revise，进 topo_revise 节点后因只支持删除而返回"未识别具体改动"。
# 现在拆分为：
# - node_revise: 节点内容修改（改为/调整/增加/换）→ 回退到 plan 走 modify 模式
# - topo_revise: 纯拓扑删除（删掉/去掉/移除）→ 进 topo_revise 节点

_NONE_TIP = "请确认出图，或说明如何调整（例如「删掉 Banner」或「把模特定妆改为双人模特」）；主文案可用「写入主文案」。"

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


def make_await_topo_node() -> Callable:
    async def await_topo(state: dict) -> dict:
        # W5: interrupt_before 替代 awaiting_user flag
        # 从 checkpoint 恢复时，state 已包含用户新消息
        text = _latest_user_text(state.get("messages") or [])
        decision = classify_topo_decision(text)
        if decision == "none":
            return {
                "user_decision": "none",
                "phase": "await_topo",
                "messages": [AIMessage(content=_NONE_TIP)],
            }
        if decision == "topo_revise":
            return {
                "user_decision": "topo_revise",
                "phase": "await_topo",
            }
        if decision == "node_revise":
            # 修复 P0-1 + P1-2：节点内容修改 → 回退到 plan 走 modify 模式
            # 设置 mode=modify 让 plan 用 _MODIFY_INSTRUCTION 增量修改（保留未提及节点）
            # 同时清空 pending_orchestrate 避免误触发出图
            return {
                "user_decision": "node_revise",
                "phase": "await_topo",
                "mode": "modify",
                "pending_orchestrate": False,
                "messages": [AIMessage(content=_NODE_REVISE_ACK)],
            }
        return {
            "user_decision": "confirm_gen",
            "phase": "await_topo",
            "pending_orchestrate": False,
            "messages": [AIMessage(content="开始按拓扑出图，请稍候…")],
        }

    return await_topo
