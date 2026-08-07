#!/usr/bin/env python3
"""Production smoke: platform route R0 — atomic-first, no implicit skill.

Cases:
  A) §1.1 img2img utterance without skillId → atomic_create (not 14-node campaign)
  B) marketing utterance without skillId → clarify or chat (not campaign + implicit skill)
  C) marketing with explicit skillId=canvas mapping → campaign allowed

Usage:
  python3 deploy/prod-route-context-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=... CODE=... python3 deploy/prod-route-context-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any
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
    timeout: float = 120,
) -> tuple[str, dict | None]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if skill_id:
        body["skillId"] = skill_id
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    parts: list[str] = []
    thread_state_ev: dict | None = None
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
                        return "".join(parts), thread_state_ev
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    et = str(ev.get("type") or "")
                    if et == "text_delta":
                        parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if et == "thread_state":
                        thread_state_ev = ev.get("data") if isinstance(ev.get("data"), dict) else None
    return "".join(parts), thread_state_ev


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid)}", t=tok).get("data") or {}


def main() -> int:
    print("=== prod route context verify (R0) ===")
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]

    # Case A: img2img without skill
    sid_a = http("POST", "/sessions", {"title": f"route-r0-img2img-{int(time.time())}"}, t=tok)["data"]["id"]
    tid_a = f"rr0img_{uuid.uuid4().hex[:8]}"
    text_a, _ = sse_collect(tok, sid_a, IMG2IMG_MSG, tid_a, timeout=SSE_TIMEOUT_SEC)
    ts_a = thread_state(tok, tid_a)
    flow_a = ts_a.get("flowMode") or ts_a.get("flow_mode")
    bad_campaign = "拟定拆解约" in text_a and "14" in text_a
    record(
        "A img2img no skill → not 14-node campaign",
        flow_a != "campaign" and not bad_campaign,
        f"flow={flow_a} text={text_a[:120]}",
    )
    record(
        "A img2img atomic or clarify",
        flow_a in ("atomic_create", None) or "原子" in text_a or "单张" in text_a or ts_a.get("phase") == "clarify",
        f"phase={ts_a.get('phase')}",
    )

    # Case B: marketing without skill
    sid_b = http("POST", "/sessions", {"title": f"route-r0-mkt-{int(time.time())}"}, t=tok)["data"]["id"]
    tid_b = f"rr0mkt_{uuid.uuid4().hex[:8]}"
    text_b, _ = sse_collect(
        tok,
        sid_b,
        "天猫蓝牙耳机详情页营销方案，主图白底",
        tid_b,
        timeout=SSE_TIMEOUT_SEC,
    )
    ts_b = thread_state(tok, tid_b)
    flow_b = ts_b.get("flowMode") or ts_b.get("flow_mode")
    record(
        "B marketing no skill → not silent campaign",
        flow_b != "campaign" or "Skill" in text_b or "编排" in text_b,
        f"flow={flow_b} text={text_b[:120]}",
    )

    # Case C: explicit skill (canvas → enterprise-marketing-campaign)
    sid_c = http("POST", "/sessions", {"title": f"route-r0-skill-{int(time.time())}"}, t=tok)["data"]["id"]
    tid_c = f"rr0sk_{uuid.uuid4().hex[:8]}"
    text_c, _ = sse_collect(
        tok,
        sid_c,
        "天猫蓝牙耳机详情页营销方案",
        tid_c,
        skill_id="canvas",
        timeout=SSE_TIMEOUT_SEC,
    )
    ts_c = thread_state(tok, tid_c)
    flow_c = ts_c.get("flowMode") or ts_c.get("flow_mode")
    record(
        "C explicit skill → campaign path ok",
        flow_c == "campaign" or "确认方案" in text_c or "采纳推荐" in text_c,
        f"flow={flow_c} text={text_c[:120]}",
    )

    print(f"\n=== {PASS}/{PASS + FAIL} passed ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
