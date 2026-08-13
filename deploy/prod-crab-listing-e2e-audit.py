#!/usr/bin/env python3
"""Production E2E + dialog context audit — 大闸蟹 listing full flow."""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT = float(os.environ.get("PV_SSE_TIMEOUT_SEC", "900"))
GEN_POLL_SEC = float(os.environ.get("PV_GEN_POLL_SEC", "20"))
OVERALL_TIMEOUT = float(os.environ.get("PV_OVERALL_TIMEOUT_SEC", "7200"))
OUT_PATH = Path(os.environ.get("AUDIT_OUT", "deploy/prod-crab-listing-audit.json"))

UTTERANCE = os.environ.get(
    "CRAB_UTTERANCE",
    "用这张产品实拍图出电商标准的出图方案，需要至少包括：主图、详情页、模特展示场景图、营销海报、产品细节图、物流包装图；"
    "价格为：108元/3只，平均3两一只。产地：鄱阳湖。突出卖点，比如物流生鲜当日达， 文案等内容你帮我想。",
)

MACRO_PREFIX = "__macro_scheme_decision__"
DELIVERY_PREFIX = "__delivery_decision__"

audit: dict[str, Any] = {"steps": [], "gates_seen": [], "issues": []}
last_journey_snapshot: dict[str, Any] | None = None


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def find_crab_asset(tok: str) -> dict[str, Any]:
    items = http("GET", "/assets/mine", t=tok)["data"]["items"]
    for item in items:
        label = str(item.get("label") or "")
        if "大闸蟹" in label or "蟹" in label:
            return item
    raise RuntimeError("资产库未找到大闸蟹图片")


def sse_turn(
    tok: str,
    sid: str,
    tid: str,
    msg: str,
    *,
    attachments: list[dict] | None = None,
    skill_id: str | None = None,
    timeout: float = SSE_TIMEOUT,
) -> dict[str, Any]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if attachments:
        body["attachments"] = attachments
    if skill_id:
        body["skillId"] = skill_id
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    req = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict[str, Any]] = []
    text_parts: list[str] = []
    end = time.time() + timeout
    exit_reason = "timeout"
    with urlopen(req, timeout=timeout + 60) as resp:
        buf = ""
        while time.time() < end:
            chunk = resp.read(4096)
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
                        exit_reason = "done_marker"
                        break
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    if ev.get("type") == "text_delta":
                        text_parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if ev.get("type") in ("done", "error"):
                        exit_reason = ev.get("type")
                        break
                if exit_reason in ("done_marker", "done", "error"):
                    break
            if exit_reason in ("done_marker", "done", "error"):
                break
    return {
        "exit": exit_reason,
        "text": "".join(text_parts),
        "events": events,
        "event_types": sorted({str(e.get("type")) for e in events}),
    }


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}


def agent_messages(tok: str, sid: str, tid: str) -> list[dict[str, Any]]:
    try:
        data = http("POST", "/agent/internal/get-agent-messages", {"sessionId": sid, "threadId": tid}, t=tok)
        return list((data.get("data") or data).get("messages") or [])
    except Exception:
        pass
    try:
        data = http("GET", f"/agent/messages?sessionId={sid}&threadId={tid}", t=tok)
        return list((data.get("data") or data).get("messages") or [])
    except Exception:
        return []


