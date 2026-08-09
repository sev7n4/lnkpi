#!/usr/bin/env bash
# Sync AGENT_RUNTIME_SERVICE_TOKEN from production CVM into local dev .env files.
# Usage: bash deploy/sync-prod-service-token-to-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/tencent_cloud_deploy}"
SSH_USER="${SSH_USER:-root}"
SSH_HOST="${SSH_HOST:-119.29.173.89}"
REMOTE_ENV="/opt/lnkpi/.env"
NEST_ENV="$ROOT/apps/server/.env"
RUNTIME_ENV="$ROOT/services/agent-runtime/.env"
LOCAL_API_PORT="${LOCAL_API_PORT:-3001}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "ERROR: SSH key not found: $SSH_KEY" >&2
  exit 1
fi

TOKEN="$(
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SSH_USER}@${SSH_HOST}" \
    "grep -E '^AGENT_RUNTIME_SERVICE_TOKEN=' '${REMOTE_ENV}' | cut -d= -f2- | tr -d '\"'"
)"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: AGENT_RUNTIME_SERVICE_TOKEN not found on CVM (${REMOTE_ENV})" >&2
  exit 1
fi

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    if [[ "$(uname)" == Darwin ]]; then
      sed -i '' "s|^${key}=.*|${key}=\"${value}\"|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=\"${value}\"|" "$file"
    fi
  else
    printf '\n%s="%s"\n' "$key" "$value" >>"$file"
  fi
}

mkdir -p "$(dirname "$NEST_ENV")" "$(dirname "$RUNTIME_ENV")"
touch "$NEST_ENV"
upsert_env "$NEST_ENV" "AGENT_RUNTIME_SERVICE_TOKEN" "$TOKEN"
upsert_env "$NEST_ENV" "AGENT_RUNTIME_URL" "http://127.0.0.1:8000"

if [[ ! -f "$RUNTIME_ENV" ]]; then
  cp "$ROOT/services/agent-runtime/.env.example" "$RUNTIME_ENV"
fi
if [[ "$(uname)" == Darwin ]]; then
  sed -i '' "s|^LNKPI_NEST_BASE_URL=.*|LNKPI_NEST_BASE_URL=http://127.0.0.1:${LOCAL_API_PORT}/api|" "$RUNTIME_ENV"
  sed -i '' "s|^LNKPI_NEST_SERVICE_TOKEN=.*|LNKPI_NEST_SERVICE_TOKEN=${TOKEN}|" "$RUNTIME_ENV"
else
  sed -i "s|^LNKPI_NEST_BASE_URL=.*|LNKPI_NEST_BASE_URL=http://127.0.0.1:${LOCAL_API_PORT}/api|" "$RUNTIME_ENV"
  sed -i "s|^LNKPI_NEST_SERVICE_TOKEN=.*|LNKPI_NEST_SERVICE_TOKEN=${TOKEN}|" "$RUNTIME_ENV"
fi

echo "Synced AGENT_RUNTIME_SERVICE_TOKEN (len=${#TOKEN}) to:"
echo "  - $NEST_ENV"
echo "  - $RUNTIME_ENV"
