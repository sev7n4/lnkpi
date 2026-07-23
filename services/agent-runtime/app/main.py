from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from app.runs import RunRequest, stream_run_events

app = FastAPI(title="lnkpi-agent-runtime")

# Test / DI hooks (cleared between tests)
_run_overrides: dict[str, Any] = {}


def configure_run_overrides(**kwargs: Any) -> None:
    """Override nest/llm/skills_dir/checkpointer for tests."""
    _run_overrides.clear()
    _run_overrides.update(kwargs)


def clear_run_overrides() -> None:
    _run_overrides.clear()


@app.get("/health")
def health():
    return {"ok": True, "service": "agent-runtime"}


@app.post("/v1/runs")
async def create_run(body: RunRequest):
    async def ndjson():
        async for event in stream_run_events(body, **_run_overrides):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(ndjson(), media_type="application/x-ndjson")
