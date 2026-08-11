#!/usr/bin/env python3
"""Production E2E — product_visual CVS v2 (prose SSOT + macro/shot gates).

Automates v2 HITL path:
  image QA → dialog_draft → macro select → SSOT → shot confirm → topo → gen → shot delivery

Usage:
  python3 deploy/prod-product-visual-cvs-v2-live.py
  CVS_V2_LIVE_CASE=CVS-02-v2 python3 deploy/prod-product-visual-cvs-v2-live.py
  CVS_V2_LIVE_ALL=1 python3 deploy/prod-product-visual-cvs-v2-live.py
  CVS_V2_GATE_ONLY=1 python3 deploy/prod-product-visual-cvs-v2-live.py   # stop at await_topo

Prerequisites (production):
  1. Deploy build includes v2 graph + frontend macro/shot gates
  2. Runtime env: LNKPI_PRODUCT_VISUAL_SCHEME_V2=true  (restart agent-runtime)
  3. Real persisted canvas session recommended for browser UAT; this script creates its own session

Env:
  BASE_URL, PHONE, CODE — auth (defaults match other deploy/*.py)
  PV_PRODUCT_URL — product image URL for attachment (default picsum seed)
  PV_SSE_TIMEOUT_SEC — per SSE turn (default 900)
  PV_GEN_POLL_SEC — poll interval while gen runs (default 15)
  PV_OVERALL_TIMEOUT_SEC — max wall clock per case (default 5400)
  CVS_V2_GATE_ONLY — if 1/true, pass when await_topo reached (skip gen wait)
  REQUIRE_V2 — if 1/true (default), fail when legacy await_scheme_select appears
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
EVAL_PATH = ROOT / "services/agent-runtime/skills/ecommerce-product-visual/eval-cvs-set-v2.yaml"

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT = float(os.environ.get("PV_SSE_TIMEOUT_SEC", "900"))
GEN_POLL_SEC = float(os.environ.get("PV_GEN_POLL_SEC", "15"))
OVERALL_TIMEOUT = float(os.environ.get("PV_OVERALL_TIMEOUT_SEC", "5400"))
CASE_FILTER = os.environ.get("CVS_V2_LIVE_CASE", "CVS-02-v2")
RUN_ALL = os.environ.get("CVS_V2_LIVE_ALL", "").strip().lower() in ("1", "true", "yes")
GATE_ONLY = os.environ.get("CVS_V2_GATE_ONLY", "").strip().lower() in ("1", "true", "yes")
REQUIRE_V2 = os.environ.get("REQUIRE_V2", "1").strip().lower() in ("1", "true", "yes")

MACRO_PREFIX = "__macro_scheme_decision__"
DELIVERY_PREFIX = "__delivery_decision__"

PASS = FAIL = 0
V2_GATES_SEEN: set[str] = set()


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
        line += f" — {detail[:280]}"
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
                    if et == "interrupt":
                        node = str((ev.get("data") or {}).get("node") or "")
                        if node:
                            V2_GATES_SEEN.add(node)
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


def default_macro_selection(schemes: list[dict[str, Any]], case: dict[str, Any]) -> list[str]:
    forced = case.get("assert_selected_macros")
    if isinstance(forced, list) and forced:
        return [str(x) for x in forced]
    if len(schemes) <= 1:
        return [str(schemes[0]["id"])] if schemes else []
    recommended = [str(s["id"]) for s in schemes if s.get("recommended")]
    if recommended:
        return recommended[:2]
    return [str(schemes[0]["id"])]


def default_shot_delivery_selections(
    shots: list[dict[str, Any]],
    gen_by_key: dict[str, Any],
) -> dict[str, str]:
    out: dict[str, str] = {}
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        shot_id = str(shot.get("shot_id") or "").strip()
        if not shot_id:
            continue
        variants = max(1, min(3, int(shot.get("variant_count") or 1)))
        keys = [shot_id] if variants == 1 else [f"{shot_id}__v{v}" for v in range(1, variants + 1)]
        ready = [k for k in keys if gen_by_key.get(k, {}).get("url")]
        if ready:
            out[shot_id] = ready[0]
    return out


def assert_v2_checkpoint(case_id: str, ts: dict[str, Any], *, strict: bool = False) -> bool:
    """Validate v2 thread-state fields when available."""
    ok = True
    v2_flag = ts.get("productVisualSchemeV2")
    if v2_flag is not None:
        record(f"{case_id} productVisualSchemeV2", bool(v2_flag), f"flag={v2_flag}")
        ok = ok and bool(v2_flag)
    elif strict:
        record(f"{case_id} productVisualSchemeV2", False, "missing in thread-state")
        ok = False

    macros = ts.get("macroSchemes") or []
    shots = ts.get("shotManifest") or []
    if macros:
        record(f"{case_id} macroSchemes present", True, f"count={len(macros)}")
    if shots:
        type_ids = sorted({str(s.get("type_id") or "") for s in shots if isinstance(s, dict)})
        record(f"{case_id} shotManifest present", True, f"shots={len(shots)} types={type_ids}")
    return ok


def gate_message(ts: dict[str, Any], case: dict[str, Any]) -> str | None:
    phase, next_nodes, interrupted = gate_snapshot(ts)
    gate = next_nodes[0] if next_nodes else None
    active = gate or phase

    if active == "await_image_qa" and interrupted:
        return "就用这张图，继续"

    if active == "await_macro_scheme_select" and (interrupted or ts.get("macroSchemes")):
        schemes = ts.get("macroSchemes") or []
        if not schemes:
            return None
        selected = default_macro_selection(schemes, case)
        payload = json.dumps({"action": "confirm", "selected_ids": selected}, ensure_ascii=False)
        return f"{MACRO_PREFIX}{payload}"

    if active == "await_shot_topo_confirm" and (interrupted or ts.get("shotManifest")):
        return "确认构图并开始出图"

    if active == "await_shot_confirm" and (interrupted or ts.get("shotManifest")):
        return "确认出图"

    if active == "await_topo" and (interrupted or phase == "await_topo"):
        return "确认出图"

    if active == "await_delivery_confirm" and interrupted:
        shots = ts.get("shotManifest") or []
        gen_by_key = ts.get("deliveryGenByKey") or {}
        if shots:
            selections = default_shot_delivery_selections(shots, gen_by_key)
            if not selections:
                return None
            missing = [sid for sid, vk in selections.items() if not gen_by_key.get(vk, {}).get("url")]
            if missing:
                return None
            payload = json.dumps({"action": "confirm_delivery", "selections": selections}, ensure_ascii=False)
            return f"{DELIVERY_PREFIX}{payload}"
        # legacy fallback if server still on v1 delivery
        plan = ts.get("productVisualPlan") or {}
        type_ids = [
            str(t.get("type_id"))
            for t in (plan.get("image_types") or [])
            if isinstance(t, dict) and t.get("type_id")
        ]
        if not type_ids:
            return None
        selections: dict[str, str] = {}
        for type_id in type_ids:
            for key, val in gen_by_key.items():
                if key.startswith(f"{type_id}__") and isinstance(val, dict) and val.get("url"):
                    selections[type_id] = key.split("__", 1)[-1]
                    break
        if not selections:
            return None
        payload = json.dumps({"action": "confirm_delivery", "selections": selections}, ensure_ascii=False)
        return f"{DELIVERY_PREFIX}{payload}"

    return None


def product_attachment() -> dict[str, Any]:
    return {
        "id": f"pv2-live-{uuid.uuid4().hex[:8]}",
        "mediaType": "image",
        "sourceKind": "upload",
        "role": "product",
        "label": "product.jpg",
        "url": os.environ.get("PV_PRODUCT_URL", "https://picsum.photos/seed/lnkpi-pv2-live/800/800"),
    }


def expand_v2_cases(raw_cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {c["id"]: c for c in raw_cases}
    expanded: list[dict[str, Any]] = []
    for case in raw_cases:
        parent_id = case.get("parent_id")
        if parent_id and parent_id in by_id:
            merged = {**by_id[parent_id], **case}
            merged["id"] = case["id"]
            expanded.append(merged)
        else:
            expanded.append(case)
    return expanded


def load_cases() -> list[dict[str, Any]]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    cases = expand_v2_cases(list(doc.get("cases") or []))
    if RUN_ALL:
        return cases
    matched = [c for c in cases if c["id"] == CASE_FILTER]
    return matched


def detect_legacy_gate(case_id: str, ts: dict[str, Any]) -> bool:
    _, next_nodes, _ = gate_snapshot(ts)
    gate = next_nodes[0] if next_nodes else None
    phase = ts.get("phase")
    legacy = gate == "await_scheme_select" or phase == "await_scheme_select"
    if legacy and REQUIRE_V2:
        record(
            f"{case_id} v2 enabled on server",
            False,
            "got legacy await_scheme_select — set LNKPI_PRODUCT_VISUAL_SCHEME_V2=true and redeploy runtime",
        )
    return legacy


def run_case(tok: str, case: dict[str, Any]) -> bool:
    case_id = case["id"]
    print(f"\n--- {case_id} v2 live E2E ---", flush=True)
    sid = http("POST", "/sessions", {"title": f"pv2-live-{case_id}-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"pv2live_{uuid.uuid4().hex[:10]}"
    utterance = str(case.get("utterance") or "")
    attachment = product_attachment()
    deadline = time.time() + OVERALL_TIMEOUT
    step = 0
    msg = utterance
    skill_id = "product-visual"
    attachments: list[dict] | None = [attachment]
    saw_macro = saw_shots = saw_topo = False

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
        gate = next_nodes[0] if next_nodes else None
        print(
            f"  → phase={phase} interrupted={interrupted} next={next_nodes} flow={flow} "
            f"v2={ts.get('productVisualSchemeV2')} macros={len(ts.get('macroSchemes') or [])} "
            f"shots={len(ts.get('shotManifest') or [])}",
            flush=True,
        )

        if detect_legacy_gate(case_id, ts):
            return False

        if gate == "await_macro_scheme_select" or ts.get("macroSchemes"):
            saw_macro = True
        if ts.get("shotManifest"):
            saw_shots = True
        if gate == "await_topo" or phase == "await_topo" or gate == "await_shot_topo_confirm":
            saw_topo = True

        assert_v2_checkpoint(case_id, ts)

        if GATE_ONLY and saw_topo and gate in ("await_topo", "await_shot_topo_confirm") and interrupted:
            record(
                f"{case_id} GATE_ONLY reached topo gate",
                True,
                f"gate={gate} macros={saw_macro} shots={saw_shots}",
            )
            record(f"{case_id} v2 macro gate seen", saw_macro or len(ts.get("macroSchemes") or []) > 0, "")
            record(f"{case_id} v2 shot manifest seen", saw_shots or bool(ts.get("shotManifest")), "")
            return saw_shots or bool(ts.get("shotManifest"))

        if phase == "done" and not interrupted:
            flow_ok = flow == "product_visual"
            # Premature done before v2 gates — usually legacy runtime or remedy abort
            if REQUIRE_V2 and not saw_shots and step <= 4:
                record(
                    f"{case_id} v2 path not reached (premature done)",
                    False,
                    f"step={step} gates_seen={sorted(V2_GATES_SEEN)} v2={ts.get('productVisualSchemeV2')} "
                    f"text={text[:120]}",
                )
                return False

            record(f"{case_id} flow=product_visual", flow_ok, f"flow={flow}")

            shots = ts.get("shotManifest") or []
            gen_by_key = ts.get("deliveryGenByKey") or {}
            if shots:
                selections = default_shot_delivery_selections(shots, gen_by_key)
                urls = sum(1 for vk in selections.values() if gen_by_key.get(vk, {}).get("url"))
                record(
                    f"{case_id} v2 shot delivery done",
                    urls >= len(selections) and urls >= 1,
                    f"shots={len(shots)} finalized={urls}",
                )
                return flow_ok and urls >= 1

            plan = ts.get("productVisualPlan") or {}
            type_ids = [
                str(t.get("type_id"))
                for t in (plan.get("image_types") or [])
                if isinstance(t, dict) and t.get("type_id")
            ]
            urls = sum(1 for v in gen_by_key.values() if isinstance(v, dict) and v.get("url"))
            record(
                f"{case_id} delivery done with gen urls",
                urls >= max(1, len(type_ids)) if type_ids else urls >= 1,
                f"types={len(type_ids)} urls={urls}",
            )
            return flow_ok and urls >= 1

        reply = gate_message(ts, case)
        if reply:
            msg = reply
            continue

        if phase == "await_delivery_confirm" and interrupted:
            shots = ts.get("shotManifest") or []
            gen_by_key = ts.get("deliveryGenByKey") or {}
            if shots:
                selections = default_shot_delivery_selections(shots, gen_by_key)
                ready = [
                    sid
                    for sid, vk in selections.items()
                    if gen_by_key.get(vk, {}).get("url")
                ]
                record(
                    f"{case_id} reached v2 delivery gate",
                    True,
                    f"shots={len(shots)} ready={len(ready)}",
                )
                record(
                    f"{case_id} all shots gen success",
                    len(ready) >= len(selections) and len(selections) > 0,
                    f"missing={set(selections) - set(ready)} keys={list(gen_by_key.keys())[:10]}",
                )
                return len(ready) >= len(selections) and len(selections) > 0

            plan = ts.get("productVisualPlan") or {}
            type_ids = [
                str(t.get("type_id"))
                for t in (plan.get("image_types") or [])
                if isinstance(t, dict) and t.get("type_id")
            ]
            gen_by_key = ts.get("deliveryGenByKey") or {}
            urls = sum(1 for v in gen_by_key.values() if isinstance(v, dict) and v.get("url"))
            record(f"{case_id} reached delivery gate (legacy plan)", True, f"urls={urls}")
            return urls >= max(1, len(type_ids))

        if not interrupted:
            time.sleep(GEN_POLL_SEC)
            continue

        record(
            f"{case_id} unrecognized gate",
            False,
            f"phase={phase} next={next_nodes} gates_seen={sorted(V2_GATES_SEEN)} text={text[:100]}",
        )
        return False

    record(f"{case_id} overall timeout", False, f">{OVERALL_TIMEOUT}s gates_seen={sorted(V2_GATES_SEEN)}")
    return False


def print_enable_v2_hint() -> None:
    print(
        "\n--- Enable v2 on production (before browser UAT) ---\n"
        "1. SSH to CVM, edit /opt/lnkpi/.env:\n"
        "     LNKPI_PRODUCT_VISUAL_SCHEME_V2=true\n"
        "2. Restart agent-runtime:\n"
        "     docker compose -f deploy/docker-compose.prod.yml restart lnkpi-agent-runtime\n"
        "   (or: systemctl restart lnkpi-agent-runtime)\n"
        "3. Verify thread-state shows productVisualSchemeV2 after QA pass\n"
        "4. Browser UAT: docs/superpowers/specs/2026-08-11-product-visual-phase2-scheme-ssot-uat.md\n"
        "   Use persisted cms session (NOT demo-*), skill「实物产品视觉出图」, CVS-02 utterance\n",
        flush=True,
    )


def main() -> int:
    print("=== product_visual CVS v2 live E2E ===")
    print(
        f"BASE={BASE}  cases={'ALL' if RUN_ALL else CASE_FILTER}  "
        f"GATE_ONLY={GATE_ONLY}  REQUIRE_V2={REQUIRE_V2}\n",
        flush=True,
    )

    health = http("GET", "/health")
    record("health", bool(health.get("ok")), str(health)[:100])

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]

    cases = load_cases()
    if not cases:
        record("load CVS v2 cases", False, "no cases matched filter")
        print_enable_v2_hint()
        print(f"\n=== Summary PASS={PASS} FAIL={FAIL} ===")
        return 1

    results: list[bool] = []
    for case in cases:
        results.append(run_case(tok, case))

    record("all selected CVS v2 cases passed", all(results), f"{sum(results)}/{len(results)}")
    if FAIL > 0 or GATE_ONLY:
        print_enable_v2_hint()
    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} gates_seen={sorted(V2_GATES_SEEN)} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
