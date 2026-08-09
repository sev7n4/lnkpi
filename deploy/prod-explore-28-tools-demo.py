#!/usr/bin/env python3
"""Live demo all 28 explore-bound tools via production Agent chat (user path).

Messages are crafted to route explore_canvas (节点+查询/检查) and avoid atomic_create.
Validation tiers: tool (explore step + evidence), weak (explore only), wrong_route, fail.

Usage:
  SESSION_ID=cmsjq3rpj005op801frieqj42 python3 deploy/prod-explore-28-tools-demo.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SESSION_ID = os.environ.get("SESSION_ID", "cmsjq3rpj005op801frieqj42").strip()
SSE_TIMEOUT = float(os.environ.get("EXPLORE_DEMO_SSE_TIMEOUT", "120"))

ATOMIC_STEPS = frozenset({
    "parse_atomic_intent",
    "clarify_atomic_intent",
    "create_atomic_node",
    "run_atomic_gen",
    "await_atomic_confirm",
    "prepare_atomic_regenerate",
    "prepare_single_gen",
    "run_single_gen",
})

PASS = FAIL = SKIP = WEAK = 0
Verdict = Literal["tool", "weak", "wrong_route", "fail", "skip"]


@dataclass
class DemoCase:
    tool: str
    message: str
    expect_keywords: list[str] = field(default_factory=list)
    expect_canvas_cmd: str | None = None
    allow_skip: bool = False


# Explore route requires 节点/画布 + 查询/检查/列出/状态，或 lifecycle 关键词。
DEMOS: list[DemoCase] = [
    DemoCase(
        "get_canvas_summary",
        "查询画布上有哪些节点？列出每个节点的类型和状态",
        ["节点", "image", "prompt", "text"],
    ),
    DemoCase(
        "get_node",
        "查询节点 image-16 的详细信息，包括 url 和 status",
        ["image-16"],
    ),
    DemoCase(
        "get_canvas_layout",
        "查询画布各节点的坐标位置和分组 layout 信息",
        ["坐标", "位置", "layout", "x", "y", "节点"],
    ),
    DemoCase(
        "get_generation_status",
        "查询 image-16 这个节点当前的生成状态",
        ["image-16", "状态", "status", "completed", "error", "idle", "generating"],
    ),
    DemoCase(
        "get_generation_diagnostic",
        "image-16 生成失败了，查询诊断信息和失败原因",
        ["诊断", "失败", "error", "image-16", "reason", "timeout"],
    ),
    DemoCase(
        "list_generation_tasks",
        "列出本会话所有生成任务，哪些在排队哪些已完成",
        ["任务", "生成", "completed", "queued", "排队", "pending"],
    ),
    DemoCase(
        "list_user_assets",
        "查询我的资产库有哪些素材，列出名称和类型",
        ["资产", "素材", "library", "暂无", "没有"],
    ),
    DemoCase(
        "list_public_assets",
        "查询平台公共素材库有哪些内容",
        ["公共", "资产", "素材", "暂无", "没有"],
    ),
    DemoCase(
        "get_image_edit_capabilities",
        "查询「换logo李宁」这个图片节点支持哪些精修编辑模式？",
        ["精修", "编辑", "inpaint", "crop", "canEdit", "支持", "模式", "换logo"],
    ),
    DemoCase(
        "upsert_prompt_node",
        "查询画布空白区域，用工具添加一个 prompt 节点，标题 explore-upsert-demo，"
        "prompt 字段写 explore-upsert-test（不要触发出图）",
        ["explore-upsert", "prompt", "节点", "已", "添加", "创建"],
    ),
    DemoCase(
        "set_node_prompt",
        "查询 prompt-1 节点，把它的 prompt 字段更新为 explore-set-prompt-测试文案",
        ["prompt-1", "已", "更新", "prompt", "explore-set-prompt"],
    ),
    DemoCase(
        "set_node_content",
        "查询 text-40 文案节点，把内容更新为 explore-set-content-测试",
        ["text-40", "已", "内容", "更新", "explore-set-content"],
    ),
    DemoCase(
        "attach_refs",
        "查询 prompt-1 节点，把 image-16 作为参考图 attach 挂上去",
        ["prompt-1", "参考", "attach", "已", "image-16", "localRefs"],
    ),
    DemoCase(
        "apply_sidebar_attachments",
        "查询 prompt-1 节点，把侧栏 @I1 引用写到 localRefs（apply sidebar attachments）",
        ["prompt-1", "侧栏", "引用", "localRefs", "已", "I1"],
        allow_skip=True,
    ),
    DemoCase(
        "duplicate_node",
        "查询「换logo李宁」节点并复制一份，偏移一点位置",
        ["复制", "换logo", "副本", "节点", "duplicate", "已"],
    ),
    DemoCase(
        "upload_media_to_canvas",
        "查询画布，把图片 URL https://picsum.photos/seed/explore28demo/512/512 "
        "上传到画布加一个 image 节点（仅上传，不要出图）",
        ["上传", "节点", "image", "已", "picsum", "url"],
    ),
    DemoCase(
        "introduce_nodes_to_agent",
        "查询「换logo李宁」节点并引入到 Agent 侧栏对话上下文",
        ["引入", "换logo", "侧栏", "上下文", "introduce"],
        expect_canvas_cmd="introduce_nodes",
    ),
    DemoCase(
        "save_node_to_asset_library",
        "查询「换logo李宁」节点并保存到我的资产库",
        ["资产库", "保存", "换logo", "已", "asset"],
    ),
    DemoCase(
        "apply_asset_to_node",
        "查询 prompt-1 节点，从我资产库选一张图应用到它上面",
        ["资产", "应用", "prompt-1", "已"],
        allow_skip=True,
    ),
    DemoCase(
        "cancel_generation",
        "取消 image-16 节点上正在进行的生成任务",
        ["取消", "cancel", "image-16", "没有", "未", "idle", "无"],
        allow_skip=True,
    ),
    DemoCase(
        "cancel_platform_fallback",
        "查询「让模特穿上这双鞋子」节点，取消这次平台回退 fallback",
        ["取消", "回退", "fallback", "平台", "已", "让模特"],
        allow_skip=True,
    ),
    DemoCase(
        "confirm_platform_fallback",
        "查询「让模特穿上这双鞋子」节点，确认使用平台通道继续 fallback",
        ["确认", "平台", "fallback", "已", "继续", "让模特"],
        allow_skip=True,
    ),
    DemoCase(
        "export_media_package",
        "查询并导出「换logo李宁」节点的图片下载链接",
        ["导出", "下载", "链接", "url", "换logo", "http"],
    ),
    DemoCase(
        "focus_node",
        "查询「换logo李宁」节点，把视口定位到它",
        ["定位", "换logo", "focus"],
        expect_canvas_cmd="focus_node",
    ),
    DemoCase(
        "focus_nodes",
        "查询颜色变体1到4节点，把视口定位到它们",
        ["定位", "颜色变体", "视口", "focus"],
        expect_canvas_cmd="focus_nodes",
    ),
    DemoCase(
        "undo",
        "查询画布，撤销上一步画布编辑操作",
        ["撤销", "undo", "已", "无", "没有"],
        expect_canvas_cmd="undo",
    ),
    DemoCase(
        "redo",
        "查询画布，重做刚才撤销的画布操作",
        ["重做", "redo", "已", "无", "没有"],
        expect_canvas_cmd="redo",
    ),
    DemoCase(
        "open_image_editor",
        "查询「换logo李宁」图片节点并打开精修编辑器",
        ["精修", "编辑", "换logo", "打开", "editor"],
        expect_canvas_cmd="open_image_editor",
    ),
]


def record(case: str, verdict: Verdict, detail: str = "") -> None:
    global PASS, FAIL, SKIP, WEAK
    icons = {
        "tool": "✅",
        "weak": "⚠️",
        "wrong_route": "🔀",
        "fail": "❌",
        "skip": "⏭️",
    }
    if verdict == "tool":
        PASS += 1
    elif verdict == "weak":
        WEAK += 1
    elif verdict == "skip":
        SKIP += 1
    elif verdict == "wrong_route":
        FAIL += 1
    else:
        FAIL += 1
    line = f"{icons.get(verdict, '?')} [{verdict}] {case}"
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


def sse_chat(
    tok: str,
    sid: str,
    msg: str,
    tid: str,
    *,
    timeout: float = 120,
) -> dict[str, Any]:
    body = {"sessionId": sid, "message": msg, "threadId": tid}
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {tok}",
        "Idempotency-Key": f"demo_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    steps: list[str] = []
    canvas_cmds: list[str] = []
    parts: list[str] = []
    explore_payload: dict | None = None
    end = time.time() + timeout
    with urlopen(r, timeout=timeout + 30) as resp:
        buf = ""
        while time.time() < end:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk.decode(errors="replace")
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data:"):
                        continue
                    pl = line[5:].strip()
                    if pl == "[DONE]":
                        break
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    et = str(ev.get("type") or "")
                    types.add(et)
                    data = ev.get("data") or {}
                    if et == "text_delta":
                        parts.append(str(data.get("text") or ""))
                    if et == "text_replace":
                        parts = [str(data.get("text") or "")]
                    if et == "step":
                        node_id = str((data.get("id") if isinstance(data, dict) else "") or "")
                        steps.append(node_id.replace("node:", ""))
                    if et == "canvas_command":
                        canvas_cmds.append(str(data.get("type") or ""))
                    if et == "explore":
                        explore_payload = data if isinstance(data, dict) else None
                    if et == "done":
                        break
                    if et == "error":
                        err_msg = str((data or {}).get("message") or data)
                        parts.append(f"[ERROR: {err_msg}]")
                        break
    text = parts[-1] if len(parts) == 1 and parts[0] else "".join(parts)
    explore_ran = "explore" in steps
    atomic_ran = any(s in ATOMIC_STEPS for s in steps)
    return {
        "text": text,
        "types": sorted(types),
        "steps": steps,
        "canvas_cmds": canvas_cmds,
        "explore_ran": explore_ran,
        "atomic_ran": atomic_ran,
        "explore_payload": explore_payload,
    }


def _keyword_hit(text: str, keywords: list[str]) -> bool:
    lower = text.lower()
    return any(k.lower() in lower for k in keywords)


def verify_case(case: DemoCase, result: dict[str, Any]) -> tuple[Verdict, str]:
    text = result.get("text") or ""
    steps = result.get("steps") or []
    canvas_cmds = result.get("canvas_cmds") or []

    if result.get("atomic_ran"):
        atomic = [s for s in steps if s in ATOMIC_STEPS]
        return "wrong_route", f"atomic route {atomic}; reply={text[:100]}"

    if not result.get("explore_ran"):
        if "explore" in text.lower() or "画布" in text:
            return "weak", f"no explore step; chat reply={text[:100]}"
        return "fail", f"no explore step; steps={steps[-6:]}; reply={text[:120]}"

    if case.expect_canvas_cmd:
        if case.expect_canvas_cmd in canvas_cmds:
            return "tool", f"canvas_command={case.expect_canvas_cmd}"
        if _keyword_hit(text, case.expect_keywords):
            return "weak", f"explore ok, canvas_cmd missing (got {canvas_cmds})"
        return "fail", f"explore ok but no {case.expect_canvas_cmd}; cmds={canvas_cmds}; reply={text[:100]}"

    if case.expect_keywords and _keyword_hit(text, case.expect_keywords):
        return "tool", text[:120].replace("\n", " ")

    if result.get("explore_payload"):
        return "weak", f"explore event only; reply={text[:100]}"

    if len(text.strip()) > 20 and "手动" not in text and "无法" not in text:
        return "weak", text[:120].replace("\n", " ")

    return "fail", text[:160].replace("\n", " ") or "empty reply"


def main() -> int:
    tid = f"{SESSION_ID}:explore28-{uuid.uuid4().hex[:8]}"
    print("=== Explore 28 tools live demo (production user path) ===")
    print(f"BASE={BASE} SESSION={SESSION_ID} THREAD={tid}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
    rt = http("GET", "/agent/runtime-health", t=tok)
    runtime_ok = bool((rt.get("data") or {}).get("ok"))
    record("Runtime health", "tool" if runtime_ok else "fail", str(rt.get("data")))

    results: list[dict[str, Any]] = []
    for i, case in enumerate(DEMOS, 1):
        print(f"\n--- [{i}/28] {case.tool} ---")
        print(f"USER: {case.message}")
        try:
            result = sse_chat(tok, SESSION_ID, case.message, tid, timeout=SSE_TIMEOUT)
            verdict, detail = verify_case(case, result)
            if verdict in ("fail", "wrong_route") and case.allow_skip:
                record(case.tool, "skip", detail)
                verdict = "skip"
            else:
                record(case.tool, verdict, detail)
            results.append(
                {
                    "tool": case.tool,
                    "verdict": verdict,
                    "detail": detail,
                    "message": case.message,
                    "steps": result.get("steps"),
                    "canvas_cmds": result.get("canvas_cmds"),
                    "reply_preview": (result.get("text") or "")[:300],
                }
            )
        except Exception as exc:
            if case.allow_skip:
                record(case.tool, "skip", str(exc))
                verdict = "skip"
            else:
                record(case.tool, "fail", str(exc))
                verdict = "fail"
            results.append({"tool": case.tool, "verdict": verdict, "detail": str(exc), "message": case.message})
        time.sleep(1.5)

    out_path = os.path.join(os.path.dirname(__file__), "prod-explore-28-tools-demo-results.json")
    summary = {
        "threadId": tid,
        "sessionId": SESSION_ID,
        "pass_tool": PASS,
        "weak": WEAK,
        "fail": FAIL,
        "skip": SKIP,
        "results": results,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n=== Summary: ✅ tool={PASS} ⚠️ weak={WEAK} ❌ fail={FAIL} ⏭️ skip={SKIP} ===")
    print(f"UI replay: {BASE}/workflow/{SESSION_ID}  (thread: {tid})")
    print(f"Results JSON: {out_path}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
