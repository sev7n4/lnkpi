#!/usr/bin/env python3
"""Production diagnose — agent executed wrong intent (stale checkpoint / gate resume).

Searches recent agent threads for:
  - User utterance containing img2img keywords (模特 + 衣服 / 穿上)
  - Assistant reply referencing @T* when user cited @I*
  - Thread checkpoint still interrupted at a gate

Usage:
  python3 deploy/prod-agent-intent-diagnose.py
  SESSION_ID=cmsxxx python3 deploy/prod-agent-intent-diagnose.py
  SEARCH=模特,穿上这件衣服 python3 deploy/prod-agent-intent-diagnose.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SESSION_ID = os.environ.get("SESSION_ID", "").strip()
SEARCH_TERMS = [t.strip() for t in os.environ.get("SEARCH", "模特,穿上这件衣服,这个是文案").split(",") if t.strip()]

REF_I = re.compile(r"@I\d+", re.I)
REF_T = re.compile(r"@T\d+", re.I)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def preview(s: str, n: int = 90) -> str:
    s = (s or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def list_threads(t: str, sid: str) -> list[dict[str, Any]]:
    return http("GET", f"/agent/chat/threads?sessionId={quote(sid, safe='')}", t=t).get("data") or []


def get_messages(t: str, sid: str, tid: str) -> list[dict[str, Any]]:
    path = f"/agent/chat/user/messages?sessionId={quote(sid, safe='')}&threadId={quote(tid, safe='')}"
    return http("GET", path, t=t).get("data") or []


def thread_state(t: str, tid: str) -> dict[str, Any] | None:
    try:
        return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=t).get("data")
    except HTTPError:
        return None


def thread_timeline(t: str, tid: str) -> dict[str, Any] | None:
    try:
        return http("GET", f"/agent/thread-timeline?threadId={quote(tid, safe='')}", t=t).get("data")
    except HTTPError:
        return None


def matches_search(text: str) -> bool:
    t = text or ""
    return any(term in t for term in SEARCH_TERMS)


def diagnose_turn(user: dict[str, Any], assistant: dict[str, Any] | None) -> list[str]:
    findings: list[str] = []
    u = str(user.get("content") or "")
    a = str((assistant or {}).get("content") or "")
    if not u:
        return findings
    if REF_I.search(u) and REF_T.search(a) and not REF_T.search(u):
        findings.append("assistant_ref_mismatch: user cited @I* but reply/title uses @T*")
    if "穿上" in u and "这个是文案" in a:
        findings.append("intent_mismatch: img2img dress request vs T1 copy task")
    if "标题顺序" in a and "标题顺序" not in u:
        findings.append("stale_prompt: assistant used prior T1 sequential copy task")
    return findings


def main() -> int:
    print("=== Agent intent mismatch diagnose ===")
    print(f"BASE={BASE}")
    print(f"SEARCH={SEARCH_TERMS}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    print("✅ Login OK\n")

    sessions: list[str] = []
    if SESSION_ID:
        sessions = [SESSION_ID]
    else:
        try:
            rows = http("GET", "/sessions?limit=20", t=tok).get("data") or []
            sessions = [str(r.get("id") or "") for r in rows if r.get("id")]
        except HTTPError as exc:
            print(f"❌ Cannot list sessions: HTTP {exc.code}")
            return 1

    hit = 0
    for sid in sessions[:20]:
        try:
            http("GET", f"/sessions/{sid}", t=tok)
        except HTTPError:
            continue
        threads = list_threads(tok, sid)
        if not threads:
            continue
        for th in threads[:15]:
            tid = str(th.get("id") or "")
            if not tid:
                continue
            msgs = get_messages(tok, sid, tid)
            for i, m in enumerate(msgs):
                if m.get("role") != "user":
                    continue
                u_text = str(m.get("content") or "")
                if not matches_search(u_text):
                    continue
                assistant = msgs[i + 1] if i + 1 < len(msgs) and msgs[i + 1].get("role") == "assistant" else None
                findings = diagnose_turn(m, assistant)
                if not findings and not matches_search(str((assistant or {}).get("content") or "")):
                    continue
                hit += 1
                print(f"--- Hit #{hit} session={sid[-8:]} thread={tid[-16:]} ---")
                print(f"  thread title: {preview(str(th.get('title') or ''), 60)}")
                print(f"  user: {preview(u_text)}")
                if assistant:
                    print(f"  assistant: {preview(str(assistant.get('content') or ''))}")
                for f in findings:
                    print(f"  ⚠️  {f}")
                st = thread_state(tok, tid)
                if st:
                    print(
                        f"  checkpoint: phase={st.get('phase')!r} interrupted={st.get('interrupted')} "
                        f"next={st.get('nextNodes')} atomic={preview(str(st.get('atomicSpec') or st.get('checkpoint') or ''), 70)}"
                    )
                tl = thread_timeline(tok, tid)
                if tl and tl.get("checkpoints"):
                    last = tl["checkpoints"][0]
                    vals = last.get("values") or {}
                    print(
                        f"  timeline: step={last.get('step')} phase={vals.get('phase')!r} "
                        f"flow={vals.get('flow_mode')!r} atomic_title={preview(str((vals.get('atomic_spec') or {}).get('title') or ''), 60)}"
                    )
                print()

    if hit == 0:
        print("No matching turns found. Set SESSION_ID to the canvas session or broaden SEARCH=…")
        return 0
    print(f"=== Found {hit} candidate turn(s) ===")
    print(
        "Likely root cause when user @I* img2img but assistant @T* copy:\n"
        "  1) LangGraph interrupt_before gate still pending → new message resumed OLD gate/checkpoint\n"
        "  2) atomic_regenerate reused prior atomic_spec instead of re-parsing utterance\n"
        "Fix: should_resume_interrupt + fresh restart at intake (runs.py / hitl_resume.py)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
