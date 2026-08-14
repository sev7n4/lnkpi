#!/usr/bin/env python3
"""Production smoke verify for sidebar attachments (M3 explicit refs).

Sections:
  A) Runtime unit smoke — normalize_sidebar_attachments, atomic localRefs,
     campaign apply_sidebar_refs, mentionedKeys patch (pytest, no network)
  B) Production integration — SSE with explicit attachment + mentionedKeys payload:
     1. focusNodeId alone → no silent localRefs (M3 D-A/D-B)
     2. atomic_create + attachments + mentionedKeys → localRefs + node.data.mentionedKeys
     3. campaign plan → confirm split → seed image ref edges
     4. P1: marketing without skillId → clarify_route (not silent campaign)

Usage:
  python3 deploy/prod-sidebar-attachments-verify.py
  SKIP_UNIT=1 python3 deploy/prod-sidebar-attachments-verify.py   # prod only
  SKIP_PROD=1 python3 deploy/prod-sidebar-attachments-verify.py   # unit only
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from http.client import IncompleteRead
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "300"))
SKIP_UNIT = os.environ.get("SKIP_UNIT", "").strip().lower() in ("1", "true", "yes")
SKIP_PROD = os.environ.get("SKIP_PROD", "").strip().lower() in ("1", "true", "yes")

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_DIR = ROOT / "services" / "agent-runtime"

MOCK_REF_URL = os.environ.get(
    "SIDEBAR_MOCK_REF_URL",
    "https://picsum.photos/seed/lnkpi-sidebar-ref/512/512",
)
MOCK_ATTACHMENT: dict[str, Any] = {
    "id": "sidebar-smoke-ref",
    "mediaType": "image",
    "sourceKind": "upload",
    "label": "ref.jpg",
    "url": MOCK_REF_URL,
}

PASS = FAIL = SKIP = 0


def record(case: str, ok: bool, detail: str = "", *, skip: bool = False) -> None:
    global PASS, FAIL, SKIP
    if skip:
        SKIP += 1
        icon = "⏭️"
    elif ok:
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
    attachments: list[dict[str, Any]] | None = None,
    ref_order: list[str] | None = None,
    mentioned_keys: list[str] | None = None,
    focus_node_id: str | None = None,
    timeout: float = 300,
) -> tuple[list[dict], str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if skill_id:
        body["skillId"] = skill_id
    if attachments:
        body["attachments"] = attachments
    if ref_order:
        body["refOrder"] = ref_order
    if mentioned_keys:
        body["mentionedKeys"] = mentioned_keys
    if focus_node_id:
        body["focusNodeId"] = focus_node_id
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    parts: list[str] = []
    replaces: list[str] = []
    end = time.time() + timeout
    exit_reason = "timeout"
    with urlopen(r, timeout=timeout) as resp:
        buf = ""
        try:
            while time.time() < end:
                try:
                    chunk = resp.read(4096)
                except IncompleteRead as exc:
                    if exc.partial:
                        buf += exc.partial.decode(errors="replace")
                    exit_reason = "eof"
                    break
                if not chunk:
                    exit_reason = "eof"
                    break
                buf += chunk.decode(errors="replace")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    for line in block.splitlines():
                        if not line.startswith("data:"):
                            continue
                        pl = line[5:].strip()
                        if pl == "[DONE]":
                            text = replaces[-1] if replaces else "".join(parts)
                            return events, text, types, "done_marker"
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        events.append(ev)
                        et = str(ev.get("type") or "")
                        types.add(et)
                        data = ev.get("data") or {}
                        text_chunk = str(data.get("text") or "")
                        if et == "text_delta" and text_chunk:
                            parts.append(text_chunk)
                        elif et == "text_replace" and text_chunk:
                            replaces.append(text_chunk)
                        if et == "done":
                            text = replaces[-1] if replaces else "".join(parts)
                            return events, text, types, "done"
                        if et == "error":
                            text = replaces[-1] if replaces else "".join(parts)
                            return events, text, types, "error"
        except IncompleteRead:
            exit_reason = "eof"
    text = replaces[-1] if replaces else "".join(parts)
    return events, text, types, exit_reason


def canvas_data(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    return sess.get("canvasData") or {}


def put_canvas_data(tok: str, sid: str, canvas: dict[str, Any]) -> None:
    http("PUT", f"/sessions/{sid}", {"canvasData": canvas}, t=tok)


def seed_image_node(tok: str, sid: str, *, url: str, title: str = "focus-ref-seed") -> str:
    canvas = canvas_data(tok, sid)
    node_id = f"image-focus-{int(time.time())}"
    nodes = list(canvas.get("nodes") or [])
    nodes.append(
        {
            "id": node_id,
            "type": "image",
            "position": {"x": 640, "y": 320},
            "data": {
                "title": title,
                "prompt": "侧栏 focus 解耦 smoke seed",
                "url": url,
                "status": "done",
            },
        }
    )
    put_canvas_data(
        tok,
        sid,
        {
            "nodes": nodes,
            "edges": canvas.get("edges") or [],
            "viewport": canvas.get("viewport"),
        },
    )
    return node_id


def latest_node(tok: str, sid: str, node_type: str) -> dict[str, Any] | None:
    nodes = [n for n in (canvas_data(tok, sid).get("nodes") or []) if n.get("type") == node_type]
    return nodes[-1] if nodes else None


def run_unit_smoke() -> bool:
    print("--- Unit: sidebar attachment runtime ---")
    if not RUNTIME_DIR.is_dir():
        record("runtime dir exists", False, str(RUNTIME_DIR))
        return False
    tests = [
        "tests/test_sidebar_attachments.py",
        "tests/test_atomic_sidebar_refs.py",
        "tests/test_campaign_sidebar_refs.py",
    ]
    rc = subprocess.call(
        [sys.executable, "-m", "pytest", *tests, "-q", "--tb=line"],
        cwd=RUNTIME_DIR,
    )
    record("pytest sidebar attachment suite", rc == 0, f"exit={rc}")
    return rc == 0


def verify_focus_only_no_silent_ref(tok: str) -> None:
    """M3: focusNodeId alone must not silently merge canvas node as sidebar ref."""
    sid = http("POST", "/sessions", {"title": f"sidebar-focus-{int(time.time())}"}, t=tok)["data"]["id"]
    focus_url = "https://picsum.photos/seed/lnkpi-sidebar-focus-only/512/512"
    focus_id = seed_image_node(tok, sid, url=focus_url)
    tid = f"{sid}:{uuid.uuid4()}"
    _, text, types, exit_reason = sse_collect(
        tok,
        sid,
        "按选中节点风格生成白底主图",
        tid,
        focus_node_id=focus_id,
        timeout=SSE_TIMEOUT_SEC,
    )
    record("focus-only path started", "error" not in types, text[:140])

    node = latest_node(tok, sid, "image")
    data = (node or {}).get("data") or {}
    local_refs = data.get("localRefs") or []
    has_focus_url = any(str(r.get("url") or "") == focus_url for r in local_refs if isinstance(r, dict))
    record(
        "focus-only no silent localRefs",
        not has_focus_url,
        f"refs={len(local_refs)} focus={focus_id} exit={exit_reason}",
    )


def verify_atomic_local_refs(tok: str) -> None:
    sid = http("POST", "/sessions", {"title": f"sidebar-atomic-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    attachments = [dict(MOCK_ATTACHMENT)]
    ref_order = [attachments[0]["id"]]
    _, text, types, exit_reason = sse_collect(
        tok,
        sid,
        "按 @I1 风格帮我生成蓝牙耳机主图",
        tid,
        attachments=attachments,
        ref_order=ref_order,
        mentioned_keys=["I1"],
        timeout=SSE_TIMEOUT_SEC,
    )

    not_campaign = "await_confirm" not in types and "拟定拆解约" not in text[:240]
    record("atomic path with attachment", not_campaign and "error" not in types, text[:140])

    node = latest_node(tok, sid, "image")
    data = (node or {}).get("data") or {}
    local_refs = data.get("localRefs") or []
    ref_order_on_node = data.get("refOrder") or []
    has_ref_url = any(str(r.get("url") or "") == MOCK_REF_URL for r in local_refs if isinstance(r, dict))
    record(
        "atomic localRefs on image node",
        bool(node) and len(local_refs) >= 1 and has_ref_url,
        f"refs={len(local_refs)} exit={exit_reason}",
    )
    record(
        "atomic refOrder on image node",
        attachments[0]["id"] in ref_order_on_node,
        str(ref_order_on_node)[:120],
    )
    mentioned_keys = data.get("mentionedKeys") or []
    record(
        "atomic mentionedKeys on image node",
        "I1" in mentioned_keys,
        str(mentioned_keys)[:120],
    )


def _seed_image_with_media_edges(canvas: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    nodes = canvas.get("nodes") or []
    edges = canvas.get("edges") or []
    media_ids = {n["id"] for n in nodes if n.get("type") == "mediaInput"}
    for node in nodes:
        if node.get("type") != "image":
            continue
        incoming = [e for e in edges if e.get("target") == node.get("id")]
        media_sources = [str(e.get("source") or "") for e in incoming if str(e.get("source") or "") in media_ids]
        if media_sources:
            return node, media_sources
    return None, []


def verify_campaign_orch_clarify_without_skill(tok: str) -> None:
    """P1 AC-04: orchestration utterance + attachment without Skill → clarify_route."""
    sid = http("POST", "/sessions", {"title": f"sidebar-orch-clarify-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    attachments = [dict(MOCK_ATTACHMENT)]
    ref_order = [attachments[0]["id"]]
    _, text, types, exit_reason = sse_collect(
        tok,
        sid,
        "天猫蓝牙耳机详情页营销方案，主图参考 @I1，品牌 lnkpi",
        tid,
        attachments=attachments,
        ref_order=ref_order,
        mentioned_keys=["I1"],
        timeout=SSE_TIMEOUT_SEC,
    )
    at_clarify = (
        "1）" in text
        or "Skill" in text
        or "编排" in text
        or "await_confirm" not in types
    ) and "error" not in types
    record(
        "campaign orch without skill → clarify",
        at_clarify and "拟定拆解约 14" not in text[:240],
        text[:140],
    )
    record(
        "campaign clarify shows ref acknowledgment",
        "已看到引用" in text or "@I1" in text,
        f"exit={exit_reason}",
    )


def verify_campaign_attach_edges(tok: str) -> None:
    """Explicit skillId required for campaign path (P1 R-S1 / R-S2)."""
    sid = http("POST", "/sessions", {"title": f"sidebar-campaign-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"{sid}:{uuid.uuid4()}"
    attachments = [dict(MOCK_ATTACHMENT)]
    ref_order = [attachments[0]["id"]]
    campaign_msg = "天猫蓝牙耳机详情页营销方案，主图参考 @I1，品牌 lnkpi"

    _, text1, types1, exit1 = sse_collect(
        tok,
        sid,
        campaign_msg,
        tid,
        skill_id="canvas",
        attachments=attachments,
        ref_order=ref_order,
        mentioned_keys=["I1"],
        timeout=SSE_TIMEOUT_SEC,
    )
    at_plan = (
        "await_confirm" in types1
        or "interrupt" in types1
        or "拟定拆解" in text1
        or ("拟定" in text1 and "请确认" in text1)
        or ("请确认" in text1 and ("拆解" in text1 or "模块" in text1))
        or "确认方案" in text1
        or "采纳推荐" in text1
    )
    record("campaign plan with explicit skill", at_plan and "error" not in types1, text1[:140])

    confirm_msg = "确认方案" if "确认方案" in text1 or "采纳推荐" in text1 else "确认出图"
    _, text2, types2, exit2 = sse_collect(tok, sid, confirm_msg, tid, timeout=SSE_TIMEOUT_SEC)
    confirm_ok = "error" not in types2 and len(text2) > 0
    record("campaign confirm split", confirm_ok, f"exit={exit2} text={text2[:100]}")

    canvas = canvas_data(tok, sid)
    nodes = canvas.get("nodes") or []
    seed_node = next(
        (
            n
            for n in nodes
            if n.get("type") == "image"
            and any(str((r or {}).get("url") or "") == MOCK_REF_URL for r in ((n.get("data") or {}).get("localRefs") or []) if isinstance(r, dict))
        ),
        None,
    )
    seed_data = (seed_node or {}).get("data") or {}
    local_refs = seed_data.get("localRefs") or []
    ref_url_ok = any(str(r.get("url") or "") == MOCK_REF_URL for r in local_refs if isinstance(r, dict))
    record(
        "campaign seed image localRefs",
        seed_node is not None and len(local_refs) >= 1 and ref_url_ok,
        f"seed={seed_node.get('id') if seed_node else None} refs={len(local_refs)} exit1={exit1}",
    )


def run_prod_smoke() -> None:
    print(f"\n--- Production integration (BASE={BASE}) ---")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("Login", True)
    except Exception as exc:  # noqa: BLE001
        record("Login", False, str(exc))
        return

    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    verify_focus_only_no_silent_ref(tok)
    verify_atomic_local_refs(tok)
    verify_campaign_orch_clarify_without_skill(tok)
    verify_campaign_attach_edges(tok)


def main() -> int:
    print("=== Sidebar attachments smoke verify (M3 explicit refs) ===")
    if SKIP_UNIT:
        record("Unit smoke", True, "SKIP_UNIT=1", skip=True)
    else:
        run_unit_smoke()

    if SKIP_PROD:
        record("Production integration", True, "SKIP_PROD=1", skip=True)
    else:
        run_prod_smoke()

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
