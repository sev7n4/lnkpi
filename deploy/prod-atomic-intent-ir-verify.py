#!/usr/bin/env python3
"""Production verify — source-backed video/image intent IR (B+C).

P1 note: ref-backed utterances (@T1 …) require sidebar mentionedKeys + text attachment
to materialize image/video nodes (same as AC-01 / prod-route-unification-verify).

SSE: waits for canvas_action after ``done`` (grace window), then polls session canvas.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any, TypedDict
from urllib.request import Request, urlopen

from urllib.parse import quote

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "300"))
POST_DONE_GRACE_SEC = float(os.environ.get("POST_DONE_GRACE_SEC", "20"))
CANVAS_POLL_SEC = float(os.environ.get("CANVAS_POLL_SEC", "30"))
INTER_CASE_SEC = float(os.environ.get("INTER_CASE_SEC", "20"))
SETTLE_TIMEOUT_SEC = float(os.environ.get("SETTLE_TIMEOUT_SEC", "180"))
CASE_RETRY_ATTEMPTS = int(os.environ.get("CASE_RETRY_ATTEMPTS", "3"))
CASE_RETRY_SLEEP_SEC = float(os.environ.get("CASE_RETRY_SLEEP_SEC", "25"))
TERMINAL_PHASES = frozenset({"done", "error", "clarify", "chat", "await_atomic_confirm"})

T1_TEXT_ATTACHMENT: dict[str, Any] = {
    "id": "t1-text-ref",
    "refKey": "T1",
    "mediaType": "text",
    "sourceKind": "asset",
    "label": "T1文案",
    "text": "蓝牙耳机详情页文案：轻量降噪，续航30小时。",
}


class IrCase(TypedDict, total=False):
    utterance: str
    expect: str
    mentioned_keys: list[str]
    attachments: list[dict[str, Any]]
    seed_text_refs: list[str]


CASES: list[IrCase] = [
    {"utterance": "帮我生成一个蓝牙耳机的分镜提示词", "expect": "prompt"},
    {"utterance": "基于提示词生成视频", "expect": "video"},
    {
        "utterance": "@T1 请按风格3出图",
        "expect": "image",
        "mentioned_keys": ["T1"],
        "attachments": [dict(T1_TEXT_ATTACHMENT)],
        "seed_text_refs": ["T1"],
    },
    {
        "utterance": "@T1 请基于文案生成视频",
        "expect": "video",
        "mentioned_keys": ["T1"],
        "attachments": [dict(T1_TEXT_ATTACHMENT)],
    },
    {"utterance": "基于文本生成图片", "expect": "image"},
]

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
        line += f" — {detail[:200]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def canvas_data(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    return sess.get("canvasData") or {}


def put_canvas_data(tok: str, sid: str, canvas: dict[str, Any]) -> None:
    http("PUT", f"/sessions/{sid}", {"canvasData": canvas}, t=tok)


def seed_text_ref_nodes(tok: str, sid: str, ref_keys: list[str]) -> None:
    """Prod: @T1 style3 variant flow requires T1 text node on canvas first."""
    canvas = canvas_data(tok, sid)
    nodes = list(canvas.get("nodes") or [])
    existing = {str(n.get("id") or "") for n in nodes}
    for key in ref_keys:
        if key in existing:
            continue
        nodes.append(
            {
                "id": key,
                "type": "text",
                "position": {"x": 80, "y": 80},
                "data": {
                    "title": key,
                    "content": T1_TEXT_ATTACHMENT.get("text") or f"{key} 引用文案",
                },
            }
        )
    put_canvas_data(
        tok,
        sid,
        {
            "nodes": nodes,
            "edges": canvas.get("edges") or [],
            "viewport": canvas.get("viewport") or {"x": 0, "y": 0, "zoom": 1},
        },
    )


def latest_canvas_node_type(tok: str, sid: str, node_type: str) -> str | None:
    nodes = [n for n in (canvas_data(tok, sid).get("nodes") or []) if n.get("type") == node_type]
    return str(nodes[-1]["type"]) if nodes else None


def sse_collect(
    t: str,
    sid: str,
    msg: str,
    tid: str,
    *,
    mentioned_keys: list[str] | None = None,
    attachments: list[dict] | None = None,
    timeout: float | None = None,
) -> tuple[list[dict], list[dict], str]:
    timeout = SSE_TIMEOUT_SEC if timeout is None else timeout
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if mentioned_keys:
        body["mentionedKeys"] = mentioned_keys
    if attachments:
        body["attachments"] = attachments
        if attachments and attachments[0].get("id"):
            body["refOrder"] = [str(attachments[0]["id"])]
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    canvas_actions: list[dict] = []
    linked: list[dict] = []
    end = time.time() + timeout
    done_at: float | None = None
    exit_reason = "timeout"
    with urlopen(r, timeout=timeout + 60) as resp:
        buf = ""
        try:
            while time.time() < end:
                if done_at is not None and first_node_type(canvas_actions):
                    exit_reason = "done+canvas_action"
                    break
                if done_at is not None and time.time() - done_at >= POST_DONE_GRACE_SEC:
                    exit_reason = "done_grace_elapsed"
                    break
                try:
                    chunk = resp.read(4096)
                except IncompleteRead as exc:
                    if exc.partial:
                        buf += exc.partial.decode(errors="replace")
                    exit_reason = "incomplete_read"
                    break
                if not chunk:
                    if done_at is not None:
                        exit_reason = "eof_after_done"
                    else:
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
                            exit_reason = "done_marker"
                            if not first_node_type(canvas_actions):
                                done_at = done_at or time.time()
                            else:
                                return canvas_actions, linked, exit_reason
                            continue
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        if ev.get("type") == "canvas_action":
                            canvas_actions.append(ev.get("data") or {})
                        if ev.get("type") == "linked_outputs":
                            linked.extend(ev.get("data") or [])
                        if ev.get("type") == "done":
                            exit_reason = "done_event"
                            if not first_node_type(canvas_actions):
                                done_at = done_at or time.time()
                            else:
                                return canvas_actions, linked, exit_reason
                        if ev.get("type") == "error":
                            exit_reason = "error_event"
                            return canvas_actions, linked, exit_reason
        except IncompleteRead:
            exit_reason = "incomplete_read_outer"
    return canvas_actions, linked, exit_reason


def first_node_type(canvas_actions: list[dict]) -> str | None:
    for act in canvas_actions:
        if act.get("type") != "add_node":
            continue
        payload = act.get("payload") or {}
        return str(payload.get("nodeType") or payload.get("type") or "")
    return None


def resolve_node_type(
    tok: str,
    sid: str,
    expect: str,
    canvas_actions: list[dict],
    linked: list[dict],
    *,
    sse_exit: str,
) -> tuple[str, str]:
    from_sse = first_node_type(canvas_actions)
    if from_sse:
        return from_sse, f"sse:{sse_exit}"
    if linked:
        lo_type = linked[0].get("nodeType")
        if lo_type:
            return str(lo_type), f"linked:{sse_exit}"
    deadline = time.time() + CANVAS_POLL_SEC
    while time.time() < deadline:
        polled = latest_canvas_node_type(tok, sid, expect)
        if polled:
            return polled, "canvas_poll"
        time.sleep(2)
    return "?", f"none:{sse_exit}"


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}


def wait_thread_settled(tok: str, tid: str) -> None:
    """Avoid overlapping agent turns on the same account (prod single-flight)."""
    deadline = time.time() + SETTLE_TIMEOUT_SEC
    while time.time() < deadline:
        phase = str(thread_state(tok, tid).get("phase") or "")
        if phase in TERMINAL_PHASES:
            return
        time.sleep(2)


def run_ir_case(tok: str, case: IrCase) -> tuple[bool, str, str, int]:
    utterance = case["utterance"]
    expect_type = case["expect"]
    sid = http(
        "POST",
        "/sessions",
        {"title": f"ir-verify-{expect_type}-{int(time.time())}"},
        t=tok,
    )["data"]["id"]
    seed_keys = case.get("seed_text_refs") or []
    if seed_keys:
        seed_text_ref_nodes(tok, sid, list(seed_keys))
    tid = f"{sid}:{uuid.uuid4().hex[:8]}"
    actions, linked, sse_exit = sse_collect(
        tok,
        sid,
        utterance,
        tid,
        mentioned_keys=case.get("mentioned_keys"),
        attachments=case.get("attachments"),
    )
    got, source = resolve_node_type(tok, sid, expect_type, actions, linked, sse_exit=sse_exit)
    wait_thread_settled(tok, tid)
    ok = got == expect_type
    return ok, got, source, len(actions)


def main() -> int:
    print("=== Atomic Intent IR production verify ===")
    print(f"BASE={BASE}\n")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    record("Login", True)

    for case in CASES:
        utterance = case["utterance"]
        expect_type = case["expect"]
        ok, got, source, action_count = run_ir_case(tok, case)
        for attempt in range(1, CASE_RETRY_ATTEMPTS):
            if ok:
                break
            time.sleep(CASE_RETRY_SLEEP_SEC)
            ok, got, source, action_count = run_ir_case(tok, case)
            if ok:
                source = f"retry{attempt}:{source}"
        record(
            f"{utterance} → {expect_type}",
            ok,
            f"got={got}, actions={action_count}, via={source}",
        )
        time.sleep(INTER_CASE_SEC)

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
