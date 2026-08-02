"""Shared constants and helper functions for the plan pipeline nodes.

Extracted from the monolithic ``plan.py`` during the W10 refactor
(G-P3: plan node split). Each node imports from here instead of duplicating logic.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.plan_clean import strip_plan_preamble
from app.skills.loader import discover_skills, load_skill

logger = logging.getLogger(__name__)

# ── Mode-specific instruction prompts ──────────────────────────────────

CREATE_INSTRUCTION = (
    "请根据用户需求输出完整企业营销方案 Markdown（含定位、文案与视觉资产章节）。"
    "只输出方案 Markdown 正文，从一级标题开始，禁止寒暄与过程说明。"
)

MODIFY_INSTRUCTION = (
    "你正在「修改模式」：用户对已有方案提出调整意见。"
    "请基于【已有方案】进行【增量修改】，严格保留未被提及的节点与文案，只调整用户明确要求变化的部分。"
    "禁止重新生成全新主题；禁止换行业/换产品；必须保持与首轮用户需求锚定一致。"
    "只输出修改后的完整方案 Markdown 正文（包含保留部分），从一级标题开始，禁止寒暄。"
)

NODE_OPS_SYSTEM = (
    "你是画布节点编辑器。根据用户修改意见，对现有节点输出操作列表。\n"
    "只输出 JSON 数组，禁止解释、禁止 markdown 代码块。\n\n"
    "操作类型：\n"
    "- rename: 修改已有节点。字段: op,key,title,prompt_hint\n"
    "- add: 新增节点。字段: op,key,title,target_type(image|text|video),prompt_hint,depends_on(可选)\n"
    "- delete: 删除节点。字段: op,key\n\n"
    "规则：rename/delete 的 key 必须是现有节点；add 的 key 用英文蛇形命名；depends_on 只能引用现有 key。"
)


# ── Text helpers ───────────────────────────────────────────────────────

def latest_user_text(messages: list[Any]) -> str:
    """Return the most recent human/user message content."""
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


_SECTION_HEADING = re.compile(r"^[\d\.]+\s+[\u4e00-\u9fffA-Za-z0-9\s]{0,24}$")


def _is_low_signal_line(text: str) -> bool:
    """Skip section labels like '2.1 市场背景' when building one-line summaries."""
    cleaned = text.lstrip("#>*- ").strip()
    if len(cleaned) < 10:
        return True
    if cleaned in ("市场背景", "目标人群", "核心卖点", "竞争定位"):
        return True
    if _SECTION_HEADING.match(cleaned) and len(cleaned) < 28:
        return True
    return False


def positioning_line(plan_md: str) -> str:
    """Extract substantive positioning text — not bare section numbers."""
    lines = [ln.strip() for ln in (plan_md or "").splitlines() if ln.strip()]
    for i, ln in enumerate(lines):
        if "定位" in ln.lstrip("# ").strip():
            for nxt in lines[i + 1 : i + 8]:
                cleaned = nxt.lstrip("#>*- ").strip()
                if not cleaned or "定位" in cleaned or _is_low_signal_line(cleaned):
                    continue
                return cleaned[:120]
    for ln in lines:
        if ln.startswith("#"):
            continue
        cleaned = ln.lstrip("#>*- ").strip()
        if cleaned and not _is_low_signal_line(cleaned):
            return cleaned[:120]
    if lines:
        return lines[0].lstrip("# ").strip()[:120]
    return "（见画布方案节点）"


def manifest_titles(canvas_manifest: dict | None) -> list[str]:
    if not canvas_manifest or not isinstance(canvas_manifest.get("items"), list):
        return []
    titles: list[str] = []
    for raw in canvas_manifest["items"]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or raw.get("key") or "").strip()
        if title:
            titles.append(title)
    return titles


def summarize(plan_md: str, limit: int = 280) -> str:
    return positioning_line(plan_md)[:limit]


def canvas_has_nodes(state: dict) -> bool:
    """画布是否已有拆解节点（区分 node_revise 拓扑门修改 vs revise 方案门改方向）。"""
    for it in state.get("split_manifest") or []:
        if isinstance(it, dict) and it.get("node_id"):
            return True
    return False


def current_nodes_brief(split_manifest: list[dict] | None) -> str:
    """Compact 'key: title' list of current canvas nodes for LLM context."""
    if not split_manifest:
        return "（无节点）"
    lines = []
    for it in split_manifest:
        if not isinstance(it, dict) or not it.get("key"):
            continue
        lines.append(f"- {it.get('key')}: {it.get('title') or it.get('key')}")
    return "\n".join(lines) if lines else "（无节点）"


# ── Confirm message builder ────────────────────────────────────────────

def build_confirm_message(*, plan_md: str, canvas_manifest: dict | None) -> str:
    """Readable confirm gate: summary + structured options (no canvas write yet)."""
    pos = positioning_line(plan_md)
    titles = manifest_titles(canvas_manifest)
    n = len(titles)
    asset_lines = "\n".join(f"- {t}" for t in titles) if titles else "- （Skill 未声明资产清单）"
    return (
        f"定位：{pos}\n"
        f"拟定拆解约 {n} 个画布节点（确认方案后写入画布并进入骨架预览，预览无误再生成图片）：\n"
        f"{asset_lines}\n"
        "方案全文见上方摘要（确认前不会写入画布节点）。\n\n"
        "请选择：\n"
        "1. 采纳推荐并确认方案（推荐：按当前摘要落稿，进入骨架预览）\n"
        "2. 换个方向再改一版（例如更偏天猫详情页 / 更强调卖点）\n"
        "3. 我自己说明修改\n"
        "回复编号或直接说明修改意见即可。"
    )


# ── Node operations (revise_manifest) ──────────────────────────────────

def parse_node_operations(raw: str) -> list[dict] | None:
    """Robustly parse LLM JSON array of node operations; return None on failure."""
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text.strip("`")
        if text.endswith("```"):
            text = text[: -3].rstrip()
        text = text.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(parsed, list) or not parsed:
        return None
    cleaned = []
    for item in parsed:
        if not isinstance(item, dict) or not item.get("op"):
            continue
        op = str(item["op"]).lower()
        if op not in ("rename", "add", "delete"):
            continue
        if not item.get("key"):
            continue
        cleaned.append(item)
    return cleaned if cleaned else None


async def revise_operations_via_llm(
    *,
    llm: Any,
    split_manifest: list[dict] | None,
    user_text: str,
) -> list[dict] | None:
    """Ask LLM for node operations (rename/add/delete). None = parse failure / fallback."""
    human = (
        f"现有节点：\n{current_nodes_brief(split_manifest)}\n\n"
        f"用户修改意见：{user_text}\n\n"
        "输出操作列表 JSON 数组。"
    )
    try:
        ai = await llm.ainvoke(
            [
                SystemMessage(content=NODE_OPS_SYSTEM),
                HumanMessage(content=human),
            ]
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("node ops LLM call failed: %s", exc)
        return None
    raw = str(getattr(ai, "content", ai) or "")
    ops = parse_node_operations(raw)
    if ops is None:
        logger.warning("node ops parse failed; raw head=%r", raw[:200])
    return ops


# ── Skill loading ─────────────────────────────────────────────────────

def load_skill_by_id(skill_id: str, skills_dir: Any) -> Any:
    """Load a skill object by skill_id; raise RuntimeError if not found."""
    entries = {e.skill_id: e for e in discover_skills(skills_dir)}
    if skill_id not in entries:
        raise RuntimeError(f"unknown skill_id: {skill_id}")
    return load_skill(entries[skill_id])
