#!/usr/bin/env bash
# Enable W23 observability on CVM: reuse pintuotuo Tempo + rebuild agent-runtime.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/lnkpi}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"
COMPOSE_FILE="${DEPLOY_DIR}/deploy/docker-compose.prod.yml"
TEMPO_CONTAINER="${TEMPO_CONTAINER:-pintuotuo-tempo}"
TEMPO_NETWORK="${TEMPO_NETWORK:-lnkpi-net}"
OTEL_ENDPOINT="${OTEL_ENDPOINT:-http://pintuotuo-tempo:4318/v1/traces}"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

upsert_env() {
  local key="$1" val="$2" tmp
  tmp=$(mktemp)
  touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE"; then
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

log "=== Connect Tempo to ${TEMPO_NETWORK} ==="
docker network connect "$TEMPO_NETWORK" "$TEMPO_CONTAINER" 2>/dev/null || log "tempo already on network (ok)"

log "=== Write OTEL env ==="
upsert_env LNKPI_OTEL_EXPORTER_OTLP_ENDPOINT "$OTEL_ENDPOINT"
upsert_env LNKPI_LANGSMITH_OTEL_ENABLED "false"
upsert_env LNKPI_OTEL_SERVICE_NAME "lnkpi-agent-runtime"

log "=== Rebuild agent-runtime (latest tracing code) ==="
export LNKPI_AGENT_RUNTIME_IMAGE="${LNKPI_AGENT_RUNTIME_IMAGE:-lnkpi-agent-runtime:local}"
export DOCKER_BUILDKIT=1
docker compose -f "$COMPOSE_FILE" build --progress=plain agent-runtime

log "=== Recreate agent-runtime with new env ==="
export LNKPI_API_IMAGE="${LNKPI_API_IMAGE:-$(docker inspect lnkpi-api --format '{{.Config.Image}}' 2>/dev/null || echo lnkpi-api:local)}"
docker compose -f "$COMPOSE_FILE" up -d --no-deps --no-build --force-recreate agent-runtime

log "=== Wait runtime health ==="
for i in $(seq 1 12); do
  if docker exec lnkpi-agent-runtime curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    log "runtime healthy"
    break
  fi
  sleep 5
done

log "=== Verify tracing module ==="
docker exec lnkpi-agent-runtime python -c "
from app.tracing import is_tracing_enabled, uses_langsmith_otel
from app.config import settings
print('endpoint=', settings.otel_exporter_otlp_endpoint)
print('tracing=', is_tracing_enabled())
print('langsmith_otel=', uses_langsmith_otel())
"

log "=== Done. Run agent flow then query Tempo: ==="
echo "  curl -s 'http://127.0.0.1:3200/api/search?limit=5&tags=resource.service.name%3Dlnkpi-agent-runtime'"
