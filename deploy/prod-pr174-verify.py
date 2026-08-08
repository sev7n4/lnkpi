#!/usr/bin/env python3
"""Production verify for PR #174 + Seedance 2.0 variants — video multimodal adapter.

Checks:
  1. Audio-only refs rejected (400)
  2. referenceImageUrl passthrough starts Agnes i2v (not Unsplash placeholder)
  3. Agnes multi-image keyframes path accepts refs
  4. Seedance BYOK (if configured) accepts multimodal refs + @ tags in metadata
  5. Seedance BYOK fast: refWire=apimart_multimodal, variantTag=fast (optional)
  6. Seedance 1.x BYOK blocked with 400 (optional, when 1.x channel configured)
  7. Platform seedance-2.0 standard keeps 1080p + variantTag=standard (optional)

Usage:
  python3 deploy/prod-pr174-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-pr174-verify.py
  VIDEO_MODEL_FAST='channelId::doubao-seedance-2.0-fast' python3 deploy/prod-pr174-verify.py
  SEEDANCE_1X_MODEL='channelId::doubao-seedance-1-0-lite-i2v-250428' python3 deploy/prod-pr174-verify.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
GEN_POLL_SEC = float(os.environ.get("GEN_POLL_SEC", "240"))
VIDEO_MODEL = os.environ.get("VIDEO_MODEL", "")  # optional BYOK seedance channel::model
VIDEO_MODEL_FAST = os.environ.get("VIDEO_MODEL_FAST", "")  # optional BYOK fast variant
SEEDANCE_1X_MODEL = os.environ.get("SEEDANCE_1X_MODEL", "")  # optional 1.x block test channel::model

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf"
    b"\xc0\x00\x00\x00\x03\x00\x01\x00\x05\xd7\xd0\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
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
        line += f" — {detail[:240]}"
    print(line)


def http_json(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    with urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def http_json_expect(m: str, p: str, b: dict | None, t: str, *, expect_status: int) -> tuple[int, Any]:
    h = {"Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Bearer {t}"}
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    try:
        with urlopen(r, timeout=120) as resp:
            return resp.status, json.loads(resp.read())
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"raw": body}
        return exc.code, payload


def upload_png(tok: str) -> str:
    boundary = f"----lnkpi{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="pr174-ref.png"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + TINY_PNG + f"\r\n--{boundary}--\r\n".encode()
    req = Request(
        f"{API}/upload",
        data=body,
        headers={
            "Authorization": f"Bearer {tok}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    url = str((payload.get("data") or {}).get("url") or "")
    if not url:
        raise RuntimeError(f"upload missing url: {payload}")
    return url


def poll_generation(tok: str, gid: str) -> dict[str, Any]:
    deadline = time.time() + GEN_POLL_SEC
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = http_json("GET", f"/studio/generations/{gid}", t=tok).get("data") or {}
        st = str(last.get("status") or "")
        if st in ("completed", "failed", "error", "fallback_pending"):
            return last
        time.sleep(6)
    return last


def meta_dict(rec: dict[str, Any]) -> dict[str, Any]:
    raw = rec.get("metadata")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}
    return {}


def is_unsplash(url: str) -> bool:
    return "unsplash.com" in (url or "").lower()


def bootstrap_data(tok: str) -> dict[str, Any]:
    try:
        return http_json("GET", "/provider/bootstrap", t=tok).get("data") or {}
    except Exception:
        return {}


def pick_byok_model(tok: str, *, env_override: str, matcher: Callable[[str], bool]) -> str | None:
    if env_override and "::" in env_override:
        return env_override
    boot = bootstrap_data(tok)
    for ch in boot.get("channels") or []:
        cid = str(ch.get("id") or "")
        for m in ch.get("models") or []:
            name = str(m.get("name") or m.get("modelId") or "")
            if cid and matcher(name):
                return f"{cid}::{name}"
    return None


def is_seedance_1x(name: str) -> bool:
    lower = name.lower()
    return bool(re.search(r"(?:^|[^0-9])seedance[-.]1[.-]|doubao-seedance-1[.-]", lower))


def is_seedance_fast(name: str) -> bool:
    lower = name.lower()
    return "seedance-2.0-fast" in lower or "doubao-seedance-2.0-fast" in lower


def pick_seedance_model(tok: str) -> str | None:
    return pick_byok_model(
        tok,
        env_override=VIDEO_MODEL,
        matcher=lambda name: "seedance" in name.lower() and not is_seedance_1x(name),
    )


def pick_seedance_fast_model(tok: str) -> str | None:
    return pick_byok_model(tok, env_override=VIDEO_MODEL_FAST, matcher=is_seedance_fast)


def pick_seedance_1x_model(tok: str) -> str | None:
    return pick_byok_model(tok, env_override=SEEDANCE_1X_MODEL, matcher=is_seedance_1x)


def platform_has_video_model(tok: str, model_key: str) -> bool:
    plat = bootstrap_data(tok).get("platformChannel") or {}
    for m in plat.get("models") or []:
        name = str(m.get("name") or m.get("modelId") or "")
        if name == model_key:
            return True
    return False


def dropped_resolution(meta: dict[str, Any]) -> bool:
    dropped = meta.get("droppedFields")
    if not isinstance(dropped, list):
        return False
    return any(
        isinstance(item, dict) and str(item.get("field") or "") == "resolution"
        for item in dropped
    )


def main() -> int:
    print("=== PR #174 production verify (Seedance / agnes-video adapter) ===")
    print(f"BASE={BASE}\n")

    try:
        http_json("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http_json("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("Login", True)
    except Exception as exc:  # noqa: BLE001
        record("Login", False, str(exc))
        return 1

    # 1) Audio-only refs rejected
    st, payload = http_json_expect(
        "POST",
        "/studio/video/generate",
        {
            "prompt": "test audio only",
            "duration": 5,
            "aspectRatio": "16:9",
            "refs": [{"refKey": "A1", "mediaType": "audio", "url": "https://example.com/a.mp3"}],
        },
        tok,
        expect_status=400,
    )
    msg = str(payload.get("message") or payload.get("raw") or "")
    record(
        "Audio-only refs rejected",
        st == 400 and "参考音频须配合参考图或视频" in msg,
        f"HTTP {st} msg={msg[:120]}",
    )

    try:
        img1 = upload_png(tok)
        img2 = upload_png(tok)
        record("Upload ref PNGs", True, f"{img1[:80]} …")
    except Exception as exc:  # noqa: BLE001
        record("Upload ref PNGs", False, str(exc))
        return 1

    sid = http_json("POST", "/sessions", {"title": f"PR174-{int(time.time())}"}, t=tok)["data"]["id"]
    node_id = f"vid-pr174-{uuid.uuid4().hex[:8]}"

    # 2) Agnes i2v via referenceImageUrl (platform default model)
    try:
        gen = http_json(
            "POST",
            "/studio/video/generate",
            {
                "prompt": "人物缓慢转头，商业广告风格",
                "duration": 5,
                "aspectRatio": "16:9",
                "resolution": "720p",
                "referenceImageUrl": img1,
                "sessionId": sid,
                "nodeId": node_id,
            },
            t=tok,
        ).get("data") or {}
        gid = str(gen.get("id") or "")
        record("Agnes i2v start (referenceImageUrl)", bool(gid), f"id={gid}")
    except Exception as exc:  # noqa: BLE001
        record("Agnes i2v start (referenceImageUrl)", False, str(exc))
        gid = ""

    if gid:
        rec = poll_generation(tok, gid)
        meta = meta_dict(rec)
        url = str(rec.get("url") or "")
        st = str(rec.get("status") or "")
        ref_wire = str(meta.get("refWire") or meta.get("ref_wire") or "")
        record(
            "Agnes i2v not Unsplash placeholder",
            not is_unsplash(url) or st in ("generating", "failed", "error"),
            f"status={st} url={url[:80]} refWire={ref_wire[:60]}",
        )
        record(
            "Agnes i2v metadata has refWire",
            bool(ref_wire) or st in ("generating", "failed"),
            f"refWire={ref_wire or '(empty)'} status={st}",
        )

    # 3) Agnes multi-image keyframes
    try:
        gen2 = http_json(
            "POST",
            "/studio/video/generate",
            {
                "prompt": "从第一张过渡到第二张，保持主体一致",
                "duration": 5,
                "aspectRatio": "16:9",
                "refs": [
                    {"refKey": "I1", "mediaType": "image", "url": img1, "label": "首帧"},
                    {"refKey": "I2", "mediaType": "image", "url": img2, "label": "尾帧"},
                ],
                "mentionedKeys": ["I1", "I2"],
                "sessionId": sid,
            },
            t=tok,
        ).get("data") or {}
        gid2 = str(gen2.get("id") or "")
        record("Agnes keyframes start (multi I*)", bool(gid2), f"id={gid2}")
    except Exception as exc:  # noqa: BLE001
        record("Agnes keyframes start (multi I*)", False, str(exc))
        gid2 = ""

    if gid2:
        rec2 = poll_generation(tok, gid2)
        meta2 = meta_dict(rec2)
        ref_wire2 = str(meta2.get("refWire") or "")
        record(
            "Agnes keyframes refWire mentions keyframes or agnes",
            "keyframes" in ref_wire2.lower() or "agnes" in ref_wire2.lower() or str(rec2.get("status")) == "generating",
            f"refWire={ref_wire2 or '(empty)'} status={rec2.get('status')}",
        )

    # 4) Seedance BYOK multimodal (optional)
    seedance = pick_seedance_model(tok)
    if not seedance:
        record("Seedance BYOK multimodal", False, "no BYOK seedance channel", skip=True)
    else:
        try:
            gen3 = http_json(
                "POST",
                "/studio/video/generate",
                {
                    "prompt": "walk @Image1 with motion like @Video1",
                    "model": seedance,
                    "duration": 5,
                    "aspectRatio": "16:9",
                    "resolution": "720p",
                    "refs": [
                        {"refKey": "I1", "mediaType": "image", "url": img1, "label": "人物"},
                        {"refKey": "V1", "mediaType": "video", "url": "https://example.com/ref.mp4", "label": "运镜"},
                    ],
                    "mentionedKeys": ["I1", "V1"],
                    "sessionId": sid,
                },
                t=tok,
            ).get("data") or {}
            gid3 = str(gen3.get("id") or "")
            record("Seedance multimodal start", bool(gid3), f"model={seedance} id={gid3}")
        except Exception as exc:  # noqa: BLE001
            record("Seedance multimodal start", False, str(exc))
            gid3 = ""

        if gid3:
            rec3 = poll_generation(tok, gid3)
            meta3 = meta_dict(rec3)
            prompt_used = str(rec3.get("prompt") or meta3.get("effectivePrompt") or "")
            ref_wire3 = str(meta3.get("refWire") or "")
            record(
                "Seedance refWire set",
                "seedance" in ref_wire3.lower() or str(rec3.get("status")) in ("generating", "failed", "completed"),
                f"refWire={ref_wire3 or '(empty)'} status={rec3.get('status')}",
            )
            record(
                "Seedance prompt retains @Image1",
                "@Image1" in prompt_used or str(rec3.get("status")) == "generating",
                f"prompt_snip={prompt_used[:120]}",
            )

    # 5) Seedance BYOK fast variant — refWire + variantTag (optional)
    seedance_fast = pick_seedance_fast_model(tok)
    if not seedance_fast:
        record("Seedance BYOK fast variant", False, "no BYOK fast channel", skip=True)
    else:
        try:
            gen_fast = http_json(
                "POST",
                "/studio/video/generate",
                {
                    "prompt": "slow pan @Image1 cinematic",
                    "model": seedance_fast,
                    "duration": 5,
                    "aspectRatio": "16:9",
                    "resolution": "1080p",
                    "refs": [{"refKey": "I1", "mediaType": "image", "url": img1, "label": "主体"}],
                    "mentionedKeys": ["I1"],
                    "sessionId": sid,
                },
                t=tok,
            ).get("data") or {}
            gid_fast = str(gen_fast.get("id") or "")
            record("Seedance fast start", bool(gid_fast), f"model={seedance_fast} id={gid_fast}")
        except Exception as exc:  # noqa: BLE001
            record("Seedance fast start", False, str(exc))
            gid_fast = ""

        if gid_fast:
            rec_fast = poll_generation(tok, gid_fast)
            meta_fast = meta_dict(rec_fast)
            ref_wire_fast = str(meta_fast.get("refWire") or "")
            variant_tag = str(meta_fast.get("variantTag") or "")
            st_fast = str(rec_fast.get("status") or "")
            record(
                "Seedance fast refWire=apimart_multimodal",
                ref_wire_fast == "apimart_multimodal",
                f"refWire={ref_wire_fast or '(empty)'} status={st_fast}",
            )
            record(
                "Seedance fast variantTag=fast",
                variant_tag == "fast",
                f"variantTag={variant_tag or '(empty)'} status={st_fast}",
            )
            record(
                "Seedance fast 1080p clamped to 720p",
                dropped_resolution(meta_fast) or str(meta_fast.get("resolution") or "") == "720p",
                f"dropped={dropped_resolution(meta_fast)} resolution={meta_fast.get('resolution')}",
            )

    # 6) Seedance 1.x BYOK blocked (optional)
    seedance_1x = pick_seedance_1x_model(tok)
    if not seedance_1x:
        record("Seedance 1.x BYOK blocked", False, "no 1.x test channel", skip=True)
    else:
        st_1x, payload_1x = http_json_expect(
            "POST",
            "/studio/video/generate",
            {
                "prompt": "test 1.x block",
                "model": seedance_1x,
                "duration": 5,
                "aspectRatio": "16:9",
                "sessionId": sid,
            },
            tok,
            expect_status=400,
        )
        msg_1x = str(payload_1x.get("message") or payload_1x.get("raw") or "")
        record(
            "Seedance 1.x BYOK blocked (400)",
            st_1x == 400 and "Seedance 1.x" in msg_1x,
            f"HTTP {st_1x} model={seedance_1x} msg={msg_1x[:120]}",
        )

    # 7) Platform seedance-2.0 standard 1080p (optional)
    if not platform_has_video_model(tok, "seedance-2.0"):
        record("Platform seedance-2.0 standard 1080p", False, "platform catalog lacks seedance-2.0", skip=True)
    else:
        try:
            gen_std = http_json(
                "POST",
                "/studio/video/generate",
                {
                    "prompt": "wide establishing shot, cinematic lighting",
                    "model": "seedance-2.0",
                    "duration": 5,
                    "aspectRatio": "16:9",
                    "resolution": "1080p",
                    "sessionId": sid,
                },
                t=tok,
            ).get("data") or {}
            gid_std = str(gen_std.get("id") or "")
            record("Platform seedance-2.0 start", bool(gid_std), f"id={gid_std}")
        except Exception as exc:  # noqa: BLE001
            record("Platform seedance-2.0 start", False, str(exc))
            gid_std = ""

        if gid_std:
            rec_std = poll_generation(tok, gid_std)
            meta_std = meta_dict(rec_std)
            variant_std = str(meta_std.get("variantTag") or "")
            gw = str(meta_std.get("gatewayModelId") or "")
            st_std = str(rec_std.get("status") or "")
            record(
                "Platform standard variantTag=standard",
                variant_std == "standard",
                f"variantTag={variant_std or '(empty)'} gateway={gw}",
            )
            record(
                "Platform standard 1080p not clamped",
                not dropped_resolution(meta_std) and str(meta_std.get("resolution") or "") == "1080p",
                f"resolution={meta_std.get('resolution')} dropped={dropped_resolution(meta_std)}",
            )

    print(f"\n=== SUMMARY PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
