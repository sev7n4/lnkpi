"""POST /v1/runs — stream LangGraph run events as NDJSON."""

from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Awaitable

import aiosqlite
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel

from app.config import settings
from app.errors import AgentToolError, error_to_sse_payload, from_exception
from app.graph.builder import build_agent_graph
from app.history_trim import trim_history
from app.metrics import record_stream_error, thread_finished, thread_started, track_node
from app.tracing import end_run_span, is_tracing_enabled, start_run_span, trace_node
from app.graph.nodes.intake import modify_intent
from app.tools.nest_client import NestCanvasClient

EmitFn = Callable[[dict[str, Any]], Awaitable[None]]


async def _init_checkpointer() -> AsyncSqliteSaver:
    """Initialize async SQLite checkpointer with proper path setup."""
    checkpoint_path = Path(settings.checkpoint_path)
    # Ensure parent directory exists
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    # Create async SQLite connection
    conn = await aiosqlite.connect(str(checkpoint_path))
    # Create AsyncSqliteSaver instance
    return AsyncSqliteSaver(conn)


_checkpointer: AsyncSqliteSaver | None = None


async def _get_checkpointer() -> AsyncSqliteSaver:
    """Lazy initialize the async checkpointer singleton."""
    global _checkpointer
    if _checkpointer is None:
        _checkpointer = await _init_checkpointer()
    return _checkpointer

# Same-thread Concurrent turns (e.g. double「确认」while orchestrate_gen runs)
# must not start a second graph — that clears await_confirm and re-plans.
THREAD_BUSY_TIP = "上一轮仍在处理中，请稍候；拆解出图通常需要一两分钟。"

# 修复 P0-2：出图过程中用户发送修改意见时，不返回生硬的 busy tip
# 而是告诉用户修改意见已收到，等出图完成后再发一次
# 区分依据：modify_intent（"改成""调整"等）vs 确认类消息（"确认""1"）
_MODIFY_DURING_GEN_TIP = (
    "出图仍在进行中，您的修改意见已收到。\n"
    "请等待出图完成（通常一两分钟）后，再发送一次同样的修改意见，"
    "我会基于最新方案进行调整。"
)

# Two-level locking: process-local asyncio.Lock (fast path) + DB-based distributed lock
# 1. Process-local lock: fast check to avoid unnecessary DB calls
# 2. DB-based lock: prevents concurrent runs across multiple instances
_thread_locks: dict[str, asyncio.Lock] = {}
_thread_locks_meta = asyncio.Lock()

# Lock renewal configuration
LOCK_TTL_SECONDS = 300  # 5 minutes default TTL
LOCK_RENEWAL_INTERVAL = 60  # Renew every 60 seconds

# Track active lock holders for renewal and release
_active_lock_holders: dict[str, tuple[str, asyncio.Task[None]]] = {}


async def _reset_orphan_local_lock(thread_id: str, nest: NestCanvasClient) -> bool:
    """In-process lock held but DB lease free → prior task crashed without finally."""
    lock = _thread_locks.get(thread_id)
    if lock is None or not lock.locked():
        return True
    probe_holder = f"orphan-probe-{uuid.uuid4().hex}"
    try:
        result = await nest.acquire_thread_lock(thread_id, probe_holder, 5)
        if not result.get("acquired"):
            return False
        await nest.release_thread_lock(thread_id, probe_holder)
    except Exception:
        return False
    async with _thread_locks_meta:
        _thread_locks[thread_id] = asyncio.Lock()
    return True


