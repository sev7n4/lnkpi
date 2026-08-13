#!/usr/bin/env python3
"""Production diagnose — product visual vision QA (识图) availability.

Runs one product_visual turn with a sample product image and prints:
  - runtime health
  - interrupt fields: visionUsed, imageQaReason, imageQaCode
  - suggested remediation from imageQaCode

Usage:
  python3 deploy/prod-vision-qa-diagnose.py
  PV_PRODUCT_URL=https://example.com/product.jpg python3 deploy/prod-vision-qa-diagnose.py

Exit 0 when vision QA passes or gate reached with visionUsed=true.
Exit 1 when visionUsed=false with actionable code.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
PRODUCT_URL = os.environ.get(
    "PV_PRODUCT_URL",
    "https://picsum.photos/seed/lnkpi-vision-qa/800/800",
)
SKILL_ID = os.environ.get("PV_SKILL_ID", "product-visual")
SSE_TIMEOUT = float(os.environ.get("PV_SSE_TIMEOUT_SEC", "180"))

REMEDIATION: dict[str, str] = {
    "missing_image": "上传产品实拍图到侧栏引用后再试",
    "missing_api_key": "在 BYOK / 服务商配置视觉模型 API Key",
    "model_not_vision": "侧栏规划模型改为 Gemini / GPT-4o 等支持识图的模型",
    "vision_not_invoked": "检查 agent-runtime 与 Nest run-vision-qa 连通性",
    "vision_not_used": "检查 LNKPI_PRODUCT_VISUAL_SCHEME_V2 与 runtime 日志",
    "vision_format_error": "换图重试或检查视觉模型返回 JSON 格式",
    "vision_call_failed": "检查视觉 API 网络/配额/超时",
    "quality_fail": "换更清晰白底产品图或使用门控「AI 白底」",
}


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sse_turn(tok: str, sid: str, tid: str, msg: str, attachments: list[dict]) -> dict[str, Any]:
    body = {
        "sessionId": sid,
        "message": msg,
        "threadId": tid,
        "skillId": SKILL_ID,
        "attachments": attachments,
    }
    req = Request(
        f"{API}/agent/chat/conversation",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {tok}",
            "Idempotency-Key": str(uuid.uuid4()),
        },
        method="POST",
    )
    out: dict[str, Any] = {
        "phases": set(),
        "visionUsed": None,
        "imageQaReason": None,
        "imageQaCode": None,
        "presentationTitle": None,
    }
    deadline = time.time() + SSE_TIMEOUT
    with urlopen(req, timeout=SSE_TIMEOUT + 30) as resp:
        buf = ""
        while time.time() < deadline:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                if not line.startswith("data: "):
                    continue
                if line == "data: [DONE]":
                    return out
                try:
                    ev = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                et = ev.get("type")
                data = ev.get("data") or {}
                if et in ("interrupt", "done"):
                    phase = data.get("phase")
                    if phase:
                        out["phases"].add(str(phase))
                    for key in ("visionUsed", "imageQaReason", "imageQaCode"):
                        if data.get(key) is not None:
                            out[key] = data.get(key)
                    pres = data.get("presentation") or {}
                    if isinstance(pres, dict) and pres.get("title"):
                        out["presentationTitle"] = pres.get("title")
                if et == "error":
                    out["error"] = data
                    return out
    return out


def main() -> int:
    print(f"BASE_URL={BASE}")
    print(f"PRODUCT_URL={PRODUCT_URL}\n")

    try:
        health = http("GET", "/agent/runtime-health")
        print("=== Runtime health ===")
        print(json.dumps(health, ensure_ascii=False, indent=2))
        if not (health.get("data") or {}).get("ok"):
            print("\n❌ Agent runtime 不可用")
            return 1
    except Exception as exc:
        print(f"❌ runtime-health failed: {exc}")
        return 1

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]

    sess = http("POST", "/sessions", {"title": "vision-qa-diagnose"}, t=tok)["data"]
    sid = str(sess["id"])
    tid = f"{sid}:vision-qa-{uuid.uuid4().hex[:8]}"
    print(f"\nSESSION={sid}\nTHREAD={tid}\n")

    att = [{
        "id": "diag-img",
        "mediaType": "image",
        "sourceKind": "upload",
        "label": "product.jpg",
        "url": PRODUCT_URL,
    }]
    msg = "为这款产品设计电商主图与详情页视觉，需要包装特写和模特展示"
    print("=== SSE turn (product_visual + image) ===")
    result = sse_turn(tok, sid, tid, msg, att)
    printable = {k: (sorted(v) if isinstance(v, set) else v) for k, v in result.items()}
    print(json.dumps(printable, ensure_ascii=False, indent=2))

    code = str(result.get("imageQaCode") or "")
    vision_used = result.get("visionUsed")
    phases = result.get("phases") or set()

    print("\n=== Diagnosis ===")
    if code:
        print(f"imageQaCode: {code}")
        hint = REMEDIATION.get(code)
        if hint:
            print(f"建议: {hint}")
    if result.get("imageQaReason"):
        print(f"imageQaReason: {result.get('imageQaReason')}")
    if result.get("presentationTitle"):
        print(f"presentation.title: {result.get('presentationTitle')}")

    ts = http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}
    print("\n=== thread-state ===")
    print(json.dumps(ts, ensure_ascii=False, indent=2)[:2000])

    if "dialog_draft" in phases or "await_macro_scheme_select" in phases:
        print("\n✅ 识图门控已通过，进入方案阶段")
        return 0
    if vision_used is True and code in ("", "pass", "quality_fail"):
        if code == "quality_fail":
            print("\n⚠️ 识图已调用但质量未通过（预期内可继续门控）")
            return 0
        print("\n✅ visionUsed=true")
        return 0
    if code in REMEDIATION:
        print(f"\n❌ 识图不可用 ({code})")
        return 1
    if vision_used is False:
        print("\n❌ visionUsed=false — 自动识图未生效")
        return 1
    print("\n⚠️ 未明确结论，请查看上方 SSE / thread-state")
    return 1


if __name__ == "__main__":
    sys.exit(main())
