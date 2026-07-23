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

## Test

```bash
uv run pytest tests/ -v
# or: pytest tests/ -v
```

## Environment variables

Settings use the `LNKPI_` prefix (see `app/config.py`). Documented for upcoming tasks:

| Variable | Default | Description |
|----------|---------|-------------|
| `LNKPI_SKILLS_DIR` | `skills` | Directory containing agent skill definitions |
| `LNKPI_NEST_BASE_URL` | `http://127.0.0.1:3000` | Base URL for the Nest API |
| `LNKPI_NEST_SERVICE_TOKEN` | `dev-token` | Service token for Nest (also `NEST_SERVICE_TOKEN` alias noted in config) |
| `LNKPI_OPENAI_API_KEY` | `""` | OpenAI API key |
| `LNKPI_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `LNKPI_IMAGE_GEN_CONCURRENCY` | `3` | Max concurrent image generation jobs |
| `LNKPI_IMAGE_GEN_TIMEOUT_SEC` | `180` | Image generation timeout in seconds |
