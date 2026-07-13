#!/usr/bin/env bash
# 在服务器 /opt/lnkpi 执行：本地 docker build + compose up（无 TCR 跨境 push）
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE_TAG="${IMAGE_TAG:?set IMAGE_TAG to git commit sha}"
export LNKPI_API_IMAGE="lnkpi-api:${IMAGE_TAG}"
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

echo "=== Disk before build (${LNKPI_API_IMAGE}) ==="
df -h / /var/lib/docker 2>/dev/null || df -h /

set +euo
docker image prune -f >/dev/null 2>&1
docker images lnkpi-api --format '{{.Tag}}' 2>/dev/null | while read -r tag; do
  [[ -z "$tag" || "$tag" == "<none>" ]] && continue
  [[ "$tag" == "$IMAGE_TAG" || "$tag" == "latest" ]] && continue
  docker rmi "lnkpi-api:${tag}" 2>/dev/null || true
done
set -euo pipefail

echo "=== Building ${LNKPI_API_IMAGE} on CVM ==="
$COMPOSE build api
docker tag "${LNKPI_API_IMAGE}" lnkpi-api:latest

$COMPOSE up -d --no-build

echo "等待健康检查..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:5100/api/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:5100/api/health" | head -c 200
    echo ""
    echo "部署完成 (IMAGE=${LNKPI_API_IMAGE})"
    exit 0
  fi
  echo "health attempt $i failed, retry..."
  sleep $((i <= 3 ? 5 : 10))
done
echo "health check failed after retries"
docker logs lnkpi-api --tail 30 2>&1 || true
exit 1
