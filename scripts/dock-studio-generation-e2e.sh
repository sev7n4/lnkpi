#!/usr/bin/env bash
# Dock Studio 生成链路 E2E（模拟用户：登录 → 画布 → text/video/audio 生成 → 持久化校验）
# 用法: ./scripts/dock-studio-generation-e2e.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://lnkpi-web.vercel.app/api}"
PHONE="${PHONE:-13800138000}"
CODE="${CODE:-123456}"

pass=0
fail=0

ok() { echo "  ✅ $*"; pass=$((pass + 1)); }
bad() { echo "  ❌ $*"; fail=$((fail + 1)); }

echo "=== Dock Studio Generation E2E ==="
echo "BASE_URL=$BASE_URL"

TOKEN=$(curl -fsS --max-time 30 -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"${PHONE}\",\"code\":\"${CODE}\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token'])")
ok "login"

SESSION=$(curl -fsS --max-time 30 -X POST "$BASE_URL/agent/canvas/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"dock-studio-e2e"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
ok "canvas session=$SESSION"

TEXT_NODE_ID="text-e2e-1"
VIDEO_NODE_ID="video-e2e-1"
AUDIO_NODE_ID="audio-e2e-1"

echo "T1 text generate (Dock: 生成文案)"
TEXT_RES=$(curl -sS --max-time 120 -X POST "$BASE_URL/studio/text/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"用一句话介绍西湖","model":"agnes-2.0-flash"}')
TEXT_CONTENT=$(python3 -c "import json,sys; d=json.load(sys.stdin); m=d.get('data',{}).get('metadata'); import json as j; print(j.loads(m).get('text','') if m else '')" <<<"$TEXT_RES")
if [[ -n "$TEXT_CONTENT" && $(python3 -c "import json,sys; print(json.load(sys.stdin).get('code'))" <<<"$TEXT_RES") == "0" ]]; then
  ok "text content len=${#TEXT_CONTENT}"
else
  bad "text generate failed: $TEXT_RES"
fi

echo "T2 audio generate (Dock: 生成音频)"
AUDIO_RES=$(curl -sS --max-time 90 -X POST "$BASE_URL/studio/audio/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，这是音频测试","voice":"female-1"}')
AUDIO_URL=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('url',''))" <<<"$AUDIO_RES")
if [[ -n "$AUDIO_URL" && $(python3 -c "import json,sys; print(json.load(sys.stdin).get('code'))" <<<"$AUDIO_RES") == "0" ]]; then
  ok "audio url=${AUDIO_URL:0:60}..."
else
  bad "audio generate failed: $AUDIO_RES"
fi

echo "T3 video generate submit (Dock: 生成视频)"
VIDEO_RES=$(curl -sS --max-time 60 -X POST "$BASE_URL/studio/video/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A cat by West Lake at sunset, cinematic","model":"agnes-video-v2.0","duration":3,"aspectRatio":"16:9"}')
VIDEO_RECORD=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('id',''))" <<<"$VIDEO_RES")
VIDEO_STATUS=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('status',''))" <<<"$VIDEO_RES")
if [[ -n "$VIDEO_RECORD" && "$VIDEO_STATUS" == "generating" ]]; then
  ok "video submitted record=$VIDEO_RECORD"
else
  bad "video submit failed: $VIDEO_RES"
fi

VIDEO_FINAL_URL=""
VIDEO_FINAL_STATUS="generating"
if [[ -n "$VIDEO_RECORD" ]]; then
  echo "T3b video poll (前端 generationPolling 等价)"
  for i in $(seq 1 36); do
    POLL=$(curl -sS --max-time 30 -H "Authorization: Bearer $TOKEN" "$BASE_URL/studio/generations/$VIDEO_RECORD")
    VIDEO_FINAL_STATUS=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('status',''))" <<<"$POLL")
    VIDEO_FINAL_URL=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('url') or '')" <<<"$POLL")
    echo "    poll $i: status=$VIDEO_FINAL_STATUS"
    [[ "$VIDEO_FINAL_STATUS" == "completed" && -n "$VIDEO_FINAL_URL" ]] && break
    [[ "$VIDEO_FINAL_STATUS" == "failed" ]] && break
    sleep 10
  done
  if [[ "$VIDEO_FINAL_STATUS" == "completed" && -n "$VIDEO_FINAL_URL" ]]; then
    ok "video completed"
  else
    bad "video final status=$VIDEO_FINAL_STATUS"
  fi
fi

echo "T4 save canvas nodes (模拟 patchNodeData + saveCanvas)"
CANVAS_JSON=$(python3 - <<PY
import json
text_content = """$TEXT_CONTENT"""
audio_url = """$AUDIO_URL"""
video_url = """$VIDEO_FINAL_URL"""
video_status = "completed" if video_url else ("error" if "$VIDEO_FINAL_STATUS" == "failed" else "generating")
nodes = [
  {"id":"$TEXT_NODE_ID","type":"text","position":{"x":100,"y":100},"data":{"content":text_content,"prompt":"用一句话介绍西湖","status":"completed"}},
  {"id":"$AUDIO_NODE_ID","type":"audio","position":{"x":100,"y":320},"data":{"url":audio_url,"prompt":"你好，这是音频测试","status":"completed"}},
  {"id":"$VIDEO_NODE_ID","type":"video","position":{"x":100,"y":540},"data":{"url":video_url or "","status":video_status,"generationRecordId":"$VIDEO_RECORD","prompt":"A cat by West Lake"}},
]
print(json.dumps({"nodes":nodes,"edges":[]}))
PY
)

SAVE=$(curl -sS --max-time 30 -X PUT "$BASE_URL/agent/canvas/update" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$SESSION\",\"canvasData\":$CANVAS_JSON}")
if python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('code')==0 else 1)" <<<"$SAVE"; then
  ok "canvas saved"
else
  bad "canvas save failed: $SAVE"
fi

echo "T5 reload canvas (刷新持久化)"
RELOAD=$(curl -sS --max-time 30 -H "Authorization: Bearer $TOKEN" "$BASE_URL/sessions/$SESSION")
python3 - <<'PY' "$RELOAD" "$TEXT_NODE_ID" "$AUDIO_NODE_ID" "$VIDEO_NODE_ID"
import json,sys
data=json.loads(sys.argv[1])
text_id,audio_id,video_id=sys.argv[2:5]
nodes={n['id']:n for n in (data.get('data',{}).get('canvasData',{}) or {}).get('nodes',[])}
checks=[]
for nid,field in [(text_id,'content'),(audio_id,'url'),(video_id,'url')]:
    node=nodes.get(nid)
    val=(node or {}).get('data',{}).get(field,'') if node else ''
    checks.append((nid,field,bool(str(val).strip()),str(val)[:80]))
for nid,field,ok,val in checks:
    print(f"{'OK' if ok else 'FAIL'} {nid}.{field}={val}")
    if not ok: sys.exit(1)
PY
if [[ $? -eq 0 ]]; then
  ok "reload fields present"
else
  bad "reload missing node fields"
fi

echo ""
echo "=== summary: ${pass} passed, ${fail} failed ==="
[[ "$fail" -eq 0 ]]