def gate_reply(ts: dict[str, Any]) -> str | None:
    phase = ts.get("phase")
    next_nodes = [str(n) for n in (ts.get("nextNodes") or [])]
    gate = next_nodes[0] if next_nodes else None
    interrupted = bool(ts.get("interrupted"))
    active = gate or phase

    if active == "await_image_qa" and interrupted:
        return "就用这张图，继续"

    if active == "await_macro_scheme_select" and (interrupted or ts.get("macroSchemes")):
        schemes = ts.get("macroSchemes") or []
        if not schemes:
            return None
        rec = [str(s["id"]) for s in schemes if s.get("recommended")][:2]
        selected = rec or [str(schemes[0]["id"])]
        return f"{MACRO_PREFIX}{json.dumps({'action': 'confirm', 'selected_ids': selected}, ensure_ascii=False)}"

    if active in ("await_shot_topo_confirm", "await_topo") and (interrupted or phase == "await_topo"):
        return "确认构图并开始出图" if active == "await_shot_topo_confirm" else "确认出图"

    if active == "await_shot_confirm" and interrupted:
        return "确认出图"

    if active == "await_delivery_confirm" and interrupted:
        shots = ts.get("shotManifest") or []
        gen_by_key = ts.get("deliveryGenByKey") or {}
        if not shots:
            return None
        selections: dict[str, str] = {}
        for shot in shots:
            if not isinstance(shot, dict):
                continue
            sid = str(shot.get("shot_id") or "")
            if not sid:
                continue
            variants = max(1, min(3, int(shot.get("variant_count") or 1)))
            keys = [sid] if variants == 1 else [f"{sid}__v{v}" for v in range(1, variants + 1)]
            ready = [k for k in keys if gen_by_key.get(k, {}).get("url")]
            if ready:
                selections[sid] = ready[0]
        if not selections:
            return None
        payload = json.dumps({"action": "confirm_delivery", "selections": selections}, ensure_ascii=False)
        return f"{DELIVERY_PREFIX}{payload}"

    return None


