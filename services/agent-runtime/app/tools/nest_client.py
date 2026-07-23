from __future__ import annotations

from typing import Any

import httpx


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
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._session_id = session_id
        self._user_id = user_id
        self._http = http_client
        self._owns_http = http_client is None

    @property
    def _headers(self) -> dict[str, str]:
        return {"x-lnkpi-service-token": self._token}

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=httpx.Timeout(30.0),
            )
        return self._http

    async def close(self) -> None:
        if self._owns_http and self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        http = await self._get_http()
        response = await http.post(path, json=body, headers=self._headers)
        response.raise_for_status()
        payload = response.json()
        if payload.get("code", 0) != 0:
            message = payload.get("message", "Nest request failed")
            raise RuntimeError(message)
        return payload["data"]

    async def upsert_prompt_node(
        self,
        *,
        prompt: str,
        content: str,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "sessionId": self._session_id,
            "userId": self._user_id,
            "prompt": prompt,
            "content": content,
        }
        if node_id is not None:
            body["nodeId"] = node_id
        return await self._post("/agent/internal/upsert-prompt-node", body)

    async def get_node(self, node_id: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/get-node",
            {"sessionId": self._session_id, "nodeId": node_id},
        )

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/add-nodes-batch",
            {"sessionId": self._session_id, "userId": self._user_id, "items": items},
        )

    async def connect_nodes(self, edges: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/connect-nodes",
            {"sessionId": self._session_id, "edges": edges},
        )

    async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/set-node-prompt",
            {"sessionId": self._session_id, "nodeId": node_id, "prompt": prompt},
        )

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/attach-refs",
            {"sessionId": self._session_id, "nodeId": node_id, "refOrder": ref_order},
        )

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/run-image-generation",
            {"sessionId": self._session_id, "userId": self._user_id, "nodeId": node_id},
        )

    async def get_generation_status(self, node_id: str) -> dict[str, Any]:
        return await self._post(
            "/agent/internal/get-generation-status",
            {"sessionId": self._session_id, "nodeId": node_id},
        )
