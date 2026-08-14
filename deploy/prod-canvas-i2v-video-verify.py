#!/usr/bin/env python3
"""Production verify: Canvas dock paths 1 & 2 → 15s video (U-I2V Wave 0).

Path 1 — upload/localRefs: video node with localRefs → POST /studio/video/start
Path 2 — upstream edge: image node + edge → video node → start

Checks (each path):
  - start response has generationRecordId + generationStartedAt
  - generation record poll reaches completed|generating|fallback_pending

Usage:
  python3 deploy/prod-canvas-i2v-video-verify.py
  GEN_POLL_SEC=120 python3 deploy/prod-canvas-i2v-video-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
GEN_POLL_SEC = float(os.environ.get("GEN_POLL_SEC", "90"))
REF_URL = os.environ.get(
    "I2V_REF_URL",
    "https://picsum.photos/seed/lnkpi-canvas-i2v/768/768",
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
        line += f" — {detail[:240]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def put_canvas(tok: str, sid: str, nodes: list[dict], edges: list[dict]) -> None:
    sess = http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}
    patch = {
        "nodes": nodes,
        "edges": edges,
        "viewport": canvas.get("viewport") or {"x": 0, "y": 0, "zoom": 1},
    }
    http("PUT", f"/sessions/{sid}", {"canvasData": patch}, t=tok)


def start_video(
    tok: str,
    *,
    sid: str,
    node_id: str,
    prompt: str,
) -> dict[str, Any]:
    body = {
        "prompt": prompt,
        "duration": 15,
        "aspectRatio": "16:9",
        "resolution": "720p",
        "crop": "none",
        "videoMode": "image_to_video",
        "sessionId": sid,
        "nodeId": node_id,
    }
    return http("POST", "/studio/video/start", body, t=tok)["data"]


def poll_generation(tok: str, record_id: str) -> str | None:
    terminal = None
    deadline = time.time() + GEN_POLL_SEC
    while time.time() < deadline:
        try:
            rec = http("GET", f"/studio/generations/{record_id}", t=tok)["data"]
            terminal = str(rec.get("status") or "")
            if terminal in ("completed", "failed", "error", "fallback_pending", "timeout"):
                return terminal
        except Exception as exc:  # noqa: BLE001
            record("Poll generation record", False, str(exc))
            return None
        time.sleep(5)
    return terminal


def verify_path(tok: str, label: str, nodes: list[dict], edges: list[dict], video_id: str) -> None:
    sid = http("POST", "/sessions", {"title": f"canvas-i2v-{label}-{int(time.time())}"}, t=tok)["data"]["id"]
    put_canvas(tok, sid, nodes, edges)

    prompt = f"U-I2V canvas {label} 产品展示 15秒"
    try:
        data = start_video(tok, sid=sid, node_id=video_id, prompt=prompt)
    except Exception as exc:  # noqa: BLE001
        record(f"{label}: video/start", False, str(exc))
        return

    record_id = str(data.get("id") or "")
    started_at = data.get("generationStartedAt")
    record(
        f"{label}: start returns recordId",
        bool(record_id.strip()),
        f"id={record_id}",
    )
    record(
        f"{label}: start returns generationStartedAt",
        isinstance(started_at, str) and bool(str(started_at).strip()),
        f"startedAt={started_at}",
    )

    if not record_id:
        return

    terminal = poll_generation(tok, record_id)
    record(
        f"{label}: generation poll ({GEN_POLL_SEC}s cap)",
        terminal in ("completed", "generating", "fallback_pending"),
        f"status={terminal}",
    )
    if terminal == "completed":
        rec = http("GET", f"/studio/generations/{record_id}", t=tok)["data"]
        record(f"{label}: video URL present", bool(rec.get("url")), str(rec.get("url") or "")[:80])


def main() -> int:
    print("=== U-I2V production verify (Canvas path1 upload + path2 edge) ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("Login", True)
    except Exception as exc:  # noqa: BLE001
        record("Login", False, str(exc))
        return 1

    ts = int(time.time())
    video_local = f"video-local-{ts}"
    verify_path(
        tok,
        "path1-localRefs",
        [
            {
                "id": video_local,
                "type": "video",
                "position": {"x": 400, "y": 300},
                "data": {
                    "prompt": "产品展示",
                    "status": "draft",
                    "videoSettings": {"duration": 15, "aspectRatio": "16:9", "resolution": "720p", "crop": "none"},
                    "videoMode": "image_to_video",
                    "localRefs": [
                        {
                            "id": f"upload-{uuid.uuid4().hex[:8]}",
                            "mediaType": "image",
                            "sourceKind": "upload",
                            "label": "ref.jpg",
                            "url": REF_URL,
                        }
                    ],
                },
            }
        ],
        [],
        video_local,
    )

    video_edge = f"video-edge-{ts}"
    image_up = f"image-up-{ts}"
    verify_path(
        tok,
        "path2-edge",
        [
            {
                "id": image_up,
                "type": "image",
                "position": {"x": 100, "y": 300},
                "data": {"url": REF_URL, "status": "completed"},
            },
            {
                "id": video_edge,
                "type": "video",
                "position": {"x": 400, "y": 300},
                "data": {
                    "prompt": "产品展示",
                    "status": "draft",
                    "videoSettings": {"duration": 15, "aspectRatio": "16:9", "resolution": "720p", "crop": "none"},
                    "videoMode": "image_to_video",
                },
            },
        ],
        [{"id": f"edge-{ts}", "source": image_up, "target": video_edge}],
        video_edge,
    )

    print(f"\n=== Summary: PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
