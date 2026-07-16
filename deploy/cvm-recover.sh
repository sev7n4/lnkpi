#!/usr/bin/env bash
# CVM 恢复：终止卡住的 deploy 构建、释放 Docker 资源、尝试拉起已有 API 容器
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/lnkpi}"
API_PORT="${API_PORT:-5100}"

log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

log "=== CVM recover start ==="
log "uptime: $(uptime 2>/dev/null || true)"
df -h / /var/lib/docker 2>/dev/null || df -h /
free -h 2>/dev/null || true

log "=== Stop stale deploy/build processes ==="
pkill -f "deploy-remote-build.sh" 2>/dev/null || true
pkill -f "launch-cvm-build.sh" 2>/dev/null || true
pkill -f "docker compose.*build" 2>/dev/null || true
sleep 2

log "=== Docker cleanup (prune builder + dangling) ==="
docker builder prune -f --filter 'until=2h' 2>/dev/null || true
docker image prune -f 2>/dev/null || true

log "=== Restart lnkpi-api with existing image if present ==="
if [[ -d "${DEPLOY_DIR}/deploy" ]]; then
  cd "${DEPLOY_DIR}"
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  if docker images lnkpi-api --format '{{.Tag}}' 2>/dev/null | grep -q .; then
    if docker images lnkpi-api:latest --format '{{.Tag}}' 2>/dev/null | grep -q latest; then
      export LNKPI_API_IMAGE="lnkpi-api:latest"
    else
      LATEST_TAG=$(docker images lnkpi-api --format '{{.Tag}}' | grep -v '<none>' | head -1)
      export LNKPI_API_IMAGE="lnkpi-api:${LATEST_TAG}"
    fi
    log "using image ${LNKPI_API_IMAGE}"
    docker compose -f deploy/docker-compose.prod.yml up -d --no-build --force-recreate --remove-orphans 2>/dev/null || true
  fi
fi

log "=== Health check ==="
for i in 1 2 3 4 5; do
  if curl -fsS --connect-timeout 3 --max-time 5 "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${API_PORT}/api/health" | head -c 200
    echo ""
    log "recover: API healthy"
    exit 0
  fi
  log "health attempt $i failed"
  sleep 3
done

docker ps -a --filter name=lnkpi-api 2>/dev/null || true
ss -tlnp | grep ":${API_PORT}" || true
log "recover: API not healthy yet (may need full redeploy)"
exit 0
