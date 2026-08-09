#!/usr/bin/env python3
"""Production smoke: P1 route unification — style3, video, img2img, orch clarify.

Usage:
  python3 deploy/prod-route-unification-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=... CODE=... python3 deploy/prod-route-unification-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any, Callable
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "120"))

IMG2IMG_MSG = (
    "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。"
    "保持主图风格，背景，构图不变。"
)
STYLE3_MSG = "@T1 请按风格3出图"
VIDEO_REF_MSG = "@T1 请基于文案生成视频"
ORCH_MSG = "天猫蓝牙耳机详情页营销方案"

PASS = FAIL = 0


def record(case: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        icon = "✅"
    else:
        FAIL += 1
        icon = "❌"
    line = f"{icon} {case}"
    if detail:
        line += f" — {detail[:220]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sse_collect(
    t: str,
    sid: str,
    msg: str,
    tid: str,
    *,
    skill_id: str | None = None,
    attachments: list[dict] | None = None,
    mentioned_keys: list[str] | None = None,
    timeout: float = 120,
) -> tuple[str, dict | None, set[str], dict | None]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if skill_id:
        body["skillId"] = skill_id
    if attachments:
        body["attachments"] = attachments
    if mentioned_keys:
        body["mentionedKeys"] = mentioned_keys
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    parts: list[str] = []
    thread_state_ev: dict | None = None
    route_decision: dict | None = None
    types: set[str] = set()
    end = time.time() + timeout
    with urlopen(r, timeout=timeout + 30) as resp:
        buf = ""
        while time.time() < end:
            try:
                chunk = resp.read(4096)
            except IncompleteRead as exc:
                if exc.partial:
                    buf += exc.partial.decode(errors="replace")
                break
            if not chunk:
                break
            buf += chunk.decode(errors="replace")
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data:"):
                        continue
                    pl = line[5:].strip()
                    if pl == "[DONE]":
                        return "".join(parts), thread_state_ev, types, route_decision
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    et = str(ev.get("type") or "")
                    types.add(et)
                    data = ev.get("data") or {}
                    if et == "text_delta":
                        parts.append(str(data.get("text") or ""))
                    if et == "text_replace" and data.get("text"):
                        parts[-1:] = [str(data["text"])]
                    if et == "thread_state" and isinstance(data, dict):
                        thread_state_ev = data
                    if et == "route_decision" and isinstance(data, dict):
                        route_decision = data
                    if et == "done":
                        return "".join(parts), thread_state_ev, types, route_decision
    return "".join(parts), thread_state_ev, types, route_decision


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid)}", t=tok).get("data") or {}


def run_case(
    tok: str,
    label: str,
    msg: str,
    check: Callable[[str, dict, set[str], dict | None], tuple[bool, str]],
    *,
    mentioned_keys: list[str] | None = None,
    attachments: list[dict] | None = None,
) -> None:
    sid = http("POST", "/sessions", {"title": f"route-uni-{label}-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"ru_{label}_{uuid.uuid4().hex[:8]}"
    text, _ts_ev, types, route_decision = sse_collect(
        tok,
        sid,
        msg,
        tid,
        mentioned_keys=mentioned_keys,
        attachments=attachments,
        timeout=SSE_TIMEOUT_SEC,
    )
    ts = thread_state(tok, tid)
    ok, detail = check(text, ts, types, route_decision)
    record(label, ok, detail)


def main() -> int:
    print("=== prod route unification verify (P1) ===")
    print(f"BASE={BASE}\n")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    record("Login", True)

    mock_attachments = [
        {
            "id": "att_i1",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "model.jpg",
            "url": "https://example.com/model.jpg",
        },
        {
            "id": "att_i2",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "product.jpg",
            "url": "https://example.com/product.jpg",
        },
    ]

    run_case(
        tok,
        "img2img-sidebar",
        IMG2IMG_MSG,
        lambda text, ts, types, rd: (
            (ts.get("flowMode") or ts.get("flow_mode")) != "campaign"
            and "14" not in text,
            f"flow={ts.get('flowMode') or ts.get('flow_mode')} types={sorted(types)[:6]}",
        ),
        mentioned_keys=["I1", "I2"],
        attachments=mock_attachments,
    )

    run_case(
        tok,
        "style3-t1-ref",
        STYLE3_MSG,
        lambda text, ts, types, rd: (
            (ts.get("flowMode") or ts.get("flow_mode")) in ("atomic_create", None)
            or ts.get("phase") in ("intake", "parse", "clarify")
            or (rd or {}).get("precedence_rule_id") == "ref_backed_generate",
            f"flow={ts.get('flowMode') or ts.get('flow_mode')} rule={(rd or {}).get('precedence_rule_id')}",
        ),
        mentioned_keys=["T1"],
    )

    run_case(
        tok,
        "video-ref-t1",
        VIDEO_REF_MSG,
        lambda text, ts, types, rd: (
            (ts.get("flowMode") or ts.get("flow_mode")) != "campaign"
            and (rd is None or (rd.get("atomic_intent") or {}).get("output_modality") in (None, "video")),
            f"flow={ts.get('flowMode') or ts.get('flow_mode')} rule={(rd or {}).get('precedence_rule_id')}",
        ),
        mentioned_keys=["T1"],
    )

    run_case(
        tok,
        "orch-no-skill-clarify",
        ORCH_MSG,
        lambda text, ts, types, rd: (
            (ts.get("flowMode") or ts.get("flow_mode")) != "campaign"
            or "Skill" in text
            or "编排" in text
            or "1）" in text
            or ts.get("phase") == "clarify",
            f"flow={ts.get('flowMode') or ts.get('flow_mode')} phase={ts.get('phase')}",
        ),
    )

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
