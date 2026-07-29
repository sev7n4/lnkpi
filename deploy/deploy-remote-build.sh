#!/usr/bin/env bash
# 在服务器 /opt/lnkpi 执行：本地 docker build + compose up（无 TCR 跨境 push）
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
IMAGE_TAG="${IMAGE_TAG:?set IMAGE_TAG to git commit sha}"
STATUS_FILE="${STATUS_FILE:-/tmp/lnkpi-deploy-${IMAGE_TAG}.status}"
LOG_FILE="${LOG_FILE:-/tmp/lnkpi-deploy-${IMAGE_TAG}.log}"
export LNKPI_API_IMAGE="lnkpi-api:${IMAGE_TAG}"
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

log() {
  echo "[$(date -u +%H:%M:%S)] $*" >>"$LOG_FILE"
}

set_status() {
  echo "$1" > "$STATUS_FILE"
  log "status=$1"
}

on_fail() {
  set_status failed
  docker logs lnkpi-api --tail 40 2>&1 || true
  exit 1
}

set_status running

log "=== Disk before build (${LNKPI_API_IMAGE}) ==="
df -h / /var/lib/docker 2>/dev/null || df -h /

log "=== Prune unused Docker data ==="
docker image prune -f >/dev/null 2>&1 || true
# 保留一周内的构建缓存以复用 pnpm/编译层，磁盘充足时不要激进清理
docker builder prune -f --filter 'until=168h' >/dev/null 2>&1 || true
docker images lnkpi-api --format '{{.Tag}}' 2>/dev/null | while read -r tag; do
  [[ -z "$tag" || "$tag" == "<none>" ]] && continue
  [[ "$tag" == "$IMAGE_TAG" || "$tag" == "latest" ]] && continue
  docker rmi "lnkpi-api:${tag}" 2>/dev/null || true
done

log "=== Building ${LNKPI_API_IMAGE} on CVM ==="
if ! $COMPOSE build --progress=plain api >>"$LOG_FILE" 2>&1; then
  on_fail
fi
docker tag "${LNKPI_API_IMAGE}" lnkpi-api:latest

log "=== Starting container ==="
# 只起 api：agent-runtime 需按 AGENT_RUNTIME_PRODUCTION.md 手动 build/up，避免缺镜像时 up 阻塞
$COMPOSE up -d --no-build --force-recreate --remove-orphans api

log "=== Port binding ==="
ss -tlnp | grep ':5100' || true
docker port lnkpi-api 2>/dev/null || true

if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -qi active; then
  log "=== UFW active, allowing TCP 5100 ==="
  sudo ufw allow 5100/tcp comment 'lnkpi-api' || true
  sudo ufw status numbered | grep 5100 || true
fi

log "=== Waiting for health ==="
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS "http://127.0.0.1:5100/api/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:5100/api/health" | head -c 200
    echo ""
    set_status success
    log "部署完成 (IMAGE=${LNKPI_API_IMAGE})"
    exit 0
  fi
  log "health attempt $i failed, retry..."
  sleep $((i <= 5 ? 5 : 10))
done

log "health check failed after retries"
on_fail
