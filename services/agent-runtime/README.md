# lnkpi Agent Runtime

FastAPI service that hosts the LangGraph agent runtime for lnkpi.

**生产部署（Compose / systemd）+ 环境变量清单 + 画布人工验收：** 见仓库根目录 [`deploy/AGENT_RUNTIME_PRODUCTION.md`](../../deploy/AGENT_RUNTIME_PRODUCTION.md)。

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip
- For full stack: Node/pnpm monorepo (`@lnkpi/server`, web app)

## Setup

```bash
cd services/agent-runtime
uv sync --extra dev
# or: pip install -e ".[dev]"
cp .env.example .env   # edit tokens / URLs as needed
```

## Dual-process run (Nest + Runtime)

Run **two terminals** — Nest owns canvas truth; Runtime runs LangGraph and calls Nest internal tools.

**Terminal 1 — Nest API**

```bash
# apps/server/.env (see apps/server/.env.example)
# AGENT_RUNTIME_URL=http://127.0.0.1:8000
# AGENT_RUNTIME_SERVICE_TOKEN=dev-token   # must match Runtime token below

pnpm --filter @lnkpi/server dev
# Nest listens on http://127.0.0.1:3000  →  API base http://127.0.0.1:3000/api
```

**Terminal 2 — Agent Runtime**

```bash
cd services/agent-runtime
# .env: LNKPI_NEST_BASE_URL=http://127.0.0.1:3000/api
#       LNKPI_NEST_SERVICE_TOKEN=dev-token   # same as AGENT_RUNTIME_SERVICE_TOKEN
#       # optional: LNKPI_RUNTIME_AUTH_TOKEN=dev-token  # Nest→Runtime; defaults to NEST token

uv run uvicorn app.main:app --reload --port 8000
```

**Verify wiring**

| Check | Command / action |
|-------|------------------|
| Runtime up | `curl -s http://127.0.0.1:8000/health` → `{"ok":true,"service":"agent-runtime"}` |
| Nest up | `curl -s http://127.0.0.1:3000/api/health` (or your Nest health route) |
| Token match | `LNKPI_NEST_SERVICE_TOKEN` (Runtime→Nest) = `AGENT_RUNTIME_SERVICE_TOKEN` (Nest) |
| Runs auth | Nest `POST /v1/runs` sends `x-lnkpi-service-token`; Runtime checks `LNKPI_RUNTIME_AUTH_TOKEN` or falls back to `LNKPI_NEST_SERVICE_TOKEN`. `GET /health` stays open. |
| Fallback | Unset `AGENT_RUNTIME_URL` → Nest uses `@lnkpi/agent` `CanvasAgent` |

**Web UI smoke**

1. Start web app (`pnpm --filter @lnkpi/web dev` or your usual command).
2. Open a canvas session and chat: **「帮我设计一套卫生洁具的营销方案」**
3. Expect SSE text + a **prompt** plan node on canvas (via Nest internal tools).
4. Reply **「确认，按这个拆并出图」** → image skeletons, edges, refs, then Studio generation.
5. If Runtime is down or `AGENT_RUNTIME_URL` unset, Nest falls back to legacy `CanvasAgent`.

## Run (Runtime only)

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Health: `GET http://127.0.0.1:8000/health` → `{ "ok": true, "service": "agent-runtime" }`

Stream a turn (NDJSON): `POST http://127.0.0.1:8000/v1/runs`  
Requires header `x-lnkpi-service-token` matching Runtime auth token (see env table).

```bash
curl -N -X POST http://127.0.0.1:8000/v1/runs \
  -H "Content-Type: application/json" \
  -H "Accept: application/x-ndjson" \
  -H "x-lnkpi-service-token: dev-token" \
  -d '{"session_id":"...","user_id":"...","message":"帮我设计一套卫生洁具的营销方案","thread_id":"..."}'
```

Events: `text_delta` | `canvas_action` | `node_status` | `done` | `error`.

## E2E smoke script (spec §12)

CI-friendly **dry-run** (no OpenAI / Studio / live Nest):

