"""Prompt loading for product_visual v2 nodes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.graph.few_shot import build_llm_messages
from app.graph.nodes.plan._shared import latest_user_text, load_skill_by_id
from app.prompt_version import record_prompt_usage

SKILL_ID = "ecommerce-product-visual"


def _load_prompt_body(skills_dir: Path, rel_path: str, node_name: str) -> tuple[str, str]:
    skill = load_skill_by_id(SKILL_ID, skills_dir)
    prompt_file = skills_dir / SKILL_ID / rel_path
    body = prompt_file.read_text(encoding="utf-8")
    version = "1.0.0"
    record_prompt_usage(skill_id=SKILL_ID, prompt_version=version, node_name=node_name)
    return body, version


def load_dialog_draft_prompt(skills_dir: Path) -> tuple[str, str]:
    return _load_prompt_body(
        skills_dir, "assets/prompts/dialog-draft/1.0.0.md", "dialog_draft"
    )


def load_decompose_shots_prompt(skills_dir: Path) -> tuple[str, str]:
    return _load_prompt_body(
        skills_dir, "assets/prompts/decompose-shots/1.0.0.md", "decompose_from_ssot"
    )


def build_dialog_draft_user_content(*, user_brief: str, user_text: str, revision_feedback: str | None) -> str:
    bits = ["输出 dialog draft JSON（含 draft_prose 与 macro_schemes）。"]
    if user_brief.strip():
        bits.append(f"【用户需求锚定】\n{user_brief.strip()}")
    if user_text.strip():
        bits.append(f"【本轮用户表述】\n{user_text.strip()}")
    if revision_feedback:
        bits.append(f"【修订意见】\n{revision_feedback.strip()}")
    return "\n\n".join(bits)


def build_decompose_user_content(*, ssot_prose: str, user_text: str, selected_macro_ids: list[str]) -> str:
    return "\n\n".join(
        [
            "从 SSOT 拆解 L2 shot 清单 JSON。",
            f"【已选宏观方案】{', '.join(selected_macro_ids)}",
            f"【SSOT 正文】\n{ssot_prose.strip()}",
            f"【用户原始需求】\n{user_text.strip()}",
        ]
    )


def build_dialog_draft_messages(*, system: str, user: str) -> list[Any]:
    return build_llm_messages(system=system, user=user, few_shots=[])


def build_decompose_messages(*, system: str, user: str) -> list[Any]:
    return build_llm_messages(system=system, user=user, few_shots=[])
