#!/usr/bin/env bash
# 在服务器 /opt/lnkpi 执行：从 TCR 拉取镜像并启动
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE_TAG="${IMAGE_TAG:?set IMAGE_TAG to git commit sha}"
TCR_REGISTRY="${TCR_REGISTRY:?set TCR_REGISTRY e.g. ccr.ccs.tencentyun.com}"
TCR_NAMESPACE="${TCR_NAMESPACE:?set TCR_NAMESPACE e.g. lnkpi}"
IMAGE_REPO="${TCR_REGISTRY}/${TCR_NAMESPACE}/lnkpi-api"

COMPOSE="docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.prod.images.yml"

echo "=== Disk before pull (${IMAGE_REPO}) ==="
df -h / /var/lib/docker 2>/dev/null || df -h /

set +euo
docker image prune -f >/dev/null 2>&1
docker images "$IMAGE_REPO" --format '{{.Tag}}' 2>/dev/null | while read -r tag; do
  [[ -z "$tag" || "$tag" == "<none>" ]] && continue
  [[ "$tag" == "$IMAGE_TAG" || "$tag" == "latest" ]] && continue
  docker rmi "${IMAGE_REPO}:${tag}" 2>/dev/null || true
done
set -euo pipefail

for i in 1 2 3 4 5; do
  if TCR_REGISTRY="$TCR_REGISTRY" TCR_NAMESPACE="$TCR_NAMESPACE" IMAGE_TAG="$IMAGE_TAG" $COMPOSE pull; then
    break
  fi
  [[ "$i" -eq 5 ]] && { echo "pull failed"; exit 1; }
  sleep $((i * 20))
done

TCR_REGISTRY="$TCR_REGISTRY" TCR_NAMESPACE="$TCR_NAMESPACE" IMAGE_TAG="$IMAGE_TAG" $COMPOSE up -d --no-build

echo "等待健康检查..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:5100/api/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:5100/api/health" | head -c 200
    echo ""
    echo "部署完成 (IMAGE_TAG=$IMAGE_TAG, registry=${IMAGE_REPO})"
    exit 0
  fi
  echo "health attempt $i failed, retry..."
  sleep $((i <= 3 ? 5 : 10))
done
echo "health check failed after retries"
docker logs lnkpi-api --tail 30 2>&1 || true
exit 1
