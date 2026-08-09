"""Explore intent classification and mandatory dispatch (Phase 2a)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

from app.graph.canvas_commands import extract_canvas_commands
from app.graph.explore_route import has_canvas_node_id_reference
from app.graph.node_ref import resolve_node_ref, resolve_node_refs
from app.tools.definitions import DEFAULT_WRITE_BIND, EXPLORE_READ_TOOLS, EXPLORE_WRITE_TOOLS
from app.tools.tool_registry import EXPLORE_TOOL_NAMES

ExploreIntent = Literal[
    "ui_command",
    "lifecycle",
    "asset_read",
    "node_read",
    "node_write",
    "open_query",
]

MANDATORY_INTENTS = frozenset({"ui_command", "lifecycle", "asset_read"})

_WRITE_VERBS = (
    "更新",
    "修改",
    "设置",
    "复制",
    "上传",
    "添加",
    "保存",
    "应用",
    "attach",
    "挂",
    "导出",
)
_QUERY_VERBS = (
    "看看",
    "有哪些",
    "列出",
    "查询",
    "检查",
    "状态",
    "什么情况",
    "怎么样",
)
_MUTATE_VERBS = (
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
_READ_VERBS = _QUERY_VERBS + ("诊断", "layout", "坐标", "位置", "详细信息")


@dataclass
class MandatoryExploreResult:
    tool_results: list[Any] = field(default_factory=list)
    canvas_commands: list[dict[str, Any]] = field(default_factory=list)
    reply_text: str = ""
    tools_called: list[str] = field(default_factory=list)


def select_narrow_write_tools(user_text: str) -> frozenset[str]:
    """Pick ≤5 write tools from user_text keywords (Phase 2b narrow bind)."""
    u = user_text or ""
    low = u.lower()
    if "prompt" in low or "prompt-" in low:
        return frozenset({"set_node_prompt", "upsert_prompt_node"})
    if "复制" in u:
        return frozenset({"duplicate_node"})
    if any(k in low for k in ("上传", "url", "picsum", "http")):
        return frozenset({"upload_media_to_canvas"})
    if any(k in low for k in ("attach", "参考", "侧栏", "localrefs")):
        return frozenset({"attach_refs", "apply_sidebar_attachments"})
    if "保存" in u and "资产" in u:
        return frozenset({"save_node_to_asset_library"})
    if "应用" in u and "资产" in u:
        return frozenset({"apply_asset_to_node"})
    if "text-" in low or "文案" in u:
        return frozenset({"set_node_content", "set_node_prompt"})
    return DEFAULT_WRITE_BIND


def select_explore_tool_names(intent: ExploreIntent, user_text: str) -> frozenset[str]:
    """Tool names to bind for LLM explore branch."""
    if intent == "node_read":
        return EXPLORE_READ_TOOLS
    if intent == "node_write":
        names = select_narrow_write_tools(user_text)
        assert len(names) <= 5
        return names
    return EXPLORE_TOOL_NAMES


def classify_explore_intent(user_text: str, *, summary: dict | None = None) -> ExploreIntent:
    """Rule-based intent for explore dispatch (Phase 2a)."""
    u = (user_text or "").strip()
    if not u:
        return "open_query"

    if ("撤销" in u or "重做" in u) and ("画布" in u or "操作" in u or "撤销" in u):
        return "ui_command"

    if "精修" in u and ("打开" in u or "编辑器" in u):
        return "ui_command"

    if ("定位" in u or "视口" in u) and ("节点" in u or "「" in u or has_canvas_node_id_reference(u)):
        return "ui_command"

    if ("引入" in u or "侧栏" in u) and ("节点" in u or "「" in u or has_canvas_node_id_reference(u)):
        return "ui_command"

    if "取消" in u and any(x in u for x in ("生成", "任务", "回退", "fallback", "平台")):
        return "lifecycle"

    if "确认" in u and any(x in u for x in ("回退", "fallback", "平台")):
        return "lifecycle"

    if any(k in u for k in ("资产库", "素材库", "公共素材")):
        if any(v in u for v in _QUERY_VERBS) and "保存" not in u:
            return "asset_read"

    has_node = has_canvas_node_id_reference(u) or "「" in u or (
        isinstance(summary, dict)
        and resolve_node_ref(u, summary) is not None
    )

    if has_node and any(v in u for v in _WRITE_VERBS):
        return "node_write"

    if has_node and any(v in u for v in _READ_VERBS):
        return "node_read"

    if any(v in u for v in _MUTATE_VERBS) and has_node:
        return "node_write"

    return "open_query"


def _serialize_result(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception:
        return str(result)


def _format_asset_reply(tool_name: str, result: Any) -> str:
    if isinstance(result, dict) and result.get("error"):
        return str(result.get("error"))
    label = "公共素材库" if tool_name == "list_public_assets" else "我的资产库"
    if isinstance(result, dict):
        items = result.get("assets") or result.get("items") or []
        if isinstance(items, list):
            if not items:
                return f"{label}暂无素材。"
            names = []
            for item in items[:8]:
                if isinstance(item, dict):
                    names.append(str(item.get("name") or item.get("label") or item.get("id") or ""))
            preview = "、".join(n for n in names if n)
            suffix = f"等共 {len(items)} 项" if len(items) > 8 else f"共 {len(items)} 项"
            return f"{label}：{preview}（{suffix}）"
    return f"已查询{label}。"


def _lifecycle_user_message(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    err = str(result.get("error") or result.get("message") or "")
    err_type = str(result.get("error_type") or "")
    low = err.lower()
    if "generationrecord" in low or "无进行" in err or "no generation" in low:
        return "该节点无进行中的生成任务。"
    if "fallback_pending" in low or "非 fallback" in err or "不在平台回退" in err:
        return "该节点不在平台回退待确认状态。"
    if err_type == "param_error" or "param" in err_type:
        return "参数有误，请先查询该节点的生成状态后再重试。"
    if result.get("ok"):
        return None
    return err or None


async def _invoke_tool(
    tools_by_name: dict[str, Any],
    name: str,
    args: dict[str, Any],
    *,
    canvas_commands: list[dict[str, Any]],
    tool_results: list[Any],
    tools_called: list[str],
) -> Any:
    tool = tools_by_name.get(name)
    if tool is None:
        result: Any = {"error": f"unknown tool: {name}"}
    else:
        result = await tool.ainvoke(args)
    tools_called.append(name)
    tool_results.append(result)
    for cmd in extract_canvas_commands(result):
        if cmd not in canvas_commands:
            canvas_commands.append(cmd)
    return result


async def run_mandatory_explore(
    intent: ExploreIntent,
    user_text: str,
    *,
    summary: dict,
    tools_by_name: dict[str, Any],
) -> MandatoryExploreResult:
    """Direct tool dispatch without LLM (UI / lifecycle / asset_read)."""
    canvas_commands: list[dict[str, Any]] = []
    tool_results: list[Any] = []
    tools_called: list[str] = []

    if intent == "ui_command":
        return await _mandatory_ui(
            user_text,
            summary=summary,
            tools_by_name=tools_by_name,
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
        )

    if intent == "lifecycle":
        return await _mandatory_lifecycle(
            user_text,
            summary=summary,
            tools_by_name=tools_by_name,
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
        )

    if intent == "asset_read":
        return await _mandatory_asset(
            user_text,
            tools_by_name=tools_by_name,
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
        )

    return MandatoryExploreResult(
        reply_text="内部错误：非 mandatory intent",
        canvas_commands=canvas_commands,
        tool_results=tool_results,
        tools_called=tools_called,
    )


async def _mandatory_ui(
    user_text: str,
    *,
    summary: dict,
    tools_by_name: dict[str, Any],
    canvas_commands: list[dict[str, Any]],
    tool_results: list[Any],
    tools_called: list[str],
) -> MandatoryExploreResult:
    u = user_text or ""

    if "撤销" in u and ("画布" in u or "操作" in u):
        await _invoke_tool(
            tools_by_name, "undo", {}, canvas_commands=canvas_commands,
            tool_results=tool_results, tools_called=tools_called,
        )
        return MandatoryExploreResult(
            tool_results=tool_results,
            canvas_commands=canvas_commands,
            reply_text="已撤销上一步画布操作。",
            tools_called=tools_called,
        )

    if "重做" in u:
        await _invoke_tool(
            tools_by_name, "redo", {}, canvas_commands=canvas_commands,
            tool_results=tool_results, tools_called=tools_called,
        )
        return MandatoryExploreResult(
            tool_results=tool_results,
            canvas_commands=canvas_commands,
            reply_text="已重做画布操作。",
            tools_called=tools_called,
        )

    if "精修" in u or ("打开" in u and "编辑器" in u):
        node_id = resolve_node_ref(u, summary)
        if not node_id:
            return MandatoryExploreResult(
                reply_text="请指定要精修的图片节点（如 image-16 或「节点标题」）。",
            )
        await _invoke_tool(
            tools_by_name,
            "open_image_editor",
            {"node_id": node_id},
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
        )
        return MandatoryExploreResult(
            tool_results=tool_results,
            canvas_commands=canvas_commands,
            reply_text=f"已打开节点 {node_id} 的精修编辑器。",
            tools_called=tools_called,
        )

    if "引入" in u or ("侧栏" in u and "节点" in u):
        node_ids = resolve_node_refs(u, summary)
        if not node_ids:
            return MandatoryExploreResult(
                reply_text="请指定要引入侧栏的节点（如 image-16 或「节点标题」）。",
            )
        await _invoke_tool(
            tools_by_name,
            "introduce_nodes_to_agent",
            {"node_ids": node_ids},
            canvas_commands=canvas_commands,
            tool_results=tool_results,
            tools_called=tools_called,
        )
        return MandatoryExploreResult(
            tool_results=tool_results,
            canvas_commands=canvas_commands,
            reply_text=f"已将 {len(node_ids)} 个节点引入 Agent 侧栏上下文。",
            tools_called=tools_called,
        )

    if "定位" in u or "视口" in u:
        node_ids = resolve_node_refs(u, summary)
        if not node_ids:
            return MandatoryExploreResult(
                reply_text="请指定要定位的节点（如 image-16 或「节点标题」）。",
            )
        if len(node_ids) == 1:
            await _invoke_tool(
                tools_by_name,
                "focus_node",
                {"node_id": node_ids[0]},
                canvas_commands=canvas_commands,
                tool_results=tool_results,
                tools_called=tools_called,
            )
            reply = f"已将视口定位到节点 {node_ids[0]}。"
        else:
            await _invoke_tool(
                tools_by_name,
                "focus_nodes",
                {"node_ids": node_ids},
                canvas_commands=canvas_commands,
                tool_results=tool_results,
                tools_called=tools_called,
            )
            reply = f"已将视口定位到 {len(node_ids)} 个节点。"
        return MandatoryExploreResult(
            tool_results=tool_results,
            canvas_commands=canvas_commands,
            reply_text=reply,
            tools_called=tools_called,
        )

    return MandatoryExploreResult(reply_text="未能识别 UI 操作，请说明定位、撤销、重做或精修等具体需求。")


async def _mandatory_lifecycle(
    user_text: str,
    *,
    summary: dict,
    tools_by_name: dict[str, Any],
    canvas_commands: list[dict[str, Any]],
    tool_results: list[Any],
    tools_called: list[str],
) -> MandatoryExploreResult:
    node_id = resolve_node_ref(user_text, summary)
    if not node_id:
        return MandatoryExploreResult(
            reply_text="请指定节点 id（如 image-16），以便取消或确认生成任务。",
        )

    u = user_text or ""
    if "确认" in u:
        tool_name = "confirm_platform_fallback"
        ok_msg = f"已确认节点 {node_id} 的平台回退继续。"
    elif "取消" in u and any(x in u for x in ("回退", "fallback", "平台")):
        tool_name = "cancel_platform_fallback"
        ok_msg = f"已取消节点 {node_id} 的平台回退。"
    else:
        tool_name = "cancel_generation"
        ok_msg = f"已取消节点 {node_id} 上的生成任务。"

    result = await _invoke_tool(
        tools_by_name,
        tool_name,
        {"node_id": node_id},
        canvas_commands=canvas_commands,
        tool_results=tool_results,
        tools_called=tools_called,
    )
    err_msg = _lifecycle_user_message(result)
    reply = err_msg if err_msg else ok_msg
    return MandatoryExploreResult(
        tool_results=tool_results,
        canvas_commands=canvas_commands,
        reply_text=reply,
        tools_called=tools_called,
    )


async def _mandatory_asset(
    user_text: str,
    *,
    tools_by_name: dict[str, Any],
    canvas_commands: list[dict[str, Any]],
    tool_results: list[Any],
    tools_called: list[str],
) -> MandatoryExploreResult:
    u = user_text or ""
    tool_name = "list_public_assets" if "公共" in u else "list_user_assets"
    result = await _invoke_tool(
        tools_by_name,
        tool_name,
        {},
        canvas_commands=canvas_commands,
        tool_results=tool_results,
        tools_called=tools_called,
    )
    return MandatoryExploreResult(
        tool_results=tool_results,
        canvas_commands=canvas_commands,
        reply_text=_format_asset_reply(tool_name, result),
        tools_called=tools_called,
    )
