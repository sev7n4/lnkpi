#!/usr/bin/env python3
"""Production 2e.3 V1 oral-skeleton verify — E14–E18.

Does not replace V2/H8/2e.1 harnesses. Does not confirm or charge.

Usage:
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 \\
    python3.11 deploy/prod-phase-2e3-v1-verify.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from http.client import IncompleteRead
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT = float(os.environ.get("V1_SSE_TIMEOUT", "240"))
GOLD = (
    "我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock"
)
CHIP_ID = re.compile(r"^@?I\d+$", re.I)

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
        line += f" — {detail[:300]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(
        f"{API}{p}",
        data=None if b is None else json.dumps(b).encode(),
        headers=h,
        method=m,
    )
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read() or b"{}")


def sse_chat(tok: str, sid: str, msg: str, tid: str, *, model: str | None = None, timeout: float = 240) -> dict[str, Any]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    if model:
        body["model"] = model
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"2e3_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    tool_names: list[str] = []
    tool_args: list[dict[str, Any]] = []
    routes: list[dict] = []
    canvas_actions: list[dict] = []
    parts: list[str] = []
    saw_done = False
    end = time.time() + timeout
    with urlopen(r, timeout=timeout + 30) as resp:
        buf = ""
        try:
            while time.time() < end:
                try:
                    chunk = resp.read(4096)
                except IncompleteRead as exc:
                    if exc.partial:
                        buf += exc.partial.decode(errors="replace")
                    if saw_done:
                        break
                    time.sleep(0.2)
                    continue
                if not chunk:
                    if saw_done:
                        break
                    time.sleep(0.2)
                    continue
                buf += chunk.decode(errors="replace")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    for line in block.splitlines():
                        if not line.startswith("data:"):
                            continue
                        pl = line[5:].strip()
                        if pl == "[DONE]":
                            saw_done = True
                            break
                        try:
                            ev = json.loads(pl)
                        except json.JSONDecodeError:
                            continue
                        et = str(ev.get("type") or "")
                        data = ev.get("data") or {}
                        if et == "text_delta":
                            parts.append(str(data.get("text") or ""))
                        if et == "text_replace":
                            parts = [str(data.get("text") or "")]
                        if et == "tool_call":
                            name = str(
                                data.get("name") or data.get("tool") or data.get("toolName") or ""
                            )
                            if name:
                                tool_names.append(name)
                            args = data.get("args") or data.get("arguments") or {}
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except json.JSONDecodeError:
                                    args = {"_raw": args}
                            if isinstance(args, dict):
                                tool_args.append({"name": name, "args": args})
                        if et == "route_decision":
                            rd = data.get("route_decision") if isinstance(data, dict) else None
                            if isinstance(rd, dict):
                                routes.append(rd)
                            elif isinstance(data, dict):
                                routes.append(data)
                        if et == "canvas_action" and isinstance(data, dict):
                            canvas_actions.append(data)
                        if et in ("done", "error"):
                            if et == "error":
                                parts.append(f"[ERROR: {data}]")
                            saw_done = True
                            break
                    if saw_done:
                        break
                if saw_done:
                    break
        except IncompleteRead:
            pass
    text = parts[-1] if len(parts) == 1 and parts[0] else "".join(parts)
    flow = routes[-1].get("flow_mode") if routes else None
    pending = False
    billed = False
    connect_actions = 0
    for a in canvas_actions:
        payload = a.get("payload") or a.get("data") or a
        if not isinstance(payload, dict):
            continue
        kind = str(a.get("type") or payload.get("type") or payload.get("action") or "")
        if "connect" in kind.lower() or kind == "connect_nodes":
            connect_actions += 1
        inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        st = str(inner.get("status") or payload.get("status") or "")
        if st == "pending_confirm":
            pending = True
        if st in ("completed", "running", "generating", "success"):
            billed = True
    return {
        "text": text,
        "tools": tool_names,
        "tool_args": tool_args,
        "flow_mode": flow,
        "pending_via_actions": pending,
        "billed_via_actions": billed,
        "connect_actions": connect_actions,
        "no_run_tools": "run_image_generation" not in tool_names
        and "run_video_generation" not in tool_names,
        "saw_done": saw_done,
    }


def load_canvas(tok: str, sid: str) -> dict[str, Any]:
    sess = http("GET", f"/sessions/{sid}", t=tok)
    data = sess.get("data") or sess
    raw = data.get("canvasData") or data.get("canvas") or "{}"
    if isinstance(raw, str):
        return json.loads(raw)
    return raw if isinstance(raw, dict) else {}


def _node_kind(node: dict[str, Any]) -> str:
    nid = str(node.get("id") or "")
    ntype = str(node.get("type") or "")
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    media = str(data.get("mediaType") or data.get("media_type") or "")
    blob = f"{nid}|{ntype}|{media}".lower()
    if blob.startswith("image-") or "image" in blob:
        return "image"
    if blob.startswith("video-") or "video" in blob:
        return "video"
    return ""


def _prompt_of(node: dict[str, Any]) -> str:
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    for key in ("prompt", "text", "content"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _chip_connected(tool_args: list[dict[str, Any]]) -> bool:
    for item in tool_args:
        if item.get("name") != "connect_nodes":
            continue
        dumped = json.dumps(item.get("args") or {}, ensure_ascii=False)
        if "@I" in dumped or CHIP_ID.search(dumped):
            return True
        args = item.get("args") or {}
        edges = args.get("edges") or args.get("connections") or []
        if isinstance(edges, list):
            for e in edges:
                if not isinstance(e, dict):
                    continue
                for key in ("source", "target", "from", "to"):
                    if CHIP_ID.match(str(e.get(key) or "").strip()):
                        return True
    return False


def main() -> int:
    print("=== 2e.3 V1 oral-skeleton production verify ===")
    print(f"BASE={BASE}\n")
    health = http("GET", "/health")
    record("Nest health", bool(health.get("ok")), str(health)[:120])
    rt = http("GET", "/agent/runtime-health")
    record("Runtime health", bool((rt.get("data") or {}).get("ok")), str((rt.get("data") or {}).get("latencyMs")))
    login = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})
    tok = (login.get("data") or {}).get("token")
    record("Login", bool(tok), f"phone={PHONE}")
    if not tok:
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    model = os.environ.get("HARNESS_MODEL", "").strip() or None
    if not model:
        boot = http("GET", "/provider/bootstrap", t=tok)
        model = ((boot.get("data") or {}).get("preferences") or {}).get("defaultTextModel") or None
    record("Agent model", bool(model), str(model))
    created = http("POST", "/agent/canvas/create", {"title": f"v1-skel-{uuid.uuid4().hex[:6]}"}, tok)
    sid = (created.get("data") or {}).get("id") or (created.get("data") or {}).get("sessionId")
    record("Canvas session", bool(sid), str(sid))
    if not sid:
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    try:
        r = sse_chat(tok, str(sid), GOLD, f"t_v1_{uuid.uuid4().hex[:8]}", model=model, timeout=SSE_TIMEOUT)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
        record("E14 gold turn completes", False, str(exc))
        print(f"\nPASS={PASS} FAIL={FAIL}")
        return 1
    tools = r["tools"]
    record("E14 flow_mode=canvas_agent", r["flow_mode"] == "canvas_agent", f"flow={r['flow_mode']}")
    record(
        "E16 tools include upsert_media_node + connect_nodes + propose_generation",
        "upsert_media_node" in tools and "connect_nodes" in tools and "propose_generation" in tools,
        f"tools={tools[:16]}",
    )
    record("E16 no run_*", r["no_run_tools"], f"tools={tools[:12]}")
    stole = (
        ("import_workflow" in tools or "instantiate_workflow_template" in tools)
        and ("connect_nodes" not in tools or "upsert_media_node" not in tools)
    )
    record(
        "E16 import/instantiate are not the pass",
        not stole,
        f"tools={tools[:16]}",
    )
    time.sleep(1.0)
    canvas = load_canvas(tok, str(sid))
    nodes = [n for n in (canvas.get("nodes") or []) if isinstance(n, dict)]
    media = [n for n in nodes if _node_kind(n) in ("image", "video")]
    kinds = {_node_kind(n) for n in media}
    edges = canvas.get("edges") or []
    record("E15 >=2 media nodes", len(media) >= 2, f"media={len(media)} ids={[n.get('id') for n in media][:6]}")
    chain = False
    if "image" in kinds and "video" in kinds:
        chain = True
    else:
        ids_by_kind = {k: {str(n.get("id")) for n in media if _node_kind(n) == k} for k in ("image", "video")}
        for e in edges:
            if not isinstance(e, dict):
                continue
            src = str(e.get("source") or e.get("from") or "")
            dst = str(e.get("target") or e.get("to") or "")
            if src in ids_by_kind["image"] and dst in ids_by_kind["video"]:
                chain = True
    record("E15 covers image and video", chain or ({"image", "video"} <= kinds), f"kinds={sorted(kinds)}")
    connect_ok = "connect_nodes" in tools and (len(edges) >= 1 or r["connect_actions"] >= 1)
    record(
        "E15 >=1 canvas edge from connect_nodes",
        connect_ok,
        f"edges={len(edges)} connect_actions={r['connect_actions']} tools_has_connect={'connect_nodes' in tools}",
    )
    gen_nodes = [n for n in media if _node_kind(n) in ("image", "video")]
    prompts_ok = bool(gen_nodes) and all(_prompt_of(n) for n in gen_nodes)
    record("E15 non-empty dock prompt", prompts_ok, f"empty={[n.get('id') for n in gen_nodes if not _prompt_of(n)][:4]}")
    pending = [
        str(n.get("id"))
        for n in gen_nodes
        if str((n.get("data") or {}).get("status") or "") == "pending_confirm"
    ]
    record(
        "E17 pending_confirm, no billed complete",
        (bool(pending) or r["pending_via_actions"]) and not r["billed_via_actions"],
        f"pending={pending[:4]} billed={r['billed_via_actions']}",
    )
    atomic = "基于引用内容" in (r["text"] or "") or str(r["flow_mode"] or "").startswith("atomic")
    record(
        "E18 no atomic card; chips not edges",
        (not atomic) and (not _chip_connected(r["tool_args"])),
        f"flow={r['flow_mode']} atomic_text={atomic} chip_edge={_chip_connected(r['tool_args'])}",
    )
    print(f"\nPASS={PASS} FAIL={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        raise SystemExit(2)
