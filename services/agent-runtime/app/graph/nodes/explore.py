"""Explore canvas path — mandatory dispatch + LLM for read/write/open_query."""

from __future__ import annotations

import json
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.errors import AgentToolError, from_exception
from app.graph.canvas_commands import extract_canvas_commands
from app.graph.composition_route import is_composition_structure_utterance
from app.graph.explore_dispatch import (
    MANDATORY_INTENTS,
    classify_explore_intent,
    mentioned_keys_for_sidebar_bind,
    run_mandatory_explore,
    select_narrow_write_tools,
    sidebar_image_keys_from_attachments,
    this_turn_new_image_keys_from_parse,
)
from app.graph.planner_copy import (
    COMPOSITION_CANCEL_REPLY,
    COMPOSITION_DUMP_HASH_KW,
    COMPOSITION_EXTRACT_INCOMPLETE,
    COMPOSITION_KIND,
    COMPOSITION_LANDED_REPLY,
    COMPOSITION_NO_PREVIEW_REPLY,
    PLANNER_INSTANTIATED_REPLY,
    PLANNER_PREVIEW_ARGS_KW,
    format_planner_preview_hitl,
    is_machine_payload_reply,
    is_planner_cancel_chip,
    is_planner_confirm_chip,
    last_successful_preview_args,
    pick_planner_slot_utterance,
    sanitize_planner_reply,
)
from app.graph.recent_turns import compress_recent_turns
from app.graph.sidebar_media_parse import (
    format_parse_context_block,
    parse_block_asks_unknown,
    prefix_assistant_reply,
)
from app.graph.tool_sse import cap_tool_sse_payload, maybe_emit_tool_sse
from app.metrics import record_explore_dispatch
from app.tools.definitions import EXPLORE_WRITE_TOOLS, build_explore_tools
from app.tools.tool_plan import META_TOOL_NAME, build_tool_plan
from app.tools.tool_registry import DEFERRED_TOOL_NAMES
from app.tools.tool_search import make_tool_search_tool

MAX_EXPLORE_TOOL_ROUNDS = 4
_PLANNER_CONFIRM_LINE = "请确认是否把改动落到画布"
_PLANNER_PROMOTE_LINE = "这份工作流更像哪一种？"
_PLANNER_SYSTEM = (
    "规划工作流时：先 match_workflow_templates 再 preview_workflow_template。"
    "用户已说「确认落到画布」后用 instantiate_workflow_template，不要用手搭替代已确认的 instantiate。"
    "未确认落到画布时不要 instantiate；口语搭骨架（多节点+连线+填 dock）用 upsert_media_node 与 connect_nodes。"
    "instantiate_workflow_template 只在用户确认落到画布之后调用，"
    "只传 parent_id、parent_version、delta，不要传完整模板。"
    "对用户只用「模板」「核心步骤」「改版」「接到另一套模板」；"
    "不要对用户写 seed、种子、种子链、t2i、i2i、v_ref、graft、内部 id、recipe id、version、节点 key。"
    "收成模板时先问「这份工作流更像哪一种？」；认不到原模板时只问新模板。"
    "用户选出后先调用 promote_workflow_template："
    "改版不要带 confirmed，新模板不要带 confirmed_seed_keys。"
    "若工具返回 needs_seed_confirm 或 needs_variant_confirm，把 userMessage 原样告诉用户并等二次确认，禁止此时当已入库。"
    "二次确认后再带 confirmed=true 或 confirmed_seed_keys 调用。"
    "instantiate_workflow_template 落盘已含对 addedNodeIds 的顺连线；"
    "仅当用户要再整理时再调用 arrange_nodes_along_edges。"
)


