"""POST /v1/runs — stream LangGraph run events as NDJSON."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Awaitable

from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from app.config import settings
from app.graph.builder import build_agent_graph
from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node
from app.tools.nest_client import NestCanvasClient

EmitFn = Callable[[dict[str, Any]], Awaitable[None]]

_checkpointer = MemorySaver()

# Same-thread concurrent turns (e.g. double「确认」while orchestrate_gen runs)
# must not start a second graph — that clears await_confirm and re-plans.
THREAD_BUSY_TIP = "上一轮仍在处理中，请稍候；拆解出图通常需要一两分钟。"

_thread_locks: dict[str, asyncio.Lock] = {}
_thread_locks_meta = asyncio.Lock()


async def _try_acquire_thread(thread_id: str) -> bool:
    """Acquire per-thread lock without waiting. False if another run holds it."""
    async with _thread_locks_meta:
        lock = _thread_locks.setdefault(thread_id, asyncio.Lock())
        if lock.locked():
            return False
        await lock.acquire()
        return True


def _release_thread(thread_id: str) -> None:
    lock = _thread_locks.get(thread_id)
    if lock is not None and lock.locked():
        lock.release()


async def _run_orchestrate_background(
    *,
    session_id: str,
    user_id: str,
    split_manifest: list[Any],
    gen_completed: list[Any] | None = None,
    gen_failed: list[Any] | None = None,
) -> None:
    """Image/video topo gen after draft turn ends — must not hold the thread lock."""

    async def _noop_emit(_event: dict[str, Any]) -> None:
        return None

    inner = default_nest(session_id=session_id, user_id=user_id)
    proxy = NestEventProxy(inner, _noop_emit)
    try:
        node = make_orchestrate_gen_node(nest=proxy)
        await node(
            {
                "split_manifest": split_manifest,
                "gen_completed": list(gen_completed or []),
                "gen_failed": list(gen_failed or []),
            }
        )
    except Exception:  # noqa: BLE001 — background; canvas/records still reflect partial progress
        pass
    finally:
        await proxy.close()


class RunRequest(BaseModel):
    session_id: str
    user_id: str
    message: str
    thread_id: str | None = None


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


def default_nest(*, session_id: str, user_id: str) -> NestCanvasClient:
    return NestCanvasClient(
        base_url=settings.nest_base_url,
        token=settings.nest_service_token,
        session_id=session_id,
        user_id=user_id,
    )


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
    if not await _try_acquire_thread(thread_id):
        yield {"type": "text_delta", "data": {"text": THREAD_BUSY_TIP}}
        yield {"type": "done", "data": {}}
        return

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    owns_nest = nest is None
    inner_nest = nest if nest is not None else default_nest(
        session_id=req.session_id,
        user_id=req.user_id,
    )
    proxy = NestEventProxy(inner_nest, emit)
    graph_llm = llm if llm is not None else default_llm()
    graph = build_agent_graph(
        nest=proxy,
        llm=graph_llm,
        skills_dir=resolve_skills_dir(skills_dir),
        checkpointer=checkpointer if checkpointer is not None else _checkpointer,
    )
    config = {"configurable": {"thread_id": thread_id}}
    input_state = {
        "messages": [HumanMessage(content=req.message)],
        "session_id": req.session_id,
        "user_id": req.user_id,
        "thread_id": thread_id,
    }

    bg_payload: dict[str, Any] | None = None

    async def run_graph() -> None:
        nonlocal bg_payload
        saw_pending_orchestrate = False
        try:
            async for update in graph.astream(input_state, config, stream_mode="updates"):
                if not isinstance(update, dict):
                    continue
                for _node, delta in update.items():
                    if not isinstance(delta, dict):
                        continue
                    if delta.get("pending_orchestrate"):
                        saw_pending_orchestrate = True
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
            if saw_pending_orchestrate:
                try:
                    snap = await graph.aget_state(config)
                    vals = getattr(snap, "values", None) or {}
                    manifest = list(vals.get("split_manifest") or [])
                    if manifest:
                        bg_payload = {
                            "session_id": req.session_id,
                            "user_id": req.user_id,
                            "split_manifest": manifest,
                            "gen_completed": list(vals.get("gen_completed") or []),
                            "gen_failed": list(vals.get("gen_failed") or []),
                        }
                except Exception:  # noqa: BLE001
                    bg_payload = None
            await emit({"type": "done", "data": {}})
        except Exception as exc:  # noqa: BLE001 — surface to Nest SSE
            await emit({"type": "error", "data": {"message": str(exc)}})
        finally:
            await queue.put(None)
            if owns_nest:
                await proxy.close()

    task = asyncio.create_task(run_graph())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        _release_thread(thread_id)
        if bg_payload is not None:
            asyncio.create_task(_run_orchestrate_background(**bg_payload))
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        else:
            await task
