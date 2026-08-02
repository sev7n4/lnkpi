#!/usr/bin/env bash
# Phase A production smoke: agent-runtime health + Nest proxy + :8888 frontend entry.
# Usage:
#   BASE_URL=http://119.29.173.89:8888 bash deploy/smoke-graph-phase-a.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8888}"
API="${BASE_URL%/}/api"
PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "✅ $name"
    PASS=$((PASS + 1))
  else
    echo "❌ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Graph Phase A smoke (BASE_URL=$BASE_URL) ==="

check "Nest health" curl -fsS "${API}/health" >/dev/null

check "Frontend workflow page" curl -fsS "${BASE_URL%/}/workflow" | grep -qi 'html'

# Agent runtime reachable via Nest (requires AGENT_RUNTIME_URL configured on CVM)
RUNTIME_MSG=$(curl -sS --connect-timeout 5 --max-time 15 "${API}/agent/runtime-health" || true)
if echo "$RUNTIME_MSG" | grep -qiE '"ok"\s*:\s*true'; then
  echo "✅ Agent runtime health (via Nest)"
  PASS=$((PASS + 1))
else
  echo "❌ Agent runtime health (via Nest) — response: $(echo "$RUNTIME_MSG" | head -c 200)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Passed: $PASS  Failed: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "Hint: run deploy/enable-agent-runtime.sh on CVM if runtime health failed."
  exit 1
fi
