#!/usr/bin/env python3
"""Production verify for Media Inspector P0 (mediaInfo + media-probe).

Usage:
  python3 deploy/prod-media-inspector-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-media-inspector-verify.py
  PROBE_URL=https://platform-outputs.agnes-ai.space/.../out.png python3 deploy/prod-media-inspector-verify.py
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
PROBE_URL = os.environ.get("PROBE_URL", "").strip()
LIST_LIMIT = int(os.environ.get("LIST_LIMIT", "10"))

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


def pick_completed_record(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    for row in rows:
        if str(row.get("status") or "") != "completed":
            continue
        if str(row.get("type") or "") in ("image", "video"):
            return row
    return None


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

    target = pick_completed_record(rows)
    if not target:
        record("Find completed image/video record", False, "none in recent list")
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

    record_id = str(target.get("id") or "")
    record(
        "Find completed image/video record",
        True,
        f"id={record_id} type={target.get('type')}",
    )

    try:
        detail = http_json("GET", f"/studio/generations/{record_id}", token=token).get("data") or {}
    except Exception as exc:  # noqa: BLE001
        record("GET generation detail", False, str(exc))
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

    has_media_info_key = "mediaInfo" in detail
    record("Generation response has mediaInfo key", has_media_info_key, record_id)
    if not has_media_info_key:
        print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
        return 1

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

    print(f"\nRESULT: PASS={PASS} FAIL={FAIL} WARN={WARN}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