async def _try_acquire_thread(
    thread_id: str,
    nest: NestCanvasClient,
) -> tuple[bool, str | None]:
    """Acquire per-thread lock without waiting.
    
    Returns (success, holder_id). holder_id is None if lock failed.
    Uses two-level locking: process-local (fast path) + DB-based (distributed).
    """
    # Step 1: Process-local lock — recover orphaned locks when DB lease expired
    async with _thread_locks_meta:
        lock = _thread_locks.setdefault(thread_id, asyncio.Lock())
        local_locked = lock.locked()

    if local_locked:
        if not await _reset_orphan_local_lock(thread_id, nest):
            return False, None

    async with _thread_locks_meta:
        lock = _thread_locks.setdefault(thread_id, asyncio.Lock())
        if lock.locked():
            return False, None
        await lock.acquire()
    
    # Step 2: Try to acquire DB-based distributed lock
    holder_id = f"{uuid.uuid4().hex}-{thread_id}"
    try:
        result = await nest.acquire_thread_lock(thread_id, holder_id, LOCK_TTL_SECONDS)
        if not result.get("acquired"):
            # Failed to acquire DB lock - release process-local lock
            lock.release()
            return False, None
    except Exception:
        # DB lock failed - release process-local lock
        lock.release()
        raise
    
    # Step 3: Start background renewal task
    async def _renewal_loop() -> None:
        """Background task to renew the lock periodically."""
        while True:
            try:
                await asyncio.sleep(LOCK_RENEWAL_INTERVAL)
                await nest.renew_thread_lock(thread_id, holder_id, LOCK_TTL_SECONDS)
            except asyncio.CancelledError:
                break
            except Exception:
                # Renewal failed - lock might be lost, but we'll still try to release on cleanup
                break
    
    renewal_task = asyncio.create_task(_renewal_loop())
    _active_lock_holders[thread_id] = (holder_id, renewal_task)
    
    return True, holder_id


async def _release_thread(thread_id: str, holder_id: str | None, nest: NestCanvasClient) -> None:
    """Release both process-local and DB-based locks."""
    if holder_id is None:
        return
    
    # Cancel renewal task
    if thread_id in _active_lock_holders:
        _, renewal_task = _active_lock_holders.pop(thread_id)
        renewal_task.cancel()
        try:
            await renewal_task
        except asyncio.CancelledError:
            pass
    
    # Release DB lock
    try:
        await nest.release_thread_lock(thread_id, holder_id)
    except Exception:
        pass  # Best effort - lock will expire anyway
    
    # Release process-local lock
    lock = _thread_locks.get(thread_id)
    if lock is not None and lock.locked():
        lock.release()


class RunRequest(BaseModel):
    session_id: str
    user_id: str
    message: str
    thread_id: str | None = None
    # W5修复：添加user_decision字段，支持用户确认/修改/换方向
    user_decision: str | None = None  # "confirm" | "revise" | "replan"
    skill_id: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None


