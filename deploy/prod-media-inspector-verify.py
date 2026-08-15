#!/usr/bin/env python3
"""Production verify for Media Inspector P0 (mediaInfo + media-probe).

Usage:
  python3 deploy/prod-media-inspector-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-media-inspector-verify.py
  RECORD_ID=<id> python3 deploy/prod-media-inspector-verify.py
  VERIFY_VIDEO_PREFLIGHT=1 python3 deploy/prod-media-inspector-verify.py
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
PROBE_URL = os.environ.get("PROBE_URL", "").strip()
LIST_LIMIT = int(os.environ.get("LIST_LIMIT", "10"))
RECORD_ID = os.environ.get("RECORD_ID", "").strip()
VERIFY_VIDEO_PREFLIGHT = os.environ.get("VERIFY_VIDEO_PREFLIGHT", "").strip() in ("1", "true", "yes")
OVERSIZED_REF_URL = os.environ.get(
    "OVERSIZED_REF_URL",
    "https://platform-outputs.agnes-ai.space/images/i2i/task_v8x4vgTKQhn5Hz0ga5VZy1f7APhYlVGj/output.png",
).strip()
SMALL_REF_URL = os.environ.get(
    "SMALL_REF_URL",
    "https://platform-outputs.agnes-ai.space/images/i2i/task_1LFSCNKkwPzlb1m2uJzjsOj7DJTYAkEv/output.png",
).strip()

PASS = FAIL = WARN = 0


def record(case: str, ok: bool, detail: str = "", *, warn: bool = False) -> None:
    global PASS, FAIL, WARN
    if warn:
        WARN += 1
        icon = "⚠️"
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


def http_json(method: str, path: str, body: dict | None = None, token: str | None = None) -> Any:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(
        f"{API}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
        method=method,
    )
    with urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def http_json_status(
    method: str, path: str, body: dict | None = None, token: str | None = None
) -> tuple[Any, int]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(
        f"{API}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
        method=method,
    )
    try:
        with urlopen(req, timeout=120) as resp:
            return json.loads(resp.read()), resp.status
    except HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:500]}
        return payload, exc.code


def row_has_media_info(row: dict[str, Any]) -> bool:
    if row.get("mediaInfo"):
        return True
    try:
        meta = json.loads(str(row.get("metadata") or "{}"))
    except json.JSONDecodeError:
        return False
    return isinstance(meta.get("mediaInfo"), dict) and bool(meta.get("mediaInfo"))


def pick_completed_record(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [
        row
        for row in rows
        if str(row.get("status") or "") == "completed"
        and str(row.get("type") or "") in ("image", "video")
    ]
    if not candidates:
        return None
    with_media = [row for row in candidates if row_has_media_info(row)]
    return with_media[0] if with_media else candidates[0]


def pick_probe_url(record: dict[str, Any], explicit: str) -> str | None:
    if explicit:
        return explicit
    url = str(record.get("url") or "").strip()
    if url.startswith("http"):
        return url
    try:
        meta = json.loads(str(record.get("metadata") or "{}"))
    except json.JSONDecodeError:
        meta = {}
    media_info = meta.get("mediaInfo") if isinstance(meta, dict) else None
    if isinstance(media_info, dict):
        output = media_info.get("output")
        if isinstance(output, dict):
            out_url = str(output.get("url") or "").strip()
            if out_url.startswith("http"):
                return out_url
    return None


def main() -> int:
    print("=== Media Inspector P0 production verify ===")
    print(f"BASE={BASE}\n")

    try:
        http_json("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass

    try:
        token = http_json("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("Login", True)
    except Exception as exc:  # noqa: BLE001
        record("Login", False, str(exc))
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

    try:
        list_res = http_json(
            "GET",
            f"/studio/generations?{urlencode({'limit': LIST_LIMIT})}",
            token=token,
        )
        rows = list_res.get("data") or []
        record("List recent generations", isinstance(rows, list), f"count={len(rows)}")
    except Exception as exc:  # noqa: BLE001
        record("List recent generations", False, str(exc))
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

    target = None
    if RECORD_ID:
        try:
            target = http_json("GET", f"/studio/generations/{RECORD_ID}", token=token).get("data") or {}
            record("Use explicit RECORD_ID", bool(target.get("id")), RECORD_ID)
        except Exception as exc:  # noqa: BLE001
            record("Use explicit RECORD_ID", False, str(exc))
            print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
            return 1
    else:
        target = pick_completed_record(rows)
        if not target:
            record("Find completed image/video record", False, "none in recent list")
            print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
            return 1

    record_id = str(target.get("id") or "")
    has_media_info_in_list = row_has_media_info(target)
    record(
        "Find completed image/video record",
        True,
        f"id={record_id} type={target.get('type')} mediaInfo={'yes' if has_media_info_in_list else 'legacy'}",
    )

    try:
        detail = target if RECORD_ID else (
            http_json("GET", f"/studio/generations/{record_id}", token=token).get("data") or {}
        )
    except Exception as exc:  # noqa: BLE001
        record("GET generation detail", False, str(exc))
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

    has_media_info_key = "mediaInfo" in detail
    if has_media_info_key:
        record("Generation response has mediaInfo key", True, record_id)
    else:
        record(
            "Generation response has mediaInfo key",
            True,
            "legacy record without mediaInfo — continuing with media-probe only",
            warn=True,
        )

    media_info = detail.get("mediaInfo")
    if media_info:
        output = media_info.get("output") if isinstance(media_info, dict) else None
        dims = None
        if isinstance(output, dict):
            dims = f"{output.get('width')}x{output.get('height')}"
        record("mediaInfo populated", True, dims or "has output/references")
    else:
        record(
            "mediaInfo populated",
            True,
            "empty on legacy record — deploy mediaInfo backfill may be pending",
            warn=True,
        )

    probe_url = pick_probe_url(detail, PROBE_URL)
    if not probe_url:
        record("Resolve probe URL", False, "no http output url; set PROBE_URL")
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

    try:
        probe_res = http_json(
            "GET",
            f"/studio/media-probe?{urlencode({'url': probe_url})}",
            token=token,
        ).get("data") or {}
        width = probe_res.get("width")
        height = probe_res.get("height")
        ok = isinstance(width, int) and width > 0 and isinstance(height, int) and height > 0
        record(
            "GET media-probe width/height",
            ok,
            f"{width}x{height} status={probe_res.get('probeStatus')} url={probe_url[:120]}",
        )
    except Exception as exc:  # noqa: BLE001
        record("GET media-probe width/height", False, str(exc))

    if VERIFY_VIDEO_PREFLIGHT:
        try:
            body = {
                "prompt": "media inspector preflight verify",
                "model": "agnes-video-v2.0",
                "duration": 5,
                "aspectRatio": "16:9",
                "resolution": "720p",
                "refs": [
                    {"refKey": "I1", "mediaType": "image", "url": SMALL_REF_URL},
                    {"refKey": "I2", "mediaType": "image", "url": SMALL_REF_URL},
                    {"refKey": "I3", "mediaType": "image", "url": OVERSIZED_REF_URL},
                ],
            }
            res, status = http_json_status("POST", "/studio/video/generate", body, token=token)
            msg = str(res.get("message") or res.get("error") or res)
            blocked = status == 400 and ("过大" in msg or "参考图" in msg)
            record(
                "Video keyframes preflight block (oversized I3)",
                blocked,
                f"status={status} msg={msg[:160]}",
            )
        except Exception as exc:  # noqa: BLE001
            record("Video keyframes preflight block (oversized I3)", False, str(exc))

    print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
