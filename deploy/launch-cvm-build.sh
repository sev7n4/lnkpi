#!/usr/bin/env bash
# 在 CVM 上由 deploy workflow 调用：立即返回，构建在后台执行
set -euo pipefail

IMAGE_TAG="${1:?usage: launch-cvm-build.sh <git-sha>}"
DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

STATUS_FILE="/tmp/lnkpi-deploy-${IMAGE_TAG}.status"
LOG_FILE="/tmp/lnkpi-deploy-${IMAGE_TAG}.log"
PID_FILE="/tmp/lnkpi-deploy-${IMAGE_TAG}.pid"

export IMAGE_TAG STATUS_FILE LOG_FILE

rm -f "$STATUS_FILE" "$LOG_FILE" "$PID_FILE"

nohup env IMAGE_TAG="$IMAGE_TAG" STATUS_FILE="$STATUS_FILE" LOG_FILE="$LOG_FILE" \
  bash deploy/deploy-remote-build.sh </dev/null >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
disown -a 2>/dev/null || true

echo "launched pid=$(cat "$PID_FILE") log=$LOG_FILE"