class NestEventProxy:
    """Wrap NestCanvasClient and emit canvas_action / node_status for Nest SSE."""

    def __init__(self, inner: Any, emit: EmitFn) -> None:
        self._inner = inner
        self._emit = emit

    async def close(self) -> None:
        close = getattr(self._inner, "close", None)
        if close is not None:
            await close()

    async def _forward_actions(self, result: dict[str, Any]) -> dict[str, Any]:
        for action in result.get("actions") or []:
            await self._emit({"type": "canvas_action", "data": action})
        return result

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
        return await self._forward_actions(await self._inner.upsert_prompt_node(**kwargs))

    async def get_node(self, node_id: str) -> dict[str, Any]:
        return await self._inner.get_node(node_id)

    async def get_canvas_summary(self) -> dict[str, Any]:
        return await self._inner.get_canvas_summary()

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._forward_actions(await self._inner.add_nodes_batch(items))

    async def connect_nodes(self, edges: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._forward_actions(await self._inner.connect_nodes(edges))

    async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
        return await self._forward_actions(
            await self._inner.set_node_prompt(node_id, prompt)
        )

    async def set_node_content(self, node_id: str, content: str) -> dict[str, Any]:
        return await self._forward_actions(
            await self._inner.set_node_content(node_id, content)
        )

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return await self._forward_actions(
            await self._inner.attach_refs(node_id, ref_order)
        )

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        await self._emit(
            {"type": "node_status", "data": {"nodeId": node_id, "status": "generating"}}
        )
        result = await self._forward_actions(
            await self._inner.run_image_generation(node_id)
        )
        status = str(result.get("status") or "completed")
        payload: dict[str, Any] = {"nodeId": node_id, "status": status}
        if result.get("url"):
            payload["url"] = result["url"]
        if result.get("generationRecordId"):
            payload["generationRecordId"] = result["generationRecordId"]
        await self._emit({"type": "node_status", "data": payload})
        return result

    async def start_image_generation(self, node_id: str) -> dict[str, Any]:
        await self._emit(
            {"type": "node_status", "data": {"nodeId": node_id, "status": "generating"}}
        )
        return await self._forward_actions(await self._inner.start_image_generation(node_id))

    async def wait_image_generation(
        self, node_id: str, generation_record_id: str
    ) -> dict[str, Any]:
        result = await self._forward_actions(
            await self._inner.wait_image_generation(node_id, generation_record_id)
        )
        status = str(result.get("status") or "completed")
        payload: dict[str, Any] = {"nodeId": node_id, "status": status}
        if result.get("url"):
            payload["url"] = result["url"]
        if result.get("generationRecordId"):
            payload["generationRecordId"] = result["generationRecordId"]
        await self._emit({"type": "node_status", "data": payload})
        return result

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        await self._emit(
            {"type": "node_status", "data": {"nodeId": node_id, "status": "generating"}}
        )
        inner = getattr(self._inner, "run_video_generation", None)
        if inner is None:
            raise RuntimeError("video_not_supported")
        result = await self._forward_actions(await inner(node_id))
        status = str(result.get("status") or "completed")
        payload: dict[str, Any] = {"nodeId": node_id, "status": status}
        if result.get("url"):
            payload["url"] = result["url"]
        await self._emit({"type": "node_status", "data": payload})
        return result

    async def emit_text(self, text: str) -> None:
        """Push a user-visible progress line mid-node (orchestrate_gen)."""
        if text:
            await self._emit({"type": "text_delta", "data": {"text": str(text)}})

    async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
        await self._emit({"type": "task_list", "data": {"items": items}})

    async def emit_task_update(self, **payload: Any) -> None:
        await self._emit({"type": "task_update", "data": payload})

    async def emit_task_summary(self, **payload: Any) -> None:
        await self._emit({"type": "task_summary", "data": payload})

    async def get_generation_status(self, node_id: str) -> dict[str, Any]:
        return await self._inner.get_generation_status(node_id)


def resolve_skills_dir(skills_dir: str | Path | None = None) -> Path:
    raw = Path(skills_dir if skills_dir is not None else settings.skills_dir)
    if raw.is_absolute():
        return raw
    return Path(__file__).resolve().parents[1] / raw


def default_llm() -> Any:
    return ChatOpenAI(
        api_key=settings.openai_api_key or "sk-placeholder",
        base_url=settings.openai_base_url,
        model=settings.openai_chat_model or "gpt-4o",
        temperature=0.4,
    )


def resolve_llm(req: RunRequest) -> Any:
    if req.llm_model and req.llm_api_key:
        kwargs: dict[str, Any] = {
            "api_key": req.llm_api_key,
            "model": req.llm_model,
            "temperature": 0.4,
        }
        if req.llm_base_url:
            kwargs["base_url"] = req.llm_base_url
        return ChatOpenAI(**kwargs)
    if req.llm_model:
        return ChatOpenAI(
            api_key=settings.openai_api_key or "sk-placeholder",
            base_url=settings.openai_base_url,
            model=req.llm_model,
            temperature=0.4,
        )
    return default_llm()


def default_nest(*, session_id: str, user_id: str) -> NestCanvasClient:
    return NestCanvasClient(
        base_url=settings.nest_base_url,
        token=settings.nest_service_token,
        session_id=session_id,
        user_id=user_id,
    )


def _trim_history(messages: list[Any], window: int) -> list[Any]:
    """W17: Trim history with window, token budget, and anchor preservation."""
    budget = settings.history_token_budget or None
    return trim_history(
        messages,
        window=window,
        token_budget=budget,
        preserve_anchors=True,
    )


def _message_role(msg: Any) -> str | None:
    role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
    if role in ("human", "user"):
        return "user"
    if role in ("ai", "assistant"):
        return "assistant"
    return None


def _message_content(msg: Any) -> str:
    content = getattr(msg, "content", None) or (
        msg.get("content") if isinstance(msg, dict) else ""
    )
    return str(content or "")


async def _save_user_message(nest: NestCanvasClient, content: str) -> None:
    """W2: Persist user message before graph run (crash-safe)."""
    text = content.strip()
    if not text:
        return
    try:
        await nest.save_agent_message(role="user", content=text)
    except Exception:  # noqa: BLE001 — history save failure should not crash the run
        pass


async def _save_new_assistant_messages(
    nest: NestCanvasClient,
    messages: list[Any],
    *,
    after_index: int,
) -> None:
    """W2: Persist only assistant messages produced after ``after_index``."""
    try:
        for msg in messages[after_index:]:
            if _message_role(msg) != "assistant":
                continue
            content = _message_content(msg).strip()
            if content:
                await nest.save_agent_message(role="assistant", content=content)
    except Exception:  # noqa: BLE001 — history save failure should not crash the run
        pass


async def get_thread_state(
    thread_id: str,
    *,
    checkpointer: Any | None = None,
) -> dict[str, Any]:
    """W12: Read LangGraph checkpoint phase for reconnect UI."""

    class _NoOpNest:
        async def close(self) -> None:
            pass

    cp = checkpointer if checkpointer is not None else await _get_checkpointer()
    graph = build_agent_graph(
        nest=_NoOpNest(),
        llm=default_llm(),
        skills_dir=resolve_skills_dir(),
        checkpointer=cp,
    )
    config = {"configurable": {"thread_id": thread_id}}
    snap = await graph.aget_state(config)
    vals = getattr(snap, "values", None) or {}
    next_nodes = [str(n) for n in (getattr(snap, "next", None) or [])]
    phase = vals.get("phase")
    phase_str = str(phase) if phase is not None else None
    return {
        "threadId": thread_id,
        "phase": phase_str,
        "nextNodes": next_nodes,
        "interrupted": bool(next_nodes),
        "finished": phase_str == "done" or (not next_nodes and bool(vals)),
    }


async def _load_history(nest: NestCanvasClient) -> list[Any]:
    """Load conversation history from AgentMessage table (C1 decision)."""
    try:
        messages = await nest.get_agent_messages()
        result: list[Any] = []
        for msg in messages:
            role = str(msg.get("role") or "")
            content = str(msg.get("content") or "")
            if role == "user":
                result.append(HumanMessage(content=content))
            elif role == "assistant" or role == "ai":
                result.append(AIMessage(content=content))
        # W17: Trim history to configured window size
        return _trim_history(result, settings.history_window)
    except Exception:  # noqa: BLE001 — fallback to empty history on load failure
        return []


async def stream_run_events(
    req: RunRequest,
    *,
    nest: Any | None = None,
    llm: Any | None = None,
    skills_dir: str | Path | None = None,
    checkpointer: Any | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield AgentStreamEvent-shaped dicts for one user turn."""
    thread_id = req.thread_id or req.session_id

    owns_nest = nest is None
    inner_nest = nest if nest is not None else default_nest(
        session_id=req.session_id,
        user_id=req.user_id,
    )
    lock_nest = inner_nest
    acquired, holder_id = await _try_acquire_thread(thread_id, lock_nest)
    
    if not acquired:
        # 修复 P0-2：出图过程中用户发送修改意见 → 友好提示（而非生硬 busy tip）
        # plan 阶段并发（"确认""1"）→ 保持原 busy tip 防止冲突
        tip = _MODIFY_DURING_GEN_TIP if modify_intent(req.message) else THREAD_BUSY_TIP
        yield {"type": "text_delta", "data": {"text": tip}}
        yield {"type": "done", "data": {}}
        if owns_nest:
            await lock_nest.close()
        return

    run_span = start_run_span(
        thread_id=thread_id,
        session_id=req.session_id,
        user_id=req.user_id,
    )

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    proxy = NestEventProxy(inner_nest, emit)
    graph_llm = llm if llm is not None else resolve_llm(req)
    thread_started()

    active_checkpointer = checkpointer if checkpointer is not None else await _get_checkpointer()
    graph = build_agent_graph(
        nest=proxy,
        llm=graph_llm,
        skills_dir=resolve_skills_dir(skills_dir),
        checkpointer=active_checkpointer,
    )
    config = {"configurable": {"thread_id": thread_id}}

    # W2: save user message before graph (both fresh turn and interrupt resume)
    await _save_user_message(inner_nest, req.message)

    # W5: 检查是否从 interrupt_before 恢复
    snap = await graph.aget_state(config)
    next_nodes = getattr(snap, "next", None) or []
    assistant_save_after = 0

    if next_nodes:
        # W5 修复（关键）：interrupt_before 的正确恢复方式是
        #   aupdate_state({"messages": [HumanMessage(msg)], ...})  # 不传 as_node
        #   然后 astream(None, config)
        # 这样被中断的节点（如 await_confirm）会重新执行，并从 messages 读到用户新消息，
        # 正确分类 confirm/revise/none。
        #
        # ❌ 不能用 Command(resume=...)：它只适用于节点内 interrupt() 动态中断；
        #   对 interrupt_before，它不会把新消息注入 state，导致 await_confirm 读到旧 brief，
        #   分类为 none，流程无法推进（重试后还会重跑 intake 误入 chat 分支）。
        # ❌ 不能用 as_node=next_node：那会把 update 当作该节点的输出，从而跳过该节点
        #   （await_confirm 的分类逻辑不执行），user_decision 不会被正确设置。
        update_payload: dict[str, Any] = {"messages": [HumanMessage(content=req.message)]}
        if req.user_decision:
            update_payload["user_decision"] = req.user_decision
        vals = getattr(snap, "values", None) or {}
        assistant_save_after = len(vals.get("messages") or []) + 1
        await graph.aupdate_state(config, update_payload)
        input_state = None  # type: ignore[assignment]
    else:
        # 新对话或已完成：加载历史并创建 input_state (C1 decision)
        history = await _load_history(inner_nest)
        assistant_save_after = len(history) + 1
        input_messages = history + [HumanMessage(content=req.message)]
        input_state = {
            "messages": input_messages,
            "session_id": req.session_id,
            "user_id": req.user_id,
            "thread_id": thread_id,
        }

    async def run_graph() -> None:
        try:
            async for update in graph.astream(input_state, config, stream_mode="updates"):
                if not isinstance(update, dict):
                    continue
                for node_name, delta in update.items():
                    with track_node(str(node_name)), trace_node(str(node_name)):
                        if not isinstance(delta, dict):
                            continue
                        force_choice = delta.get("force_choice")
                        if force_choice:
                            await emit(
                                {
                                    "type": "force_choice",
                                    "data": {"kind": str(force_choice)},
                                }
                            )
                        messages = delta.get("messages")
                        if not messages:
                            continue
                        seq = messages if isinstance(messages, list) else [messages]
                        for msg in seq:
                            content = getattr(msg, "content", None)
                            if content is None and isinstance(msg, dict):
                                content = msg.get("content")
                            if not content:
                                continue
                            # Prefer AI replies for text_delta
                            msg_type = getattr(msg, "type", None) or (
                                msg.get("role") if isinstance(msg, dict) else None
                            )
                            if msg_type in ("ai", "assistant") or isinstance(msg, AIMessage):
                                await emit({"type": "text_delta", "data": {"text": str(content)}})
            await emit({"type": "done", "data": {}})
        except AgentToolError as exc:
            record_stream_error(exc.error["error_type"])
            await emit({"type": "error", "data": error_to_sse_payload(exc.error)})
        except Exception as exc:  # noqa: BLE001 — surface to Nest SSE
            err = from_exception("stream_run", exc)
            record_stream_error(err["error_type"])
            await emit({"type": "error", "data": error_to_sse_payload(err)})
        finally:
            # W2: save only new assistant messages from this turn (user saved at entry)
            try:
                snap = await graph.aget_state(config)
                vals = getattr(snap, "values", None) or {}
                final_messages = list(vals.get("messages") or [])
                if final_messages:
                    await _save_new_assistant_messages(
                        inner_nest,
                        final_messages,
                        after_index=assistant_save_after,
                    )
            except Exception:  # noqa: BLE001 — history save failure should not crash
                pass
            await queue.put(None)
            if owns_nest:
                await proxy.close()

    task = asyncio.create_task(run_graph())

    async def heartbeat() -> None:
        """W12: SSE ping every 15s so frontend can detect stale connections."""
        while not task.done():
            await asyncio.sleep(15)
            if task.done():
                break
            await emit({"type": "ping", "data": {"ts": int(time.time() * 1000)}})

    hb_task = asyncio.create_task(heartbeat())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        end_run_span(run_span)
        thread_finished()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass
        await _release_thread(thread_id, holder_id, lock_nest)
        if owns_nest:
            await lock_nest.close()
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        else:
            await task
