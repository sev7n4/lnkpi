#!/usr/bin/env bash
# P0 生产 API 回归：登录 → 画布 → sceneComposer → videoComposition export
# 用法: ./scripts/p0-production-e2e.sh
#       BASE_URL=https://lnkpi-web.vercel.app/api ./scripts/p0-production-e2e.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://lnkpi-web.vercel.app/api}"
PHONE="${PHONE:-13800138000}"
CODE="${CODE:-123456}"

pass=0
fail=0

ok() { echo "  ✅ $*"; pass=$((pass + 1)); }
bad() { echo "  ❌ $*"; fail=$((fail + 1)); }

echo "=== P0 production E2E ==="
echo "BASE_URL=$BASE_URL"

echo "A6 health"
if curl -fsS --max-time 15 "${BASE_URL}/health" >/tmp/p0-health.json; then
  ok "health $(python3 -c "import json; print(json.load(open('/tmp/p0-health.json')).get('service',''))")"
else
  bad "health unreachable"
fi

echo "A1 login"
TOKEN=$(curl -fsS --max-time 30 -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${PHONE}\",\"code\":\"${CODE}\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token'])") || { bad "login"; exit 1; }
ok "token acquired"

echo "A2 create canvas"
SESSION=$(curl -fsS --max-time 30 -X POST "${BASE_URL}/agent/canvas/create" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"p0-e2e"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
ok "session=$SESSION"

echo "A3 sceneComposer save"
SAVE=$(curl -sS --max-time 30 -X POST "${BASE_URL}/agent/canvas/scene-composer/save" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"${SESSION}\",\"composerNodeId\":\"sc-p0\",\"scenes\":[{\"id\":\"s1\",\"title\":\"场景1\",\"shots\":[{\"id\":\"sh1\",\"title\":\"镜头1\",\"prompt\":\"测试镜头\",\"shotNodeId\":\"shot-p0-1\",\"mediaType\":\"image\"}]}]}")
if python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('code')==0 else 1)" <<<"$SAVE"; then
  ok "save $(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['data']['sceneCount'],'scenes')" "$SAVE")"
else
  bad "save failed: $SAVE"
fi

echo "A4 sceneComposer batch-generate"
BATCH=$(curl -sS --max-time 60 -X POST "${BASE_URL}/agent/canvas/scene-composer/batch-generate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"${SESSION}\",\"composerNodeId\":\"sc-p0\",\"items\":[{\"shotNodeId\":\"shot-p0-1\",\"mediaType\":\"image\",\"prompt\":\"测试镜头\"}]}")
if python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('code')==0 and d.get('data',{}).get('items') else 1)" <<<"$BATCH"; then
  ok "batch items=$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])['data']['items']))" "$BATCH")"
else
  bad "batch failed: $BATCH"
fi

echo "A5 videoComposition export"
EXPORT=$(curl -sS --max-time 120 -X POST "${BASE_URL}/agent/canvas/video-composition/export" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"${SESSION}\",\"compositionNodeId\":\"vc-p0\",\"title\":\"p0\",\"tracks\":[{\"nodeId\":\"t1\",\"type\":\"video\",\"title\":\"clip\",\"url\":\"https://www.w3schools.com/html/mov_bbb.mp4\",\"durationSec\":3}]}")
URL=$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('url',''))" <<<"$EXPORT")
CODE_OUT=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('code'))" <<<"$EXPORT")
if [[ "$CODE_OUT" != "0" || -z "$URL" ]]; then
  bad "export failed: $EXPORT"
elif [[ "$URL" == *127.0.0.1* ]]; then
  bad "export url is localhost: $URL"
elif curl -fsSI --max-time 15 "$URL" | head -1 | grep -q 200; then
  ok "export MP4 reachable"
else
  bad "export url not reachable: $URL"
fi

echo ""
echo "=== summary: ${pass} passed, ${fail} failed ==="
[[ "$fail" -eq 0 ]]
