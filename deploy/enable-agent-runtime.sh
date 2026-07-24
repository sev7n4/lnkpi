#!/usr/bin/env bash
# 在 CVM /opt/lnkpi 按 AGENT_RUNTIME_PRODUCTION.md 方案 A 接入 Runtime（Compose）
# - 写入/补齐互信 token 与内网 URL（不打印密钥）
# - 构建并启动 lnkpi-agent-runtime
# - recreate api 以加载 AGENT_RUNTIME_URL
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/lnkpi}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"
COMPOSE_FILE="${DEPLOY_DIR}/deploy/docker-compose.prod.yml"
COMPOSE="docker compose -f ${COMPOSE_FILE}"

log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

get_env() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || { echo ""; return; }
  # shellcheck disable=SC1090
  set -a
  # Prefer grep parse to avoid sourcing secrets into this shell's export noise
  local line
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -1 || true)
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  echo "${line#*=}" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

upsert_env() {
  local key="$1"
  local val="$2"
  local tmp
  tmp=$(mktemp)
  touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Replace existing assignment; keep other lines intact
    awk -v k="$key" -v v="$val" '
      BEGIN { done=0 }
      index($0, k "=") == 1 && !done { print k "=" v; done=1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    printf '%s=%s\n' "$key" "$val" >>"$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

cd "$DEPLOY_DIR"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "ERROR: missing ${COMPOSE_FILE}"
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: missing ${ENV_FILE} — create from deploy/.env.production.example first"
  exit 1
fi

log "=== Ensure Agent Runtime env (Compose) ==="

TOKEN="$(get_env AGENT_RUNTIME_SERVICE_TOKEN)"
NEST_TOKEN="$(get_env LNKPI_NEST_SERVICE_TOKEN)"
if [[ -z "$TOKEN" || "$TOKEN" == "请换成"* || "$TOKEN" == "changeme"* ]]; then
  TOKEN="$(openssl rand -hex 32)"
  log "generated AGENT_RUNTIME_SERVICE_TOKEN (len=${#TOKEN})"
else
  log "reuse existing AGENT_RUNTIME_SERVICE_TOKEN (len=${#TOKEN})"
fi
if [[ -z "$NEST_TOKEN" || "$NEST_TOKEN" != "$TOKEN" ]]; then
  NEST_TOKEN="$TOKEN"
  log "align LNKPI_NEST_SERVICE_TOKEN with AGENT_RUNTIME_SERVICE_TOKEN"
fi

upsert_env AGENT_RUNTIME_SERVICE_TOKEN "$TOKEN"
upsert_env LNKPI_NEST_SERVICE_TOKEN "$NEST_TOKEN"
upsert_env AGENT_RUNTIME_URL "http://lnkpi-agent-runtime:8000"
upsert_env LNKPI_NEST_BASE_URL "http://lnkpi-api:3001/api"

# Planning LLM: reuse Nest OPENAI_* when Runtime keys empty
OPENAI_KEY="$(get_env OPENAI_API_KEY)"
OPENAI_BASE="$(get_env OPENAI_BASE_URL)"
RT_KEY="$(get_env LNKPI_OPENAI_API_KEY)"
RT_BASE="$(get_env LNKPI_OPENAI_BASE_URL)"
if [[ -z "$RT_KEY" && -n "$OPENAI_KEY" ]]; then
  upsert_env LNKPI_OPENAI_API_KEY "$OPENAI_KEY"
  log "copied OPENAI_API_KEY -> LNKPI_OPENAI_API_KEY"
elif [[ -z "$RT_KEY" ]]; then
  log "WARN: LNKPI_OPENAI_API_KEY empty (and no OPENAI_API_KEY) — plan LLM may placeholder/fail"
fi
if [[ -z "$RT_BASE" || "$RT_BASE" == "https://api.openai.com/v1" ]]; then
  if [[ -n "$OPENAI_BASE" ]]; then
    upsert_env LNKPI_OPENAI_BASE_URL "$OPENAI_BASE"
    log "copied OPENAI_BASE_URL -> LNKPI_OPENAI_BASE_URL"
  elif [[ -z "$RT_BASE" ]]; then
    upsert_env LNKPI_OPENAI_BASE_URL "https://api.openai.com/v1"
  fi
fi

OPENAI_MODEL="$(get_env OPENAI_CHAT_MODEL)"
RT_MODEL="$(get_env LNKPI_OPENAI_CHAT_MODEL)"
if [[ -z "$RT_MODEL" && -n "$OPENAI_MODEL" ]]; then
  upsert_env LNKPI_OPENAI_CHAT_MODEL "$OPENAI_MODEL"
  log "copied OPENAI_CHAT_MODEL -> LNKPI_OPENAI_CHAT_MODEL"
elif [[ -z "$RT_MODEL" ]]; then
  log "WARN: LNKPI_OPENAI_CHAT_MODEL empty — Runtime defaults to gpt-4o"
fi

# Optional tunables if missing
[[ -n "$(get_env LNKPI_IMAGE_GEN_CONCURRENCY)" ]] || upsert_env LNKPI_IMAGE_GEN_CONCURRENCY "3"
[[ -n "$(get_env LNKPI_IMAGE_GEN_TIMEOUT_SEC)" ]] || upsert_env LNKPI_IMAGE_GEN_TIMEOUT_SEC "180"

# Keep current api image tag on recreate
if docker inspect lnkpi-api --format '{{.Config.Image}}' >/dev/null 2>&1; then
  export LNKPI_API_IMAGE
  LNKPI_API_IMAGE="$(docker inspect lnkpi-api --format '{{.Config.Image}}')"
  log "api image: ${LNKPI_API_IMAGE}"
else
  export LNKPI_API_IMAGE="${LNKPI_API_IMAGE:-lnkpi-api:latest}"
  log "api container missing; using ${LNKPI_API_IMAGE}"
fi
export LNKPI_AGENT_RUNTIME_IMAGE="${LNKPI_AGENT_RUNTIME_IMAGE:-lnkpi-agent-runtime:local}"
export DOCKER_BUILDKIT=1

log "=== Build agent-runtime ==="
$COMPOSE build --progress=plain agent-runtime

log "=== Up api + agent-runtime (force-recreate) ==="
$COMPOSE up -d --no-build --force-recreate --remove-orphans api agent-runtime

log "=== Wait Runtime health (docker exec) ==="
ok=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if docker exec lnkpi-agent-runtime curl -fsS http://127.0.0.1:8000/health >/tmp/lnkpi-rt-health.json 2>/dev/null; then
    head -c 200 /tmp/lnkpi-rt-health.json
    echo ""
    ok=1
    break
  fi
  log "runtime health attempt $i failed"
  sleep 5
done
if [[ "$ok" != "1" ]]; then
  log "ERROR: agent-runtime unhealthy"
  docker ps -a --filter name=lnkpi-agent-runtime || true
  docker logs lnkpi-agent-runtime --tail 80 2>&1 || true
  exit 1
fi

log "=== Wait Nest health ==="
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --connect-timeout 3 --max-time 5 http://127.0.0.1:5100/api/health >/tmp/lnkpi-api-health.json 2>/dev/null; then
    head -c 200 /tmp/lnkpi-api-health.json
    echo ""
    ok=1
    break
  fi
  log "api health attempt $i failed"
  sleep 3
done
if [[ "$ok" != "1" ]]; then
  log "ERROR: api unhealthy after recreate"
  docker logs lnkpi-api --tail 80 2>&1 || true
  exit 1
fi

log "=== Token gate check (expect Invalid service token, not 'not configured') ==="
MSG=$(curl -sS -X POST http://127.0.0.1:5100/api/agent/internal/get-canvas-summary \
  -H 'Content-Type: application/json' -d '{"sessionId":"x"}' || true)
echo "$MSG" | head -c 300
echo ""
if echo "$MSG" | grep -q 'not configured'; then
  log "ERROR: Nest still missing AGENT_RUNTIME_SERVICE_TOKEN after recreate"
  exit 1
fi
if ! echo "$MSG" | grep -qi 'Invalid service token\|Unauthorized'; then
  log "WARN: unexpected internal response (continuing)"
fi

# Confirm no public 8000 binding on host (best-effort)
if ss -lntp 2>/dev/null | grep -E ':8000\b' | grep -v '127.0.0.1' >/dev/null 2>&1; then
  log "WARN: something listens on non-localhost :8000 — review publish ports"
  ss -lntp | grep 8000 || true
else
  log "host :8000 not published publicly (ok)"
fi

log "Agent Runtime enabled (Compose). Nest should prefer Runtime when /health ok."
exit 0