```bash
cd services/agent-runtime
uv run python scripts/e2e_marketing_smoke.py
# exit 0 = automated §12 checks passed
```

Optional **live** probe (stack must be running):

```bash
uv run python scripts/e2e_marketing_smoke.py --mode live \
  --runtime-url http://127.0.0.1:8000 \
  --nest-url http://127.0.0.1:3000/api
```

## Test

```bash
uv run pytest tests/ -v
```

## Environment variables

### Runtime (`LNKPI_*`)

Settings use the `LNKPI_` prefix (see `app/config.py` and `.env.example`).

| Variable | Default | Description |
|----------|---------|-------------|
| `LNKPI_SKILLS_DIR` | `skills` | Directory containing agent skill packages |
| `LNKPI_NEST_BASE_URL` | `http://127.0.0.1:3000/api` | Nest API base **including** `/api` |
| `LNKPI_NEST_SERVICE_TOKEN` | `dev-token` | Service token for Runtime → Nest internal canvas tools |
| `LNKPI_RUNTIME_AUTH_TOKEN` | `""` | Nest → Runtime auth for `POST /v1/runs`; **empty** → use `LNKPI_NEST_SERVICE_TOKEN` |
| `LNKPI_OPENAI_API_KEY` | `""` | OpenAI API key (plan LLM; empty uses placeholder in dev) |
| `LNKPI_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `LNKPI_IMAGE_GEN_CONCURRENCY` | `3` | Max concurrent image generation jobs |
| `LNKPI_IMAGE_GEN_TIMEOUT_SEC` | `180` | Image generation poll timeout (seconds) |

### Nest (`AGENT_RUNTIME_*`)

Configure in `apps/server/.env` (see `apps/server/.env.example`).

| Variable | Example | Description |
|----------|---------|-------------|
| `AGENT_RUNTIME_URL` | `http://127.0.0.1:8000` | Runtime base URL; **empty** → always `CanvasAgent` fallback |
| `AGENT_RUNTIME_SERVICE_TOKEN` | `dev-token` | Shared secret: validates Runtime→Nest internal tools **and** Nest→Runtime `POST /v1/runs` header |

## Acceptance checklist (spec §12)

Reference: `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md` §12.

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | 洁具营销话术加载 `enterprise-marketing-campaign` | Dry-run: `e2e_marketing_smoke.py`; live: intake selects skill after sanitary-ware prompt |
| 2 | 画布出现 prompt 方案节点 | Dry-run: `upsert_prompt_node`; live: canvas shows prompt node with plan Markdown |
| 3 | 确认后 image 骨架 + 边 + prompt + refs | Dry-run: `add_nodes_batch` / `connect_nodes` / `set_node_prompt` / `attach_refs`; live: white_bg + hero_main nodes wired from plan |
| 4 | ≥2 张图（白底 + 主图）`url` 回写 | Dry-run: mock only; **live**: confirm nodes show image URLs after Studio completes |
| 5 | 部分失败有列表 | Dry-run: orchestrate_gen partial-fail check; live: break one upstream gen, see failed list in chat/state |
| 6 | State 无全量 canvas / Base64 | Dry-run + code review: `AgentRuntimeState` has no `nodes`/`edges`; live: inspect Runtime logs/checkpoints |
| 7 | `revise` 更新同一 `plan_node_id` | Dry-run: revise check; live: say「改成更偏天猫详情页」— same plan node updates, no split until re-confirm |
| 8 | Skill 包符合 agentskills.io | `skills/enterprise-marketing-campaign/SKILL.md` + `assets/`; loader skips `_` dirs and dirs without `SKILL.md` |

**Suggested manual live pass**

1. Dual-process run (above) + web app.
2. Chat sanitary-ware marketing prompt → review plan node.
3. **确认** → watch skeleton + generation; confirm ≥2 image URLs on canvas.
4. New turn **revise** → same plan node updates; confirm again to re-split.
5. (Optional) Induce one gen failure → failed list in assistant reply.
