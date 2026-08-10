#!/usr/bin/env python3
"""Production E2E — product_visual CVS live image generation.

Automates HITL gates: image QA → plan → scheme select → topo confirm → gen → delivery.

Usage:
  python3 deploy/prod-product-visual-cvs-live.py
  CVS_LIVE_CASE=CVS-01-ecommerce-listing python3 deploy/prod-product-visual-cvs-live.py
  CVS_LIVE_ALL=1 python3 deploy/prod-product-visual-cvs-live.py   # 01 + 02 + 03

Env:
  BASE_URL, PHONE, CODE — auth (defaults match other deploy/*.py)
  PV_SSE_TIMEOUT_SEC — per SSE turn (default 900)
  PV_GEN_POLL_SEC — poll interval while gen runs (default 15)
  PV_OVERALL_TIMEOUT_SEC — max wall clock per case (default 5400)
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

import yaml

ROOT = Path(__file__).resolve().parent.parent
EVAL_PATH = ROOT / "services/agent-runtime/skills/ecommerce-product-visual/eval-cvs-set.yaml"

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT = float(os.environ.get("PV_SSE_TIMEOUT_SEC", "900"))
GEN_POLL_SEC = float(os.environ.get("PV_GEN_POLL_SEC", "15"))
OVERALL_TIMEOUT = float(os.environ.get("PV_OVERALL_TIMEOUT_SEC", "5400"))
CASE_FILTER = os.environ.get("CVS_LIVE_CASE", "CVS-01-ecommerce-listing")
RUN_ALL = os.environ.get("CVS_LIVE_ALL", "").strip().lower() in ("1", "true", "yes")

SCHEME_PREFIX = "__scheme_decision__"
DELIVERY_PREFIX = "__delivery_decision__"

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
        line += f" — {detail[:240]}"
    print(line, flush=True)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sse_turn(
    tok: str,
    sid: str,
    tid: str,
    msg: str,
    *,
    attachments: list[dict] | None = None,
    skill_id: str | None = None,
    user_decision: str | None = None,
    timeout: float = SSE_TIMEOUT,
) -> tuple[str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if attachments:
        body["attachments"] = attachments
    if skill_id:
        body["skillId"] = skill_id
    if user_decision:
        body["userDecision"] = user_decision
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    req = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    parts: list[str] = []
    types: set[str] = set()
    exit_reason = "timeout"
    end = time.time() + timeout
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
                        return "".join(parts), types, "done_marker"
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    et = str(ev.get("type") or "")
                    types.add(et)
                    if et == "text_delta":
                        parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if et == "error":
                        return "".join(parts), types, "error"
                    if et == "done":
                        return "".join(parts), types, "done"
    return "".join(parts), types, exit_reason


def thread_state(tok: str, tid: str) -> dict[str, Any]:
    return http("GET", f"/agent/thread-state?threadId={quote(tid, safe='')}", t=tok).get("data") or {}


def gate_snapshot(ts: dict[str, Any]) -> tuple[str | None, list[str], bool]:
    phase = ts.get("phase")
    phase_str = str(phase) if phase is not None else None
    next_nodes = [str(n) for n in (ts.get("nextNodes") or [])]
    return phase_str, next_nodes, bool(ts.get("interrupted"))


def default_scheme_selections(plan: dict[str, Any]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
        if not type_id or not schemes:
            continue
        recommended = [str(s["scheme_id"]) for s in schemes if s.get("recommended")]
        if len(schemes) == 1:
            out[type_id] = [str(schemes[0]["scheme_id"])]
        elif recommended:
            out[type_id] = recommended
        else:
            out[type_id] = [str(schemes[0]["scheme_id"])]
    return out


def default_delivery_selections(plan: dict[str, Any], gen_by_key: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
        selected_ids = [str(s) for s in (image_type.get("selected_scheme_ids") or []) if str(s).strip()]
        candidate_ids = [sid for sid in selected_ids if gen_by_key.get(f"{type_id}__{sid}", {}).get("url")]
        fallback_ids = candidate_ids or [
            str(s.get("scheme_id"))
            for s in schemes
            if str(s.get("scheme_id") or "").strip() and gen_by_key.get(f"{type_id}__{s.get('scheme_id')}", {}).get("url")
        ]
        pool = fallback_ids or selected_ids or [str(s.get("scheme_id")) for s in schemes if s.get("scheme_id")]
        if not pool:
            continue
        recommended = [str(s["scheme_id"]) for s in schemes if s.get("recommended")]
        pick = next((sid for sid in recommended if sid in pool), pool[0])
        out[type_id] = pick
    return out


def gate_message(ts: dict[str, Any]) -> str | None:
    phase, next_nodes, interrupted = gate_snapshot(ts)
    gate = next_nodes[0] if next_nodes else None
    active = gate or phase

    if active == "await_image_qa" and interrupted:
        return "生成标准白底图"

    if active == "await_scheme_select" and interrupted:
        plan = ts.get("productVisualPlan") or {}
        if not plan.get("image_types"):
            return None
        selections = default_scheme_selections(plan)
        payload = json.dumps({"action": "confirm_schemes", "selections": selections}, ensure_ascii=False)
        return f"{SCHEME_PREFIX}{payload}"

    if active == "await_topo" and interrupted:
        return "确认出图"

    if active == "await_delivery_confirm" and interrupted:
        plan = ts.get("productVisualPlan") or {}
        gen_by_key = ts.get("deliveryGenByKey") or {}
        selections = default_delivery_selections(plan, gen_by_key)
        if not selections:
            return None
        missing = [tid for tid, sid in selections.items() if not gen_by_key.get(f"{tid}__{sid}", {}).get("url")]
        if missing:
            return None
        payload = json.dumps({"action": "confirm_delivery", "selections": selections}, ensure_ascii=False)
        return f"{DELIVERY_PREFIX}{payload}"

    return None


def product_attachment() -> dict[str, Any]:
    return {
        "id": f"pv-live-{uuid.uuid4().hex[:8]}",
        "mediaType": "image",
        "sourceKind": "upload",
        "role": "product",
        "label": "product.jpg",
        "url": os.environ.get("PV_PRODUCT_URL", "https://picsum.photos/seed/lnkpi-pv-live/800/800"),
    }


def load_cases() -> list[dict[str, Any]]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    cases = list(doc.get("cases") or [])
    if RUN_ALL:
        return cases
    return [c for c in cases if c["id"] == CASE_FILTER]


def run_case(tok: str, case: dict[str, Any]) -> bool:
    case_id = case["id"]
    print(f"\n--- {case_id} live E2E ---", flush=True)
    sid = http("POST", "/sessions", {"title": f"pv-live-{case_id}-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"pvlive_{uuid.uuid4().hex[:10]}"
    utterance = str(case.get("utterance") or "")
    attachment = product_attachment()
    deadline = time.time() + OVERALL_TIMEOUT
    step = 0
    msg = utterance
    skill_id = "product-visual"
    attachments: list[dict] | None = [attachment]

    while time.time() < deadline:
        step += 1
        print(f"  [step {step}] SSE: {msg[:80]}{'…' if len(msg) > 80 else ''}", flush=True)
        text, types, reason = sse_turn(
            tok,
            sid,
            tid,
            msg,
            attachments=attachments,
            skill_id=skill_id if step == 1 else None,
        )
        attachments = None
        skill_id = None
        if "error" in types:
            record(f"{case_id} no SSE error", False, f"reason={reason} text={text[:120]}")
            return False

        ts = thread_state(tok, tid)
        phase, next_nodes, interrupted = gate_snapshot(ts)
        flow = ts.get("flowMode") or ts.get("flow_mode")
        print(
            f"  → phase={phase} interrupted={interrupted} next={next_nodes} flow={flow}",
            flush=True,
        )

        if phase == "done" and not interrupted:
            plan = ts.get("productVisualPlan") or {}
            type_ids = [
                str(t.get("type_id"))
                for t in (plan.get("image_types") or [])
                if isinstance(t, dict) and t.get("type_id")
            ]
            gen_by_key = ts.get("deliveryGenByKey") or {}
            urls = sum(1 for v in gen_by_key.values() if isinstance(v, dict) and v.get("url"))
            record(
                f"{case_id} flow=product_visual",
                flow == "product_visual",
                f"flow={flow}",
            )
            record(
                f"{case_id} delivery done with gen urls",
                urls >= max(1, len(type_ids)) if type_ids else urls >= 1,
                f"types={len(type_ids)} urls={urls}",
            )
            return flow == "product_visual" and (urls >= 1)

        reply = gate_message(ts)
        if reply:
            msg = reply
            continue

        if phase == "await_delivery_confirm" and interrupted:
            plan = ts.get("productVisualPlan") or {}
            gen_by_key = ts.get("deliveryGenByKey") or {}
            type_ids = [
                str(t.get("type_id"))
                for t in (plan.get("image_types") or [])
                if isinstance(t, dict) and t.get("type_id")
            ]
            urls = [
                tid
                for tid in type_ids
                for sid in [default_delivery_selections(plan, gen_by_key).get(tid, "")]
                if sid and gen_by_key.get(f"{tid}__{sid}", {}).get("url")
            ]
            record(
                f"{case_id} reached delivery gate",
                True,
                f"types={len(type_ids)} with_url={len(urls)}",
            )
            record(
                f"{case_id} all types gen success",
                len(urls) >= len(type_ids) and len(type_ids) > 0,
                f"missing={set(type_ids) - set(urls)} keys={list(gen_by_key.keys())[:8]}",
            )
            return len(urls) >= len(type_ids) and len(type_ids) > 0

        if not interrupted:
            # Gen / plan in progress — poll until gate or done
            time.sleep(GEN_POLL_SEC)
            continue

        record(f"{case_id} unrecognized gate", False, f"phase={phase} next={next_nodes} text={text[:100]}")
        return False

    record(f"{case_id} overall timeout", False, f">{OVERALL_TIMEOUT}s")
    return False


def main() -> int:
    print("=== product_visual CVS live E2E ===")
    print(f"BASE={BASE}  cases={'ALL' if RUN_ALL else CASE_FILTER}\n", flush=True)

    health = http("GET", "/health")
    record("health", bool(health.get("ok")), str(health)[:100])

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]

    cases = load_cases()
    if not cases:
        record("load CVS cases", False, "no cases matched filter")
        print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
        return 1

    results: list[bool] = []
    for case in cases:
        results.append(run_case(tok, case))

    record("all selected CVS cases passed", all(results), f"{sum(results)}/{len(results)}")
    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
