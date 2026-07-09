#!/usr/bin/env bash
set -euo pipefail

TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","code":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "=== Canvas List ==="
curl -s http://localhost:3001/api/agent/canvas/list \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo -e "\n=== Create Canvas ==="
SESSION=$(curl -s -X POST http://localhost:3001/api/agent/canvas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"API 测试画布"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "session=$SESSION"

echo -e "\n=== Create Shot ==="
SHOT=$(curl -s -X POST http://localhost:3001/api/agent/canvas/shot/create \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"title\":\"测试分镜\",\"prompt\":\"赛博朋克城市\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "shot=$SHOT"

echo -e "\n=== Generate Image ==="
curl -s -X POST http://localhost:3001/api/agent/canvas/material/generate-image \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"shotId\":\"$SHOT\",\"prompt\":\"赛博朋克城市夜景\"}" | python3 -m json.tool

sleep 3

echo -e "\n=== Status Batch ==="
curl -s "http://localhost:3001/api/agent/canvas/shot/status/batch?ids=$SHOT" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
