#!/usr/bin/env bash
# 在本机运行：上传 deploy 文件并初始化腾讯云 /opt/lnkpi
# 用法: bash deploy/init-remote.sh
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/tencent_cloud_deploy}"
SSH_USER="${SSH_USER:-root}"
SSH_HOST="${SSH_HOST:-119.29.173.89}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> 目标: ${SSH_USER}@${SSH_HOST}:/opt/lnkpi"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${SSH_HOST}" "mkdir -p /tmp/lnkpi-deploy"

scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  "$REPO_ROOT/deploy/docker-compose.prod.yml" \
  "$REPO_ROOT/deploy/docker-compose.prod.images.yml" \
  "$REPO_ROOT/deploy/deploy-remote.sh" \
  "$REPO_ROOT/deploy/deploy-remote-build.sh" \
  "$REPO_ROOT/deploy/bootstrap-server.sh" \
  "${SSH_USER}@${SSH_HOST}:/tmp/lnkpi-deploy/"

scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
  "$REPO_ROOT/deploy/.env.production.example" \
  "${SSH_USER}@${SSH_HOST}:/tmp/lnkpi-deploy/.env.production.example"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${SSH_HOST}" bash <<'REMOTE'
set -euo pipefail
mkdir -p /opt/lnkpi/deploy
cp /tmp/lnkpi-deploy/* /opt/lnkpi/deploy/
cp /tmp/lnkpi-deploy/.env.production.example /opt/lnkpi/deploy/
chmod +x /opt/lnkpi/deploy/deploy-remote.sh
chmod +x /opt/lnkpi/deploy/deploy-remote-build.sh
if [ ! -f /opt/lnkpi/.env ]; then
  cp /opt/lnkpi/deploy/.env.production.example /opt/lnkpi/.env
  SECRET=$(openssl rand -hex 24)
  sed -i "s/请替换为随机长字符串/${SECRET}/" /opt/lnkpi/.env
  echo "已生成 /opt/lnkpi/.env"
else
  echo "保留已有 /opt/lnkpi/.env"
fi
ss -tlnp | grep ':5100' || echo "端口 5100 空闲"
ls -la /opt/lnkpi/deploy/
echo "初始化完成"
REMOTE

echo ""
echo "✅ 服务器 /opt/lnkpi 已就绪"
echo "下一步: 配置 GitHub Secrets 后 push main 触发 deploy（CVM 本地 build），或手动:"
echo "  cd /opt/lnkpi && IMAGE_TAG=<sha> bash deploy/deploy-remote-build.sh"