def extract_last_journey_snapshot(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    snap: dict[str, Any] | None = None
    for ev in events:
        if ev.get("type") != "journey_update":
            continue
        data = ev.get("data")
        if not isinstance(data, dict):
            continue
        candidate = data.get("snapshot")
        if isinstance(candidate, dict):
            snap = candidate
    return snap


def absorb_journey_updates(events: list[dict[str, Any]]) -> None:
    global last_journey_snapshot
    snap = extract_last_journey_snapshot(events)
    if snap is not None:
        last_journey_snapshot = snap


def resolve_journey_trace(final_thread_state: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    if last_journey_snapshot is not None:
        return last_journey_snapshot, "sse"
    ts_snap = final_thread_state.get("journeyTrace")
    if isinstance(ts_snap, dict):
        return ts_snap, "thread_state"
    return None, None


def assert_journey_trace(audit_doc: dict[str, Any]) -> None:
    jt = audit_doc.get("journeyTrace")
    if not jt:
        final = audit_doc.get("finalThreadState") or audit_doc.get("final_thread_state") or {}
        jt = final.get("journeyTrace")
    assert jt, "missing journeyTrace"
    assert len(jt.get("steps", [])) == 9
    assert jt.get("current") == "done"
    macro = next(s for s in jt["steps"] if s["id"] == "macro_select")
    assert macro.get("status") in ("done", "skipped")
    assert macro.get("summary")


def record_step(step: int, msg: str, sse: dict[str, Any], ts: dict[str, Any]) -> None:
    pres_events = [
        e.get("data") for e in sse.get("events", [])
        if e.get("type") == "interrupt" and isinstance(e.get("data"), dict)
    ]
    presentation = ts.get("presentation") or (pres_events[-1].get("presentation") if pres_events else None)
    entry = {
        "step": step,
        "user_message": msg[:200],
        "sse_exit": sse.get("exit"),
        "sse_text": sse.get("text", "")[:4000],
        "event_types": sse.get("event_types"),
        "phase": ts.get("phase"),
        "nextNodes": ts.get("nextNodes"),
        "interrupted": ts.get("interrupted"),
        "imageQaReason": ts.get("imageQaReason"),
        "imageQaMetrics": ts.get("imageQaMetrics"),
        "visionUsed": ts.get("visionUsed"),
        "presentation": presentation,
        "macroSchemes_count": len(ts.get("macroSchemes") or []),
        "shotManifest_count": len(ts.get("shotManifest") or []),
        "deliveryGenByKey_keys": list((ts.get("deliveryGenByKey") or {}).keys())[:20],
    }
    audit["steps"].append(entry)
    gate = (ts.get("nextNodes") or [None])[0] or ts.get("phase")
    if gate:
        audit["gates_seen"].append(str(gate))
    print(
        f"[step {step}] phase={ts.get('phase')} gate={ts.get('nextNodes')} "
        f"pres_title={(presentation or {}).get('title') if isinstance(presentation, dict) else None}",
        flush=True,
    )


def main() -> int:
    print("=== 大闸蟹 listing E2E audit ===", flush=True)
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    crab = find_crab_asset(tok)
    audit["crab_asset"] = {"label": crab.get("label"), "url": crab.get("url"), "id": crab.get("id")}

    sid = http("POST", "/sessions", {"title": f"crab-audit-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"craba_{uuid.uuid4().hex[:10]}"
    audit["sessionId"] = sid
    audit["threadId"] = tid

    attachment = {
        "id": f"att-{uuid.uuid4().hex[:8]}",
        "mediaType": "image",
        "sourceKind": "asset",
        "role": "product",
        "label": crab.get("label") or "大闸蟹实拍",
        "url": crab["url"],
    }

    msg = UTTERANCE
    step = 0
    deadline = time.time() + OVERALL_TIMEOUT
    skill_id = "product-visual"
    attachments: list[dict] | None = [attachment]

    while time.time() < deadline:
        step += 1
        sse = sse_turn(tok, sid, tid, msg, attachments=attachments, skill_id=skill_id)
        absorb_journey_updates(sse.get("events") or [])
        attachments = None
        skill_id = None
        ts = thread_state(tok, tid)
        record_step(step, msg, sse, ts)

        if sse.get("exit") == "error":
            audit["status"] = "error"
            break

        if ts.get("phase") == "done" and not ts.get("interrupted"):
            audit["status"] = "done"
            break

        reply = gate_reply(ts)
        if reply:
            msg = reply
            continue

        if not ts.get("interrupted"):
            time.sleep(GEN_POLL_SEC)
            ts2 = thread_state(tok, tid)
            if ts2.get("phase") != ts.get("phase") or ts2.get("nextNodes") != ts.get("nextNodes"):
                continue
            if ts2.get("phase") == "done":
                audit["status"] = "done"
                record_step(step, "(poll)", {"exit": "poll", "text": "", "events": [], "event_types": []}, ts2)
                break
            continue

        audit["status"] = "stuck"
        audit["stuck_at"] = {"phase": ts.get("phase"), "nextNodes": ts.get("nextNodes")}
        break
    else:
        audit["status"] = "timeout"

    audit["final_thread_state"] = thread_state(tok, tid)
    audit["messages"] = agent_messages(tok, sid, tid)

    journey_trace, journey_source = resolve_journey_trace(audit["final_thread_state"])
    if journey_trace is not None:
        audit["journeyTrace"] = journey_trace
    if journey_source:
        audit["journeyTraceSource"] = journey_source

    journey_ok = False
    if audit.get("status") == "done":
        try:
            assert_journey_trace(audit)
            journey_ok = True
            audit["journeyTraceOk"] = True
            jt = audit.get("journeyTrace") or {}
            print(
                f"journeyTrace ok: steps={len(jt.get('steps', []))} "
                f"current={jt.get('current')} source={journey_source}",
                flush=True,
            )
        except AssertionError as exc:
            audit["journeyTraceOk"] = False
            audit["issues"].append(f"journeyTrace: {exc}")
            print(f"journeyTrace assertion failed: {exc}", flush=True)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nAudit saved: {OUT_PATH}", flush=True)
    print(f"status={audit.get('status')} gates={audit.get('gates_seen')}", flush=True)
    if audit.get("status") == "done":
        return 0 if journey_ok else 1
    return 1


def _self_test_assert_journey_trace() -> None:
    step_ids = [
        "image_qa",
        "scheme_draft",
        "macro_select",
        "ssot_persist",
        "shot_plan",
        "topo_preview",
        "generating",
        "delivery",
        "done",
    ]
    steps = [{"id": sid, "status": "done"} for sid in step_ids]
    steps[2]["summary"] = "已选：湖鲜原境风"
    mock = {"journeyTrace": {"current": "done", "steps": steps}}
    assert_journey_trace(mock)


if __name__ == "__main__":
    if os.environ.get("AUDIT_SELF_TEST") == "1":
        _self_test_assert_journey_trace()
        print("assert_journey_trace self-test passed", flush=True)
        raise SystemExit(0)
    raise SystemExit(main())
