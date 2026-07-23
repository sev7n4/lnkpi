# lnkpi Agent Runtime

FastAPI service that hosts the LangGraph agent runtime for lnkpi.

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

## Setup

```bash
cd services/agent-runtime
uv sync --extra dev
# or: pip install -e ".[dev]"
```

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
# or: uvicorn app.main:app --reload --port 8000
```

Health check: `GET http://127.0.0.1:8000/health` → `{ "ok": true, "service": "agent-runtime" }`

Stream a turn (NDJSON): `POST http://127.0.0.1:8000/v1/runs`

```json
{
  "session_id": "...",
  "user_id": "...",
  "message": "帮我设计一套卫生洁具的营销方案",
  "thread_id": "..."
}
```

Events: `text_delta` | `canvas_action` | `node_status` | `done` | `error` (plus optional tool events).

## Test

```bash
uv run pytest tests/ -v
# or: pytest tests/ -v
```

## Manual smoke (Nest + Runtime)

1. Align tokens: Nest `AGENT_RUNTIME_SERVICE_TOKEN` = Runtime `LNKPI_NEST_SERVICE_TOKEN`.
2. Nest `.env`: `AGENT_RUNTIME_URL=http://127.0.0.1:8000`, start API (`pnpm --filter @lnkpi/server dev`).
3. Runtime: copy `.env.example` → `.env`, set `LNKPI_NEST_BASE_URL=http://127.0.0.1:3000/api` (or your Nest `/api` base), then `uv run uvicorn app.main:app --reload --port 8000`.
4. Open the web app, chat:「帮我设计一套卫生洁具的营销方案」→ expect SSE text + prompt 方案节点 on canvas (via Nest internal tools).
5. If Runtime is down or `AGENT_RUNTIME_URL` unset, Nest falls back to `@lnkpi/agent` `CanvasAgent`.

## Environment variables

Settings use the `LNKPI_` prefix (see `app/config.py`). See also `.env.example`.

| Variable | Default | Description |
|----------|---------|-------------|
| `LNKPI_SKILLS_DIR` | `skills` | Directory containing agent skill definitions |
| `LNKPI_NEST_BASE_URL` | `http://127.0.0.1:3000/api` | Nest API base **including** `/api` |
| `LNKPI_NEST_SERVICE_TOKEN` | `dev-token` | Must match Nest `AGENT_RUNTIME_SERVICE_TOKEN` |
| `LNKPI_OPENAI_API_KEY` | `""` | OpenAI API key |
| `LNKPI_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `LNKPI_IMAGE_GEN_CONCURRENCY` | `3` | Max concurrent image generation jobs |
| `LNKPI_IMAGE_GEN_TIMEOUT_SEC` | `180` | Image generation timeout in seconds |

Nest side:

| Variable | Description |
|----------|-------------|
| `AGENT_RUNTIME_URL` | e.g. `http://127.0.0.1:8000`; empty → always CanvasAgent |
| `AGENT_RUNTIME_SERVICE_TOKEN` | Service token for Runtime → Nest internal tools |
