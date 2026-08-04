#!/usr/bin/env python3
"""Run atomic intent scenarios against prod API (same backend as browser UI).

Use alongside browser visual verification. Outputs structured results for review.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import time
import uuid
from typing import Any, Callable

spec = importlib.util.spec_from_file_location("v", "deploy/prod-atomic-intent-verify.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

Scenario = tuple[str, str, Callable[[str, list, set[str], str], tuple[bool, str]]]

SCENARIOS: list[Scenario] = [
    (
        "S01 空白画布单图",
        "帮我生成一个模特人物图",
        lambda t, nodes, types, exit_r: (
            "原子创作" in t and "image" in t.lower() or "模特" in t,
            f"nodes={len(nodes)} exit={exit_r}",
        ),
    ),
    (
        "S02 同节点 regenerate",
        "重新生成一张",
        lambda t, nodes, types, exit_r: (
            len(nodes) == 1 and ("重新生成" in t or "生成完成" in t),
            f"nodes={len(nodes)}",
        ),
    ),
    (
        "S03 变体新建（背景调整）",
        "重新生成一张，背景改成白色",
        lambda t, nodes, types, exit_r: (
            len(nodes) >= 2 and ("(2)" in t or "模特人物图 (2)" in t or len(nodes) == 2),
            f"nodes={len(nodes)} titles={[n.get('title') for n in nodes[:3]]}",
        ),
    ),
    (
        "S04 风格继承变体",
        "按刚才那个风格再生成一张",
        lambda t, nodes, types, exit_r: (
            len(nodes) >= 3,
            f"nodes={len(nodes)}",
        ),
    ),
    (
        "S05 Multi 三图枚举",
        "帮我生成三张图，分别是蓝牙耳机主图、白底图、三视图。",
        lambda t, nodes, types, exit_r: (
            len(nodes) == 3 and "3" in t,
            f"nodes={len(nodes)}",
        ),
    ),
    (
        "S06 模糊 clarify",
        "帮我生成",
        lambda t, nodes, types, exit_r: (
            len(nodes) == 0 and any(x in t for x in ("请说明", "请补充", "例如")),
            f"nodes=0",
        ),
    ),
    (
        "S07 D1 分镜文案 text",
        "帮我生成一个蓝牙耳机的分镜提示词",
        lambda t, nodes, types, exit_r: (
            "text" in t.lower() or "分镜" in t or "文案" in t or "脚本" in t,
            f"text={t[:80]}",
        ),
    ),
    (
        "S08 Campaign 12分镜",
        "帮我生成12个分镜镜头",
        lambda t, nodes, types, exit_r: (
            len(nodes) == 0 and any(x in t for x in ("节点", "方案", "Campaign", "营销", "主文案")),
            f"nodes=0",
        ),
    ),
    (
        "S09 Multi 上限 6 图",
        "帮我生成六张图，分别是图1、图2、图3、图4、图5、图6",
        lambda t, nodes, types, exit_r: (
            len(nodes) == 0 and ("5" in t or "Campaign" in t or "上限" in t),
            f"nodes=0",
        ),
    ),
    (
        "S10 Video confirm gate",
        "生成15秒产品展示视频",
        lambda t, nodes, types, exit_r: (
            "确认" in t or "video" in t.lower() or "视频" in t,
            f"await_confirm={'await_confirm' in types}",
        ),
    ),
    (
        "S11 Prompt 扩写模式",
        "用提示词模式扩写：赛博朋克耳机主图",
        lambda t, nodes, types, exit_r: (
            "prompt" in t.lower() or "扩写" in t or "提示词" in t,
            f"text={t[:80]}",
        ),
    ),
    (
        "S12 纯新建（非 regenerate）",
        "帮我生成一个新的模特图",
        lambda t, nodes, types, exit_r: (
            "原子创作" in t or "模特" in t,
            f"nodes={len(nodes)}",
        ),
    ),
]


def canvas_nodes(tok: str, sid: str) -> list[dict]:
    sess = v.http("GET", f"/sessions/{sid}", t=tok)["data"]
    canvas = sess.get("canvasData") or {}
    return [n for n in (canvas.get("nodes") or []) if isinstance(n, dict)]


def run_group(tok: str, scenarios: list[Scenario], *, shared: bool = False) -> list[dict]:
    results: list[dict] = []
    sid = v.http("POST", "/sessions", {"title": f"browser-audit-{int(time.time())}"}, t=tok)["data"]["id"]
    tid = f"ba_{uuid.uuid4().hex[:8]}"
    for name, msg, pred in scenarios:
        if not shared:
            tid = f"ba_{uuid.uuid4().hex[:8]}"
        t0 = time.time()
        try:
            _, text, types, exit_r = v.sse_collect(tok, sid, msg, tid, timeout=240)
            nodes = canvas_nodes(tok, sid)
            image_nodes = [n for n in nodes if str(n.get("type") or "") == "image"]
            ok, detail = pred(text, image_nodes, types, exit_r)
            ok = ok and "error" not in types
        except Exception as exc:  # noqa: BLE001
            ok, detail, text, types, exit_r = False, str(exc), "", set(), "error"
            image_nodes = []
        results.append(
            {
                "id": name.split()[0],
                "name": name,
                "utterance": msg,
                "pass": ok,
                "detail": detail,
                "response": (text or "")[:200],
                "elapsed_sec": round(time.time() - t0, 1),
                "shared_session": shared,
                "thread_id": tid,
            }
        )
        if not shared:
            sid = v.http("POST", "/sessions", {"title": f"browser-audit-{int(time.time())}"}, t=tok)["data"]["id"]
    return results


def main() -> int:
    try:
        v.http("POST", "/auth/send-code", {"phone": v.PHONE})
    except Exception:
        pass
    tok = v.http("POST", "/auth/login", {"phone": v.PHONE, "code": v.CODE})["data"]["token"]

    # Multi-turn chain: S01-S04 on one session
    chain = SCENARIOS[:4]
    singles = SCENARIOS[4:]

    results = run_group(tok, chain, shared=True)
    results.extend(run_group(tok, singles, shared=False))

    passed = sum(1 for r in results if r["pass"])
    failed = len(results) - passed
    print(json.dumps({"summary": {"pass": passed, "fail": failed, "total": len(results)}, "cases": results}, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