def planner_promote_followup(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    status = str(result.get("status") or "")
    msg = str(result.get("userMessage") or "").strip()
    if status in ("needs_seed_confirm", "needs_variant_confirm") and msg:
        return msg
    return None

# Unified canvas_agent system prompt (spec §3.6) — also re-exported as chat._SYSTEM.
_EXPLORE_SYSTEM = (
    "你是 lnkpi 无限画布助手。用简洁中文回答。\n"
    "规则：\n"
    "1. 必须通过工具完成读写操作，禁止假装已执行。\n"
    "2. 平台支持在画布上生成图片/视频等媒体；不得否认平台的图片生成能力，"
    "也不要引导用户使用第三方作图工具。\n"
    "3. 不要声称「正在生成」「马上生成」「已开始出图」；不要调用 run_*_generation"
    "（禁止调用任何 run_*）。真正出图/出视频须等用户在 UI 确认后由系统执行。\n"
    "4. 用户要创建图片/视频/文本/音频节点或明确「生成一张…」时：用 upsert_media_node"
    "创建或更新节点（可带 prompt），按需再用 set_node_prompt 填参、用 connect_nodes 连线，"
    "然后调用 propose_generation，并等待用户确认；不要假装已出图。"
    "有侧栏参考图要出结果图时：用 upsert_media_node 新建一张图节点（用户明确要求改某个"
    "image-* 除外），再 apply_sidebar_attachments（mode=localRefs，mentioned_keys 用 I1/I2"
    "芯片序），必要时 set_node_prompt，然后 propose_generation。此路径不要 connect_nodes、"
    "不要 attach_refs。"
    "挂参分工：侧栏 @I* / I1 只用 apply_sidebar_attachments（mode=localRefs）；"
    "画布已有 image-* / video-* 才用 attach_refs 或 connect_nodes。"
    "禁止 attach_refs 吃芯片 key；禁止 connect_nodes 连芯片。"
    "闲聊、谢谢、纯识图问句、「重新生成一张」即使工具可见也不得 upsert_media_node / propose_generation。"
    "无「确认落到画布」不得 instantiate_workflow_template。"
    "一致性写在提示词和 ref 顺序（先身份后衣服/产品），不要再搭工作流。\n"
    "5. 工作流类请求（骨架 + 生成 + 填 dock）：优先摆多个节点并用连线（connect_nodes）"
    "串起来，不要压成单个 atomic 式节点。\n"
    "6. 若需要当前未绑定的能力，先调用 tool_search 加载 deferred 工具。"
    "upsert_media_node / propose_generation 在「生成一张」类口语下应已绑定，不要用 tool_search 找 CORE。"
    "connect_nodes 已绑定，不要用 tool_search 找 CORE 写工具。"
    "有侧栏参考图要出结果图时 upsert_media_node / apply_sidebar_attachments / propose_generation"
    "应已绑定，不要用 tool_search 找 CORE。\n"
    "7. 若已提供【侧栏参考图解析】，不得声称只能看到文件名或画布节点标题。"
    "@I1/@I2 是侧栏芯片 key，不是画布节点 id。禁止问「I1 对应画布哪张图」；禁止把芯片映射到"
    "已有画布节点（除非用户明确要求改该节点）。侧栏图≥3 且未 @、或只有旧图且未 @：先问用哪几张"
    "或请 @I1，不要对闲聊新建节点。\n"
    "8. import_workflow / instantiate_workflow_template 已在服务端对 addedNodeIds "
    "默认顺连线；成功后不要为同一批 id 再调 arrange_nodes_along_edges"
    "（除非用户明确要求再整理）。"
    "connect_nodes 成功后，必须对当轮连线的 source/target 调用 arrange_nodes_along_edges；"
    "node_ids 只用这些工具返回的 addedNodeIds 或当轮连线的 source/target，"
    "禁止传入整张画布的全部 id。\n"
    "9. 用户要放大/超分已有图：调用 upscale_image（默认 scale=2，走同一 UpscaleService）；"
    "成功后用返回 url 调用 upsert_media_node，再用 connect_nodes 从源节点连到新节点。"
    "禁止用 run_* 或文生图提示词冒充放大。\n"
    "\n当前画布摘要：\n{summary}"
)

_PARSE_FAIL_NO_EMPTY_LISTING = (
    "4. 参考图未能识别。禁止 upsert_media_node / upsert_prompt_node / set_node_prompt "
    "写出空品类、空规格的上架方案框架；"
    "用文字说明失败并询问用户。"
)

_NODE_WRITE_CLARIFY = "未能更新节点，请提供节点 id（如 prompt-1）。"


def _last_composition_dump_hash(state: dict[str, Any], messages: list[Any]) -> str:
    hashed = str(state.get("composition_dump_hash") or "").strip()
    if hashed:
        return hashed
    for msg in reversed(messages or []):
        extra = getattr(msg, "additional_kwargs", None)
        if extra is None and isinstance(msg, dict):
            extra = msg.get("additional_kwargs")
        if not isinstance(extra, dict):
            continue
        hashed = str(extra.get(COMPOSITION_DUMP_HASH_KW) or "").strip()
        if hashed:
            return hashed
    return ""


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _msg_is_human(msg: Any) -> bool:
    role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
    return role in ("human", "user")

def _serialize_tool_result(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception:
        return str(result)


def _bind_plan_tools(
    llm: Any,
    tools_by_name: dict[str, Any],
    loaded: list[str],
    utterance: str,
    *,
    sidebar_image_keys: tuple[str, ...] = (),
    this_turn_new_image_keys: tuple[str, ...] = (),
    mentioned_keys: tuple[str, ...] = (),
) -> tuple[Any, frozenset[str]]:
    plan = build_tool_plan(loaded=loaded)
    narrow_writes = select_narrow_write_tools(
        utterance,
        sidebar_image_keys=sidebar_image_keys,
        this_turn_new_image_keys=this_turn_new_image_keys,
        mentioned_keys=mentioned_keys,
    )
    visible: set[str] = set()
    for name in plan.ordered_visible:
        if name in EXPLORE_WRITE_TOOLS:
            if name in narrow_writes:
                visible.add(name)
        else:
            visible.add(name)
    bound_tools = [tools_by_name[n] for n in plan.ordered_visible if n in visible and n in tools_by_name]
    extra = [tools_by_name[n] for n in sorted(visible) if n not in plan.ordered_visible and n in tools_by_name]
    return llm.bind_tools(bound_tools + extra), frozenset(visible)


def make_explore_node(*, llm: Any, nest: Any) -> Callable:
    async def explore(state: dict) -> dict:
        all_tools = build_explore_tools(nest)
        tools_by_name = {t.name: t for t in all_tools}

        loaded: list[str] = [
            n for n in (state.get("tool_plan_loaded") or []) if n in DEFERRED_TOOL_NAMES
        ]

        def on_loaded(names: list[str]) -> None:
            for name in names:
                if name in DEFERRED_TOOL_NAMES and name not in loaded:
                    loaded.append(name)

        tools_by_name[META_TOOL_NAME] = make_tool_search_tool(on_loaded=on_loaded)

        try:
            summary = await nest.get_canvas_summary()
        except Exception:
            summary = {"error": "无法拉取画布摘要"}

        messages = list(state.get("messages") or [])
        user_text = _latest_user_text(messages) or "看看画布状态"
        human_texts = [
            str(getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "") or "")
            for msg in messages
            if _msg_is_human(msg)
        ]
        slot_utterance = pick_planner_slot_utterance(human_texts) or user_text
        if hasattr(nest, "last_user_utterance"):
            nest.last_user_utterance = slot_utterance
        attachments = state.get("sidebar_attachments") or []
        if hasattr(nest, "sidebar_attachments"):
            nest.sidebar_attachments = list(attachments)
        parse = state.get("sidebar_media_parse")

        def _chip_out(
            text: str,
            canvas_commands: list[dict[str, Any]] | None = None,
            *,
            additional_kwargs: dict[str, Any] | None = None,
            extra_state: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            payload: dict[str, Any] = {
                "phase": "done",
                "skill_id": None,
                "user_decision": "none",
                "messages": [
                    AIMessage(
                        content=prefix_assistant_reply(text, parse),
                        additional_kwargs=additional_kwargs or {},
                    )
                ],
                "explore_summary": summary if isinstance(summary, dict) else None,
                "tool_plan_loaded": list(loaded),
            }
            if canvas_commands:
                payload["canvas_commands"] = canvas_commands
            if extra_state:
                payload.update(extra_state)
            return payload

        if is_planner_cancel_chip(user_text):
            return _chip_out(COMPOSITION_CANCEL_REPLY)
        if is_planner_confirm_chip(user_text):
            dump_hash = _last_composition_dump_hash(state, messages)
            if not dump_hash:
                return _chip_out(COMPOSITION_NO_PREVIEW_REPLY)
            confirm = getattr(nest, "confirm_composition", None)
            if not callable(confirm):
                return _chip_out(COMPOSITION_NO_PREVIEW_REPLY)
            try:
                result = await confirm(dump_hash)
            except AgentToolError as exc:
                return _chip_out(str(exc.error.get("message") or COMPOSITION_NO_PREVIEW_REPLY))
            except Exception as exc:
                err = from_exception("confirm_composition", exc)
                return _chip_out(err["message"])
            cmds = extract_canvas_commands(result if isinstance(result, dict) else {})
            extra: dict[str, Any] = {"composition_pending": None}
            if isinstance(result, dict):
                landed_hash = str(result.get("dumpHash") or result.get("dump_hash") or dump_hash).strip()
                if landed_hash:
                    extra["composition_dump_hash"] = landed_hash
            return _chip_out(COMPOSITION_LANDED_REPLY, cmds or None, extra_state=extra)

        if is_composition_structure_utterance(user_text) or state.get("composition_pending"):
            preview = getattr(nest, "preview_composition", None)
            if callable(preview):
                try:
                    result = await preview(user_text)
                except AgentToolError as exc:
                    msg = str(exc.error.get("message") or "")
                    extra = {}
                    if COMPOSITION_EXTRACT_INCOMPLETE in msg:
                        extra["composition_pending"] = json.dumps(
                            {"utterance": user_text},
                            ensure_ascii=False,
                        )
                    return _chip_out(msg or COMPOSITION_NO_PREVIEW_REPLY, extra_state=extra)
                except Exception as exc:
                    err = from_exception("preview_composition", exc)
                    return _chip_out(err["message"])
                user_message = ""
                dump_hash = ""
                if isinstance(result, dict):
                    user_message = str(result.get("userMessage") or result.get("user_message") or "")
                    dump_hash = str(result.get("dumpHash") or result.get("dump_hash") or "").strip()
                additional: dict[str, Any] = {"kind": COMPOSITION_KIND}
                extra = {"composition_pending": None}
                if dump_hash:
                    additional[COMPOSITION_DUMP_HASH_KW] = dump_hash
                    extra["composition_dump_hash"] = dump_hash
                return _chip_out(
                    user_message or COMPOSITION_NO_PREVIEW_REPLY,
                    additional_kwargs=additional,
                    extra_state=extra,
                )

        intent = classify_explore_intent(user_text, summary=summary if isinstance(summary, dict) else None)
        if intent in MANDATORY_INTENTS:
            record_explore_dispatch(intent, "mandatory")
            mandatory = await run_mandatory_explore(
                intent,
                user_text,
                summary=summary if isinstance(summary, dict) else {},
                tools_by_name=tools_by_name,
                event_sink=nest,
            )
            out: dict[str, Any] = {
                "phase": "done",
                "skill_id": None,
                "user_decision": "none",
                "messages": [
                    AIMessage(
                        content=prefix_assistant_reply(
                            mandatory.reply_text or "已完成操作。", parse
                        )
                    )
                ],
                "explore_summary": summary if isinstance(summary, dict) else None,
                "tool_plan_loaded": list(loaded),
            }
            if mandatory.canvas_commands:
                out["canvas_commands"] = mandatory.canvas_commands
            return out

        record_explore_dispatch(intent, "llm")
        image_keys = sidebar_image_keys_from_attachments(attachments)
        new_keys = this_turn_new_image_keys_from_parse(attachments, parse)
        mention_keys = mentioned_keys_for_sidebar_bind(
            user_text, state.get("sidebar_mentioned_keys")
        )

        def bind() -> tuple[Any, frozenset[str]]:
            return _bind_plan_tools(
                llm,
                tools_by_name,
                loaded,
                user_text,
                sidebar_image_keys=image_keys,
                this_turn_new_image_keys=new_keys,
                mentioned_keys=mention_keys,
            )

        llm_bound, visible = bind()

        system_content = _EXPLORE_SYSTEM.format(summary=_serialize_tool_result(summary))
        if parse:
            system_content = system_content + "\n\n" + format_parse_context_block(
                parse, ask_unknown=parse_block_asks_unknown(user_text)
            )
            if not parse.get("vision_used"):
                system_content = system_content + "\n" + _PARSE_FAIL_NO_EMPTY_LISTING
        if "preview_workflow_template" in visible or "match_workflow_templates" in visible:
            system_content = f"{system_content}\n{_PLANNER_SYSTEM}"
        # Prior turns only — current user utterance is seeded separately (D7).
        prior = messages[:-1] if messages and _msg_is_human(messages[-1]) else messages
        recent = compress_recent_turns(prior)

        convo: list[Any] = [SystemMessage(content=system_content)]
        if recent.strip():
            convo.append(SystemMessage(content=f"近期对话摘要：\n{recent}"))
        convo.append(HumanMessage(content=user_text))

        final_reply = ""
        canvas_commands: list[dict[str, Any]] = []
        called_tools: set[str] = set()
        write_retry_done = False
        promote_followup = ""
        preview_hitl = ""

        for _ in range(MAX_EXPLORE_TOOL_ROUNDS):
            ai = await llm_bound.ainvoke(convo)
            tool_calls = getattr(ai, "tool_calls", None) or []
            if not tool_calls:
                final_reply = str(getattr(ai, "content", "") or "").strip()
                if (
                    intent == "node_write"
                    and not called_tools.intersection(EXPLORE_WRITE_TOOLS)
                    and not write_retry_done
                ):
                    write_retry_done = True
                    llm_bound, _visible = bind()
                    convo.append(ai)
                    convo.append(
                        SystemMessage(
                            content=(
                                "必须调用写入类工具完成操作（如 set_node_prompt、"
                                "import_workflow、upload_media_to_canvas 等）。"
                            )
                        )
                    )
                    continue
                break

            convo.append(ai)
            for tc in tool_calls:
                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
                tool_call_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", "")
                await maybe_emit_tool_sse(
                    nest,
                    {
                        "type": "tool_call",
                        "data": {
                            "name": str(name),
                            "arguments": cap_tool_sse_payload(args or {}, kind="arguments"),
                        },
                    },
                )
                tool = tools_by_name.get(name)
                called_tools.add(str(name))
                if tool is None:
                    result: Any = {"error": f"unknown tool: {name}"}
                else:
                    try:
                        result = await tool.ainvoke(args or {})
                    except AgentToolError as exc:
                        err = exc.error
                        result = {
                            "error": err["message"],
                            "error_type": err["error_type"],
                            "retry_hint": err.get("retry_hint"),
                        }
                    except Exception as exc:
                        err = from_exception(str(name), exc)
                        result = {
                            "error": err["message"],
                            "error_type": err["error_type"],
                            "retry_hint": err.get("retry_hint"),
                        }
                await maybe_emit_tool_sse(
                    nest,
                    {
                        "type": "tool_result",
                        "data": {
                            "name": str(name),
                            "result": cap_tool_sse_payload(result, kind="result"),
                        },
                    },
                )
                for cmd in extract_canvas_commands(result):
                    if cmd not in canvas_commands:
                        canvas_commands.append(cmd)
                convo.append(
                    ToolMessage(
                        content=_serialize_tool_result(result),
                        tool_call_id=str(tool_call_id or name),
                    )
                )
                follow = planner_promote_followup(result) if str(name) == "promote_workflow_template" else None
                if follow:
                    promote_followup = follow
                if (
                    str(name) == "preview_workflow_template"
                    and isinstance(result, dict)
                    and not result.get("error")
                ):
                    preview_hitl = format_planner_preview_hitl(result)
                # Same-turn rebind after successful tool_search load.
                if (
                    str(name) == META_TOOL_NAME
                    and isinstance(result, dict)
                    and result.get("loaded")
                ):
                    llm_bound, _visible = bind()
        else:
            final_reply = str(getattr(convo[-1], "content", "") or "").strip()

        if intent == "node_write" and not called_tools.intersection(EXPLORE_WRITE_TOOLS):
            final_reply = _NODE_WRITE_CLARIFY

        if (
            "preview_workflow_template" in called_tools
            and "instantiate_workflow_template" not in called_tools
        ):
            if preview_hitl:
                final_reply = preview_hitl
            elif _PLANNER_CONFIRM_LINE not in (final_reply or ""):
                final_reply = f"{(final_reply or '').rstrip()}\n{_PLANNER_CONFIRM_LINE}".strip()

        if promote_followup and promote_followup not in (final_reply or ""):
            final_reply = f"{(final_reply or '').rstrip()}\n{promote_followup}".strip()

        if is_machine_payload_reply(final_reply):
            if preview_hitl and "instantiate_workflow_template" not in called_tools:
                final_reply = preview_hitl
            elif "instantiate_workflow_template" in called_tools:
                final_reply = PLANNER_INSTANTIATED_REPLY
            else:
                final_reply = "已完成操作。"

        if (
            "preview_workflow_template" in visible
            or "match_workflow_templates" in visible
            or "instantiate_workflow_template" in called_tools
        ):
            final_reply = sanitize_planner_reply(final_reply)

        if not final_reply:
            final_reply = "已查询画布信息。如需继续操作，请说明具体节点或任务。"

        additional: dict[str, Any] = {}
        preview_persist = last_successful_preview_args(convo)
        if preview_persist:
            additional[PLANNER_PREVIEW_ARGS_KW] = preview_persist

        out = {
            "phase": "done",
            "skill_id": None,
            "user_decision": "none",
            "messages": [
                AIMessage(
                    content=prefix_assistant_reply(final_reply, parse),
                    additional_kwargs=additional,
                )
            ],
            "explore_summary": summary if isinstance(summary, dict) else None,
            "tool_plan_loaded": list(loaded),
        }
        if canvas_commands:
            out["canvas_commands"] = canvas_commands
        return out

    return explore
