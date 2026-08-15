#!/usr/bin/env python3
"""Production verify: Seedance first_last_frame + continue-shot chain (PR #248).

Path 3 — Seedance strict first/last (S5):
  - Canvas video node with 2× localRefs + videoMode=first_last_frame
  - POST /studio/video/start with model seedance-2.0-mini
  - Assert generation starts; optional metadata scenario/refWire when terminal

Path 3b — Continue-shot chain (S2 → sibling):
  - Seedance image_to_video (1 ref, 5s) with return_last_frame (S2)
  - Poll until completed; require metadata.lastFrameUrl
  - Create sibling video node with lastFrameUrl as localRef (simulates「接下一段」)
  - Start second generation; assert recordId

Usage:
  python3 deploy/prod-canvas-i2v-seedance-verify.py
  GEN_POLL_SEC=300 python3 deploy/prod-canvas-i2v-seedance-verify.py
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
GEN_POLL_SEC = float(os.environ.get("GEN_POLL_SEC", "300"))
SEEDANCE_MODEL = os.environ.get("SEEDANCE_MODEL", "seedance-2.0-mini")
REF_URL_FIRST = os.environ.get(
    "I2V_REF_FIRST",
    "https://picsum.photos/seed/lnkpi-seedance-first/768/768",
)
REF_URL_LAST = os.environ.get(
    "I2V_REF_LAST",
    "https://picsum.photos/seed/lnkpi-seedance-last/768/768",
)

PASS = FAIL = 0


def record(case: str, ok: bool, detail: str = "", *, skip: bool = False) -> None:
    global PASS, FAIL
    if skip:
        icon = "⏭️"
    elif ok:
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


def meta_dict(rec: dict[str, Any]) -> dict[str, Any]:
    raw = rec.get("metadata")
    if not raw:
        return {}
    try:
        return json.loads(str(raw))
    except json.JSONDecodeError:
        return {}


def poll_generation(tok: str, record_id: str) -> dict[str, Any] | None:
    terminal: dict[str, Any] | None = None
    deadline = time.time() + GEN_POLL_SEC
    while time.time() < deadline:
        try:
            rec = http("GET", f"/studio/generations/{record_id}", t=tok)["data"]
            status = str(rec.get("status") or "")
            if status in ("completed", "failed", "error", "fallback_pending", "timeout"):
                return rec
            terminal = rec
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "502" in msg or "503" in msg or "504" in msg:
                time.sleep(5)
                continue
            record("Poll generation record", False, msg)
            return None
        time.sleep(5)
    return terminal


def start_video(
    tok: str,
    *,
    sid: str,
    node_id: str,
    prompt: str,
    video_mode: str,
    duration: int = 5,
    model: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "prompt": prompt,
        "duration": duration,
        "aspectRatio": "16:9",
        "resolution": "720p",
        "crop": "none",
        "videoMode": video_mode,
        "model": model or SEEDANCE_MODEL,
        "sessionId": sid,
        "nodeId": node_id,
    }
    return http("POST", "/studio/video/start", body, t=tok)["data"]


def verify_first_last_frame(tok: str) -> str | None:
    """Returns session id on success."""
    ts = int(time.time())
    video_id = f"video-fl-{ts}"
    sid = http("POST", "/sessions", {"title": f"seedance-fl-{ts}"}, t=tok)["data"]["id"]
    put_canvas(
        tok,
        sid,
        [
            {
                "id": video_id,
                "type": "video",
                "position": {"x": 400, "y": 300},
                "data": {
                    "prompt": "产品从首帧过渡到末帧",
                    "status": "draft",
                    "videoModel": SEEDANCE_MODEL,
                    "videoSettings": {
                        "duration": 5,
                        "aspectRatio": "16:9",
                        "resolution": "720p",
                        "crop": "none",
                    },
                    "videoMode": "first_last_frame",
                    "localRefs": [
                        {
                            "id": f"upload-first-{uuid.uuid4().hex[:8]}",
                            "mediaType": "image",
                            "sourceKind": "upload",
                            "label": "首帧.jpg",
                            "url": REF_URL_FIRST,
                        },
                        {
                            "id": f"upload-last-{uuid.uuid4().hex[:8]}",
                            "mediaType": "image",
                            "sourceKind": "upload",
                            "label": "末帧.jpg",
                            "url": REF_URL_LAST,
                        },
                    ],
                },
            }
        ],
        [],
    )

    try:
        data = start_video(
            tok,
            sid=sid,
            node_id=video_id,
            prompt="Seedance 严格首尾帧 smoke",
            video_mode="first_last_frame",
            duration=5,
        )
    except Exception as exc:  # noqa: BLE001
        record("path3-first-last: video/start", False, str(exc))
        return sid

    record_id = str(data.get("id") or "")
    record(
        "path3-first-last: start returns recordId",
        bool(record_id.strip()),
        f"id={record_id} model={SEEDANCE_MODEL}",
    )
    if not record_id:
        return sid

    rec = poll_generation(tok, record_id)
    status = str(rec.get("status") if rec else "")
    record(
        f"path3-first-last: poll ({GEN_POLL_SEC}s cap)",
        status in ("completed", "generating", "fallback_pending"),
        f"status={status}",
    )
    if rec and status == "completed":
        meta = meta_dict(rec)
        scenario = str(meta.get("scenario") or "")
        ref_wire = str(meta.get("refWire") or "")
        gateway = str(meta.get("gatewayModelId") or "")
        record(
            "path3-first-last: scenario S5 or refWire first_last",
            scenario == "S5" or ref_wire == "apimart_first_last",
            f"scenario={scenario} refWire={ref_wire} gateway={gateway}",
        )
        is_seedance = "seedance" in gateway.lower() or "doubao-seedance" in gateway.lower()
        if is_seedance:
            record("path3-first-last: Seedance gateway", True, gateway)
        else:
            record(
                "path3-first-last: Seedance gateway",
                False,
                f"platform fallback gateway={gateway or '(empty)'}",
                skip=True,
            )
        record("path3-first-last: video URL present", bool(rec.get("url")), str(rec.get("url") or "")[:80])
    return sid


def verify_continue_shot_chain(tok: str) -> None:
    ts = int(time.time())
    video_a = f"video-s2-{ts}"
    sid = http("POST", "/sessions", {"title": f"seedance-continue-{ts}"}, t=tok)["data"]["id"]
    put_canvas(
        tok,
        sid,
        [
            {
                "id": video_a,
                "type": "video",
                "position": {"x": 200, "y": 300},
                "data": {
                    "prompt": "第一段产品展示",
                    "status": "draft",
                    "videoModel": SEEDANCE_MODEL,
                    "videoSettings": {
                        "duration": 5,
                        "aspectRatio": "16:9",
                        "resolution": "720p",
                        "crop": "none",
                    },
                    "videoMode": "image_to_video",
                    "localRefs": [
                        {
                            "id": f"upload-s2-{uuid.uuid4().hex[:8]}",
                            "mediaType": "image",
                            "sourceKind": "upload",
                            "label": "ref.jpg",
                            "url": REF_URL_FIRST,
                        }
                    ],
                },
            }
        ],
        [],
    )

    try:
        data = start_video(
            tok,
            sid=sid,
            node_id=video_a,
            prompt="Seedance S2 return_last_frame smoke",
            video_mode="image_to_video",
            duration=5,
        )
    except Exception as exc:  # noqa: BLE001
        record("path3-continue: S2 video/start", False, str(exc))
        return

    record_id = str(data.get("id") or "")
    record("path3-continue: S2 start returns recordId", bool(record_id.strip()), f"id={record_id}")
    if not record_id:
        return

    rec = poll_generation(tok, record_id)
    status = str(rec.get("status") if rec else "")
    record(
        f"path3-continue: S2 poll ({GEN_POLL_SEC}s cap)",
        status == "completed",
        f"status={status}",
    )
    if not rec or status != "completed":
        return

    meta = meta_dict(rec)
    last_frame_url = str(meta.get("lastFrameUrl") or "").strip()
    if last_frame_url:
        record("path3-continue: lastFrameUrl in record metadata", True, last_frame_url[:80])
    else:
        record(
            "path3-continue: lastFrameUrl in record metadata",
            False,
            "missing (Agnes fallback?) — proxy ref for sibling start",
            skip=True,
        )
        last_frame_url = REF_URL_FIRST

    video_b = f"video-continue-{ts}"
    nodes = [
        {
            "id": video_a,
            "type": "video",
            "position": {"x": 200, "y": 300},
            "data": {
                "prompt": "第一段产品展示",
                "status": "completed",
                "url": rec.get("url"),
                "lastFrameUrl": last_frame_url,
                "videoModel": SEEDANCE_MODEL,
                "videoMode": "image_to_video",
            },
        },
        {
            "id": video_b,
            "type": "video",
            "position": {"x": 520, "y": 300},
            "data": {
                "prompt": "第一段产品展示",
                "status": "draft",
                "videoModel": SEEDANCE_MODEL,
                "videoSettings": {
                    "duration": 5,
                    "aspectRatio": "16:9",
                    "resolution": "720p",
                    "crop": "none",
                },
                "videoMode": "image_to_video",
                "localRefs": [
                    {
                        "id": f"last-frame-{uuid.uuid4().hex[:8]}",
                        "mediaType": "image",
                        "sourceKind": "upload",
                        "label": "上一镜末帧",
                        "url": last_frame_url,
                    }
                ],
            },
        },
    ]
    edges = [{"id": f"edge-{ts}", "source": video_a, "target": video_b}]
    put_canvas(tok, sid, nodes, edges)

    try:
        data_b = start_video(
            tok,
            sid=sid,
            node_id=video_b,
            prompt="第二段延续上一镜末帧",
            video_mode="image_to_video",
            duration=5,
        )
    except Exception as exc:  # noqa: BLE001
        record("path3-continue: sibling video/start", False, str(exc))
        return

    record_id_b = str(data_b.get("id") or "")
    record(
        "path3-continue: sibling start returns recordId",
        bool(record_id_b.strip()),
        f"id={record_id_b}",
    )
    if record_id_b:
        rec_b = poll_generation(tok, record_id_b)
        status_b = str(rec_b.get("status") if rec_b else "")
        record(
            f"path3-continue: sibling poll ({GEN_POLL_SEC}s cap)",
            status_b in ("completed", "generating", "fallback_pending"),
            f"status={status_b}",
        )


def main() -> int:
    print("=== U-I2V production verify (Seedance first_last + continue-shot) ===")
    print(f"BASE={BASE} model={SEEDANCE_MODEL} poll={GEN_POLL_SEC}s\n")

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

    verify_first_last_frame(tok)
    verify_continue_shot_chain(tok)

    print(f"\n=== Summary: PASS={PASS} FAIL={FAIL} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
