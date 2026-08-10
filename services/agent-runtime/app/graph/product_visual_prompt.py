"""Prompt assembly for plan_product_visual LLM node."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.graph.few_shot import build_llm_messages, few_shots_for_skill
from app.graph.nodes.plan._shared import latest_user_text, load_skill_by_id
from app.prompt_version import record_prompt_usage

SKILL_ID = "ecommerce-product-visual"
NODE_NAME = "plan_product_visual"

PLAN_INSTRUCTION = (
    "根据用户实拍需求与上下文，输出 product_visual_plan JSON（不要 markdown 代码块）。"
    "只输出 JSON 对象，禁止寒暄与过程说明。"
    "一期仅出图：所有 image_types[].target_type 必须为 image，禁止 video。"
    "每个类型 1~3 个 scheme；仅 1 个 scheme 时会被静默选中。"
)


def build_plan_user_content(
    *,
    user_brief: str,
    user_text: str,
    existing_plan: dict[str, Any] | None = None,
    revision_feedback: str | None = None,
) -> str:
    bits: list[str] = [PLAN_INSTRUCTION]
    if user_brief.strip():
        bits.append(f"【用户需求锚定】\n{user_brief.strip()}")
    if user_text.strip():
        bits.append(f"【本轮用户表述】\n{user_text.strip()}")
    if existing_plan:
        bits.append(
            "【已有方案 — 仅按用户反馈修订】\n"
            + json.dumps(existing_plan, ensure_ascii=False, indent=2)
        )
    if revision_feedback:
        bits.append(f"【修订意见】\n{revision_feedback.strip()}")
    return "\n\n".join(bits)


def load_plan_system_prompt(skills_dir: Path) -> tuple[str, str]:
    skill = load_skill_by_id(SKILL_ID, skills_dir)
    record_prompt_usage(
        skill_id=str(skill.index.skill_id),
        prompt_version=skill.prompt_version,
        node_name=NODE_NAME,
    )
    return skill.body, skill.prompt_version


def build_plan_llm_messages(
    *,
    system_prompt: str,
    user_content: str,
    skills_dir: Path,
) -> list[Any]:
    few_shots = few_shots_for_skill(SKILL_ID, NODE_NAME, skills_dir=skills_dir)
    return build_llm_messages(system=system_prompt, user=user_content, few_shots=few_shots)
