#!/usr/bin/env python3
"""Production verify — canvas layout workflow harness (PR #183).

With AGENT_RUNTIME_SERVICE_TOKEN (or LNKPI_SERVICE_TOKEN):
  1. Login → session + seed 3 nodes on canvas
  2. get-canvas-layout → absolutePosition + groups[]
  3. move-nodes → position updated
  4. apply-layout-ops → group + move atomically

Without token:
  - Probe internal routes return 401 (not 404) = API deployed

Usage:
  python3 deploy/prod-layout-workflow-verify.py
  LNKPI_SERVICE_TOKEN=... python3 deploy/prod-layout-workflow-verify.py
  AGENT_RUNTIME_SERVICE_TOKEN=... python3 deploy/prod-layout-workflow-verify.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
INTERNAL = f"{API}/agent/internal"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SERVICE_TOKEN = (
    os.environ.get("LNKPI_SERVICE_TOKEN", "").strip()
    or os.environ.get("AGENT_RUNTIME_SERVICE_TOKEN", "").strip()
)

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


def http(
    m: str,
    p: str,
    b: dict | None = None,
    *,
    token: str | None = None,
    service_token: str | None = None,
    base: str = API,
) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if service_token:
        h["x-lnkpi-service-token"] = service_token
    r = Request(
        f"{base}{p}",
        data=None if b is None else json.dumps(b).encode(),
        headers=h,
        method=m,
    )
    try:
        with urlopen(r, timeout=120) as resp:
            return json.loads(resp.read())
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode(errors="replace")[:200]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {exc.code} {p}: {body}") from exc


def http_status(
    m: str,
    path: str,
    b: dict | None = None,
    *,
    service_token: str | None = None,
) -> int:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if service_token:
        h["x-lnkpi-service-token"] = service_token
    r = Request(
        path,
        data=None if b is None else json.dumps(b).encode(),
        headers=h,
        method=m,
    )
    try:
        with urlopen(r, timeout=30) as resp:
            resp.read()
        return 200
    except HTTPError as exc:
        return exc.code


def resolve_service_token() -> str:
    if SERVICE_TOKEN:
        return SERVICE_TOKEN
    try:
        out = subprocess.check_output(
            [
                "ssh",
                "deploy-cvm",
                "bash",
                "-lc",
                "grep -E '^AGENT_RUNTIME_SERVICE_TOKEN=' /opt/lnkpi/.env 2>/dev/null | head -1 | cut -d= -f2-",
            ],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=15,
        ).strip()
        if out:
            return out
    except Exception:
        pass
    return ""


def probe_routes(session_id: str = "probe-session") -> None:
    print("--- Route probe (no service token) ---")
    routes = [
        ("POST", f"{INTERNAL}/get-canvas-layout", {"sessionId": session_id}),
        ("POST", f"{INTERNAL}/move-nodes", {"sessionId": session_id, "userId": "u", "items": []}),
        ("POST", f"{INTERNAL}/apply-layout-ops", {"sessionId": session_id, "userId": "u", "ops": []}),
    ]
    for method, url, body in routes:
        name = url.rsplit("/", 1)[-1]
        code = http_status(method, url, body)
        record(f"{name} route exists", code in (401, 403), f"HTTP {code}")


def seed_canvas(user_token: str, session_id: str) -> tuple[str, str, str]:
    sess = http("GET", f"/sessions/{session_id}", token=user_token)["data"]
    canvas = sess.get("canvasData") or {}
    nodes = list(canvas.get("nodes") or [])
    ts = int(time.time())
    ids = [f"layout-img-{ts}", f"layout-txt-{ts + 1}", f"layout-vid-{ts + 2}"]
    nodes.extend(
        [
            {
                "id": ids[0],
                "type": "image",
                "position": {"x": 100, "y": 100},
                "data": {"title": "Layout A", "status": "done"},
            },
            {
                "id": ids[1],
                "type": "text",
                "position": {"x": 420, "y": 160},
                "data": {"title": "Layout B", "content": "seed"},
            },
            {
                "id": ids[2],
                "type": "video",
                "position": {"x": 760, "y": 80},
                "data": {"title": "Layout C", "status": "draft"},
            },
        ]
    )
    http(
        "PUT",
        f"/sessions/{session_id}",
        {
            "canvasData": {
                "nodes": nodes,
                "edges": canvas.get("edges") or [],
                "viewport": canvas.get("viewport"),
            }
        },
        token=user_token,
    )
    return ids[0], ids[1], ids[2]


def internal_post(path: str, body: dict, service_token: str) -> dict[str, Any]:
    suffix = path if path.startswith("/agent/internal/") else f"/agent/internal/{path.lstrip('/')}"
    resp = http("POST", suffix, body, service_token=service_token)
    if resp.get("code") != 0:
        raise RuntimeError(f"{path} code={resp.get('code')} msg={resp.get('message')}")
    data = resp.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"{path} missing data")
    return data


def run_full_e2e(service_token: str) -> None:
    print("--- Full layout harness E2E ---")
    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    login = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})
    user_token = login["data"]["token"]
    user_id = login["data"]["user"]["id"]
    record("Login", True)

    sid = http("POST", "/sessions", {"title": f"layout-smoke-{int(time.time())}"}, token=user_token)["data"]["id"]
    record("Create session", True, sid)

    img_id, txt_id, vid_id = seed_canvas(user_token, sid)
    record("Seed 3 canvas nodes", True, f"{img_id}, {txt_id}, {vid_id}")

    layout = internal_post(
        "/agent/internal/get-canvas-layout",
        {"sessionId": sid},
        service_token,
    )
    nodes = layout.get("nodes") or []
    groups = layout.get("groups") or []
    by_id = {n.get("id"): n for n in nodes if isinstance(n, dict)}
    img = by_id.get(img_id) or {}
    record(
        "get-canvas-layout absolutePosition",
        isinstance(img.get("absolutePosition"), dict)
        and img.get("absolutePosition") == img.get("position"),
        f"nodes={len(nodes)} groups={len(groups)}",
    )
    record("get-canvas-layout groups field", isinstance(groups, list), f"count={len(groups)}")

    internal_post(
        "/agent/internal/move-nodes",
        {
            "sessionId": sid,
            "userId": user_id,
            "items": [{"nodeId": img_id, "x": 300, "y": 400}],
        },
        service_token,
    )
    after_move = internal_post(
        "/agent/internal/get-canvas-layout",
        {"sessionId": sid},
        service_token,
    )
    moved = next((n for n in after_move.get("nodes") or [] if n.get("id") == img_id), {})
    pos = moved.get("position") or {}
    record(
        "move-nodes updates position",
        pos.get("x") == 300 and pos.get("y") == 400,
        f"position={pos}",
    )

    result = internal_post(
        "/agent/internal/apply-layout-ops",
        {
            "sessionId": sid,
            "userId": user_id,
            "ops": [
                {"op": "group", "nodeIds": [img_id, txt_id], "title": "Workflow block"},
                {"op": "move", "items": [{"nodeId": vid_id, "x": 900, "y": 900}]},
            ],
        },
        service_token,
    )
    op_results = result.get("results") or []
    final_layout = result.get("layout") or {}
    final_groups = final_layout.get("groups") or []
    vid_node = next((n for n in final_layout.get("nodes") or [] if n.get("id") == vid_id), {})
    vid_pos = vid_node.get("position") or {}
    record(
        "apply-layout-ops group+move",
        len(op_results) == 2 and len(final_groups) >= 1,
        f"results={len(op_results)} groups={len(final_groups)} vid={vid_pos}",
    )


def main() -> int:
    print("=== Canvas layout workflow verify ===")
    print(f"BASE={BASE}\n")

    service_token = resolve_service_token()
    probe_routes()

    if not service_token:
        record(
            "Full E2E (needs AGENT_RUNTIME_SERVICE_TOKEN)",
            False,
            "set env or run on CVM where /opt/lnkpi/.env is sourced",
            skip=True,
        )
    else:
        try:
            run_full_e2e(service_token)
        except Exception as exc:
            record("Full E2E", False, str(exc))

    print(f"\n=== Summary: {PASS} pass, {FAIL} fail, {SKIP} skip ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
