from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.errors import (
    AgentToolError,
    circuit_open_error,
    from_http_status,
    from_nest_message,
    tool_timeout_error,
)
from app.metrics import record_tool_call
from app.tools.circuit_breaker import CircuitBreaker
from app.tracing import trace_tool

DEFAULT_HTTP_TIMEOUT_SEC = 30.0
IMAGE_GEN_TIMEOUT_BUFFER_SEC = 30.0

_LOCK_PATHS = frozenset({
    "/agent/internal/acquire-thread-lock",
    "/agent/internal/renew-thread-lock",
    "/agent/internal/release-thread-lock",
})

_LONG_GEN_PATHS = frozenset({
    "/agent/internal/run-image-generation",
    "/agent/internal/wait-image-generation",
    "/agent/internal/run-video-generation",
})


def _tool_name_from_path(path: str) -> str:
    segment = path.rstrip("/").rsplit("/", 1)[-1]
    parts = segment.split("-")
    if not parts:
        return segment
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _default_timeout_sec(path: str) -> float:
    if path in _LOCK_PATHS:
        return float(settings.thread_lock_timeout_sec)
    if path in _LONG_GEN_PATHS:
        return float(settings.image_gen_timeout_sec) + IMAGE_GEN_TIMEOUT_BUFFER_SEC
    return float(settings.canvas_tool_timeout_sec)


