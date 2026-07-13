#!/usr/bin/env bash
# 首次在腾讯云 CVM 初始化 /opt/lnkpi（与 aimarket /opt/aimarket 并列）
set -euo pipefail

DEPLOY_DIR="${1:-/opt/lnkpi}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

sudo mkdir -p "$DEPLOY_DIR/deploy"
sudo cp "$REPO_ROOT/deploy/docker-compose.prod.yml" "$DEPLOY_DIR/deploy/"
sudo cp "$REPO_ROOT/deploy/docker-compose.prod.images.yml" "$DEPLOY_DIR/deploy/"
sudo cp "$REPO_ROOT/deploy/.env.production.example" "$DEPLOY_DIR/deploy/"
sudo cp "$REPO_ROOT/deploy/deploy-remote.sh" "$DEPLOY_DIR/deploy/"
sudo chmod +x "$DEPLOY_DIR/deploy/deploy-remote.sh"

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  sudo cp "$DEPLOY_DIR/deploy/.env.production.example" "$DEPLOY_DIR/.env"
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 24)"
    sudo sed -i.bak "s/请替换为随机长字符串/${SECRET}/" "$DEPLOY_DIR/.env"
    sudo rm -f "$DEPLOY_DIR/.env.bak"
  fi
  echo "已创建 $DEPLOY_DIR/.env — 请编辑 CORS_ORIGIN / API_PUBLIC_URL"
fi

echo "初始化完成: $DEPLOY_DIR"
echo "下一步: 配置 GitHub Secrets 后 push main 触发 deploy，或手动:"
echo "  cd $DEPLOY_DIR && IMAGE_TAG=latest TCR_REGISTRY=... TCR_NAMESPACE=lnkpi bash deploy/deploy-remote.sh"
