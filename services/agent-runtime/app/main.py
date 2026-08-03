from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response, StreamingResponse

from contextlib import asynccontextmanager

from app.config import settings
from app.metrics import metrics_payload
from app.runs import RunRequest, get_thread_state, stream_run_events
from app.tracing import setup_tracing, shutdown_tracing


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    setup_tracing()
    yield
    shutdown_tracing()


app = FastAPI(title="lnkpi-agent-runtime", lifespan=_lifespan)

# Test / DI hooks (cleared between tests)
_run_overrides: dict[str, Any] = {}


def configure_run_overrides(**kwargs: Any) -> None:
    """Override nest/llm/skills_dir/checkpointer for tests."""
    _run_overrides.clear()
    _run_overrides.update(kwargs)


def clear_run_overrides() -> None:
    _run_overrides.clear()


def _require_runtime_auth(x_lnkpi_service_token: str | None) -> None:
    expected = settings.effective_runtime_auth_token
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="Runtime auth token is not configured",
        )
    if not x_lnkpi_service_token or x_lnkpi_service_token != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing service token")


@app.get("/health")
def health():
    return {"ok": True, "service": "agent-runtime"}


@app.get("/metrics")
def metrics():
    """W24: Prometheus scrape endpoint."""
    payload, content_type = metrics_payload()
    return Response(content=payload, media_type=content_type)


@app.get("/v1/threads/{thread_id}/state")
async def thread_state(
    thread_id: str,
    x_lnkpi_service_token: str | None = Header(default=None),
):
    _require_runtime_auth(x_lnkpi_service_token)
    overrides = _run_overrides.get("checkpointer")
    data = await get_thread_state(
        thread_id,
        checkpointer=overrides,
    )
    return data


@app.get("/v1/threads/{thread_id}/timeline")
async def thread_timeline(
    thread_id: str,
    x_lnkpi_service_token: str | None = Header(default=None),
):
    """W27: Graph control-flow phase timeline from checkpoint history."""
    _require_runtime_auth(x_lnkpi_service_token)
    from app.graph.builder import build_agent_graph
    from app.runs import default_llm, resolve_skills_dir, _get_checkpointer

    class _NoOpNest:
        async def close(self) -> None:
            pass

    overrides = _run_overrides.get("checkpointer")
    cp = overrides if overrides is not None else await _get_checkpointer()
    graph = build_agent_graph(
        nest=_NoOpNest(),
        llm=default_llm(),
        skills_dir=resolve_skills_dir(),
        checkpointer=cp,
    )
    data = await get_thread_timeline(thread_id, graph=graph)
    return data


@app.post("/v1/runs")
async def create_run(
    body: RunRequest,
    x_lnkpi_service_token: str | None = Header(default=None),
):
    _require_runtime_auth(x_lnkpi_service_token)

    async def ndjson():
        async for event in stream_run_events(body, **_run_overrides):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(ndjson(), media_type="application/x-ndjson")
