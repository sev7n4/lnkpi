#!/usr/bin/env bash
# 在 CVM 上安装/更新 nginx，发布前端静态文件到 /opt/lnkpi/web/dist
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/lnkpi}"
WEB_PORT="${WEB_PORT:-8888}"
API_PORT="${API_PORT:-5100}"
NGINX_CONF_SRC="${DEPLOY_DIR}/deploy/nginx.conf"
WEB_ROOT="${DEPLOY_DIR}/web/dist"
NGINX_DEST="/etc/nginx/conf.d/lnkpi.conf"

log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

ensure_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    return 0
  fi
  log "Installing nginx..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nginx
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nginx
  else
    echo "ERROR: unsupported OS — install nginx manually"
    exit 1
  fi
}

open_firewall() {
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    log "firewalld: allow TCP ${WEB_PORT}"
    firewall-cmd --permanent --add-port="${WEB_PORT}/tcp" || true
    firewall-cmd --reload || true
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then
    log "UFW: allow TCP ${WEB_PORT}"
    ufw allow "${WEB_PORT}/tcp" comment 'lnkpi-web' || true
  fi
}

main() {
  log "=== Deploy lnkpi web (port ${WEB_PORT}) ==="

  if [[ ! -d "${WEB_ROOT}" ]] || [[ ! -f "${WEB_ROOT}/index.html" ]]; then
    echo "ERROR: missing ${WEB_ROOT}/index.html — upload dist first"
    exit 1
  fi

  if [[ ! -f "${NGINX_CONF_SRC}" ]]; then
    echo "ERROR: missing ${NGINX_CONF_SRC}"
    exit 1
  fi

  ensure_nginx
  mkdir -p "${DEPLOY_DIR}/web"
  chmod 755 "${DEPLOY_DIR}/web" "${WEB_ROOT}"

  # 替换 nginx 模板中的端口/API 端口占位
  sed \
    -e "s/__WEB_PORT__/${WEB_PORT}/g" \
    -e "s/__API_PORT__/${API_PORT}/g" \
    "${NGINX_CONF_SRC}" > /tmp/lnkpi-nginx.conf

  if [[ -f "${NGINX_DEST}" ]] && cmp -s /tmp/lnkpi-nginx.conf "${NGINX_DEST}"; then
    log "nginx config unchanged"
  else
    cp /tmp/lnkpi-nginx.conf "${NGINX_DEST}"
    log "nginx config updated → ${NGINX_DEST}"
  fi

  # 禁用 default_server 冲突（Ubuntu 默认站点）
  if [[ -f /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
    log "disabled /etc/nginx/sites-enabled/default"
  fi

  nginx -t
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl restart nginx

  open_firewall

  log "=== Verify ==="
  curl -fsS "http://127.0.0.1:${WEB_PORT}/" | head -c 120
  echo ""
  curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" | head -c 200
  echo ""
  log "Web deployed: http://127.0.0.1:${WEB_PORT}/ (API via /api/)"
}

main "$@"