class NestCanvasClient:
    """HTTP client for Nest internal canvas tool endpoints."""

    def __init__(
        self,
        base_url: str,
        token: str,
        session_id: str,
        user_id: str,
        *,
        http_client: httpx.AsyncClient | None = None,
        circuit_breaker: CircuitBreaker | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._session_id = session_id
        self._user_id = user_id
        self._http = http_client
        self._owns_http = http_client is None
        self._breaker = circuit_breaker or CircuitBreaker(
            failure_threshold=settings.circuit_breaker_failure_threshold,
            cooldown_sec=settings.circuit_breaker_cooldown_sec,
        )

    @property
    def _headers(self) -> dict[str, str]:
        return {"x-lnkpi-service-token": self._token}

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=httpx.Timeout(DEFAULT_HTTP_TIMEOUT_SEC),
            )
        return self._http

    async def close(self) -> None:
        if self._owns_http and self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _post(
        self,
        path: str,
        body: dict[str, Any],
        *,
        timeout: float | httpx.Timeout | None = None,
        tool_name: str | None = None,
    ) -> dict[str, Any]:
        name = tool_name or _tool_name_from_path(path)
        if self._breaker.is_open(name):
            record_tool_call(name, success=False)
            raise AgentToolError(circuit_open_error(name))

        effective_timeout = timeout if timeout is not None else _default_timeout_sec(path)
        http = await self._get_http()
        try:
            with trace_tool(name, path=path):
                response = await http.post(
                    path,
                    json=body,
                    headers=self._headers,
                    timeout=effective_timeout,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            self._breaker.record_failure(name)
            record_tool_call(name, success=False)
            raise AgentToolError(tool_timeout_error(name)) from exc
        except httpx.HTTPStatusError as exc:
            err = from_http_status(name, exc.response.status_code)
            if err["error_type"] == "downstream_unavailable":
                self._breaker.record_failure(name)
            record_tool_call(name, success=False)
            raise AgentToolError(err) from exc

        payload = response.json()
        if payload.get("code", 0) != 0:
            err = from_nest_message(name, str(payload.get("message", "Nest request failed")), code=payload.get("code"))
            if err["error_type"] in ("downstream_unavailable", "tool_timeout"):
                self._breaker.record_failure(name)
            record_tool_call(name, success=False)
            raise AgentToolError(err)

        self._breaker.record_success(name)
        record_tool_call(name, success=True)
        return payload["data"]

    async def upsert_prompt_node(
        self,
        *,
        prompt: str,
        content: str,
        node_id: str | None = None,
        stage: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "userId": self._user_id,
            "prompt": prompt,
            "content": content,
        }
        if node_id is not None:
            body["nodeId"] = node_id
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/upsert-prompt-node", body)

    async def get_node(self, node_id: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/get-node",
            {"sessionId": self._session_id, "nodeId": node_id},
        )

    async def get_canvas_summary(self) -> dict[str, Any]:
        """Phase C: lightweight canvas node list for manifest reconciliation."""
        return await self._post(
            "/agent/internal/get-canvas-summary",
            {"sessionId": self._session_id},
        )

    async def add_nodes_batch(
        self, items: list[dict[str, Any]], *, stage: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "userId": self._user_id,
            "items": items,
        }
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/add-nodes-batch", body)

    async def connect_nodes(
        self, edges: list[dict[str, Any]], *, stage: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"sessionId": self._session_id, "edges": edges}
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/connect-nodes", body)

    async def remove_nodes(self, node_ids: list[str], *, stage: bool = False) -> dict[str, Any]:
        """W31: Remove nodes and their associated edges."""
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "nodeIds": node_ids,
        }
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/remove-nodes", body)

    async def remove_edges(self, edge_ids: list[str], *, stage: bool = False) -> dict[str, Any]:
        """W32: Remove edges from canvas."""
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "edgeIds": edge_ids,
        }
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/remove-edges", body)

    async def set_node_prompt(
        self, node_id: str, prompt: str, *, title: str | None = None, stage: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "nodeId": node_id,
            "prompt": prompt,
        }
        # P0 修复：modify 模式 upsert 节点时同时更新标题（Nest 端可选字段）
        if title:
            body["title"] = title
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/set-node-prompt", body)

    async def set_node_content(
        self, node_id: str, content: str, *, stage: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "userId": self._user_id,
            "nodeId": node_id,
            "content": content,
        }
        if stage:
            body["stage"] = True
        return await self._post("/agent/internal/set-node-content", body)

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/attach-refs",
            {"sessionId": self._session_id, "nodeId": node_id, "refOrder": ref_order},
        )

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        # Nest polls Studio up to image_gen_timeout_sec; httpx must outlive that.
        timeout_sec = float(settings.image_gen_timeout_sec) + IMAGE_GEN_TIMEOUT_BUFFER_SEC
        return await self._post(
            "/agent/internal/run-image-generation",
            {"sessionId": self._session_id, "userId": self._user_id, "nodeId": node_id},
            timeout=timeout_sec,
        )

    async def start_image_generation(self, node_id: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/start-image-generation",
            {"sessionId": self._session_id, "userId": self._user_id, "nodeId": node_id},
        )

    async def wait_image_generation(self, node_id: str, generation_record_id: str) -> dict[str, Any]:
        timeout_sec = float(settings.image_gen_timeout_sec) + IMAGE_GEN_TIMEOUT_BUFFER_SEC
        return await self._post(
            "/agent/internal/wait-image-generation",
            {
                "sessionId": self._session_id,
                "userId": self._user_id,
                "nodeId": node_id,
                "generationRecordId": generation_record_id,
            },
            timeout=timeout_sec,
        )

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        timeout_sec = float(settings.image_gen_timeout_sec) + IMAGE_GEN_TIMEOUT_BUFFER_SEC
        return await self._post(
            "/agent/internal/run-video-generation",
            {"sessionId": self._session_id, "userId": self._user_id, "nodeId": node_id},
            timeout=timeout_sec,
        )

    async def get_generation_status(self, node_id: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/get-generation-status",
            {"sessionId": self._session_id, "nodeId": node_id},
        )

    async def get_agent_messages(self) -> list[dict[str, Any]]:
        """Load conversation history from AgentMessage table (C1 decision)."""
        return await self._post(
            "/agent/internal/get-agent-messages",
            {"sessionId": self._session_id},
        )

    async def save_agent_message(self, role: str, content: str, tool_calls: str | None = None) -> dict[str, Any]:
        """Save a message to AgentMessage table (C1 decision)."""
        return await self._post(
            "/agent/internal/save-agent-message",
            {
                "sessionId": self._session_id,
                "userId": self._user_id,
                "role": role,
                "content": content,
                "toolCalls": tool_calls,
            },
        )

    async def acquire_thread_lock(self, thread_id: str, holder_id: str, ttl_seconds: float = 300) -> dict[str, Any]:
        """Acquire a distributed lock for a thread."""
        return await self._post(
            "/agent/internal/acquire-thread-lock",
            {
                "threadId": thread_id,
                "holderId": holder_id,
                "ttlSeconds": ttl_seconds,
            },
        )

    async def renew_thread_lock(self, thread_id: str, holder_id: str, ttl_seconds: float = 300) -> dict[str, Any]:
        """Renew an existing thread lock."""
        return await self._post(
            "/agent/internal/renew-thread-lock",
            {
                "threadId": thread_id,
                "holderId": holder_id,
                "ttlSeconds": ttl_seconds,
            },
        )

    async def release_thread_lock(self, thread_id: str, holder_id: str) -> dict[str, Any]:
        """Release a thread lock."""
        return await self._post(
            "/agent/internal/release-thread-lock",
            {
                "threadId": thread_id,
                "holderId": holder_id,
            },
        )

    async def get_gen_progress(self, thread_id: str) -> dict[str, Any] | None:
        """Get generation progress from GenProgress table (W15)."""
        result = await self._post(
            "/agent/internal/get-gen-progress",
            {"threadId": thread_id},
        )
        return result if result else None

    async def save_gen_progress(
        self, thread_id: str, session_id: str, lines: str, summary: str | None = None
    ) -> dict[str, Any]:
        """Save generation progress to GenProgress table (W15)."""
        return await self._post(
            "/agent/internal/save-gen-progress",
            {
                "threadId": thread_id,
                "sessionId": session_id,
                "lines": lines,
                "summary": summary,
            },
        )

    async def get_context_snapshot(
        self, thread_id: str, stage: str | None = None
    ) -> dict[str, Any] | None:
        """Get latest context snapshot for thread (W18)."""
        payload: dict[str, Any] = {"threadId": thread_id}
        if stage:
            payload["stage"] = stage
        result = await self._post("/agent/internal/get-context-snapshot", payload)
        return result if result else None

    async def save_context_snapshot(
        self,
        thread_id: str,
        session_id: str,
        stage: str,
        brief: str | None = None,
        plan_summary: str | None = None,
        manifest_json: str | None = None,
        message_count: int | None = None,
    ) -> dict[str, Any]:
        """Save context snapshot (W18)."""
        return await self._post(
            "/agent/internal/save-context-snapshot",
            {
                "threadId": thread_id,
                "sessionId": session_id,
                "stage": stage,
                "brief": brief,
                "planSummary": plan_summary,
                "manifestJson": manifest_json,
                "messageCount": message_count,
            },
        )

    async def stage_canvas_actions(self, actions: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/stage-canvas-actions",
            {"sessionId": self._session_id, "actions": actions},
        )

    async def commit_stage(self) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/commit-stage",
            {"sessionId": self._session_id},
        )

    async def rollback_stage(self) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/rollback-stage",
            {"sessionId": self._session_id},
        )
