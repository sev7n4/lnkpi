"""L2/L3 node tests for product_visual v2."""

from __future__ import annotations

import json
from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.canvas_ssot_commit import build_ssot_content_from_state, make_canvas_ssot_commit_node
from app.graph.nodes.dialog_draft import make_dialog_draft_node
from app.graph.nodes.macro_scheme_select_gate import (
    apply_macro_scheme_decision,
    classify_macro_scheme_decision,
)
from app.graph.product_visual_v2.models import MacroScheme
from app.graph.product_visual_v2.ssot import ssot_section_keys


class FakeLLM:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls = 0

    async def ainvoke(self, messages: Any) -> Any:
        self.calls += 1

        class R:
            content = json.dumps(self.payload, ensure_ascii=False)

        return R()


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self._seq = 0

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, str]:
        self.calls.append(("upsert_prompt_node", kwargs))
        self._seq += 1
        return {"nodeId": f"node-{self._seq}"}


CRAB_DRAFT = {
    "draft_prose": "中秋大闸蟹礼盒采用红金配色，内衬 EPE 缓冲与冷链冰袋，外箱抗压设计。"
    * 8,
    "macro_schemes": [
        {
            "id": "A",
            "label": "红金礼盒",
            "summary": "中秋红金",
            "recommended": True,
            "recommend_reason": "契合节日氛围",
        },
        {
            "id": "B",
            "label": "极简牛皮",
            "summary": "环保简约",
            "recommended": False,
            "recommend_reason": "",
        },
    ],
    "visual_intent": {"primary_goal": "packaging_design", "style_hints": ["中秋红金"]},
    "requires_standard_product_assets": False,
}


@pytest.mark.asyncio
async def test_dialog_draft_dual_output(tmp_path):
    from app.config import settings

    skills = tmp_path / "skills"
    skill_dir = skills / "ecommerce-product-visual"
    prompt_dir = skill_dir / "assets" / "prompts" / "dialog-draft"
    prompt_dir.mkdir(parents=True)
    (prompt_dir / "1.0.0.md").write_text("system", encoding="utf-8")
    (skill_dir / "SKILL.md").write_text(
        "---\nname: ecommerce-product-visual\ndescription: test skill\nmetadata:\n  lnkpi.prompt_version: '1.0.0'\n---\n",
        encoding="utf-8",
    )

    llm = FakeLLM(CRAB_DRAFT)
    node = make_dialog_draft_node(llm=llm, skills_dir=skills)
    out = await node({"messages": [HumanMessage(content="大闸蟹包装")]})
    assert out["phase"] == "await_macro_scheme_select"
    assert len(out["macro_schemes"]) == 2
    assert llm.calls == 1
    assert "中秋" in out["messages"][0].content


@pytest.mark.asyncio
async def test_dialog_draft_single_skips_hitl(tmp_path):
    skills = tmp_path / "skills"
    skill_dir = skills / "ecommerce-product-visual"
    prompt_dir = skill_dir / "assets" / "prompts" / "dialog-draft"
    prompt_dir.mkdir(parents=True)
    (prompt_dir / "1.0.0.md").write_text("system", encoding="utf-8")
    (skill_dir / "SKILL.md").write_text(
        "---\nname: ecommerce-product-visual\ndescription: test skill\nmetadata:\n  lnkpi.prompt_version: '1.0.0'\n---\n",
        encoding="utf-8",
    )
    single = {**CRAB_DRAFT, "macro_schemes": [CRAB_DRAFT["macro_schemes"][0]]}
    node = make_dialog_draft_node(llm=FakeLLM(single), skills_dir=skills)
    out = await node({"messages": [HumanMessage(content="x")]})
    assert out["phase"] == "canvas_ssot_commit"
    assert out["selected_macro_scheme_ids"] == ["A"]


def test_macro_confirm_p2_nocanvas_before_ssot():
    decision = classify_macro_scheme_decision(
        '__macro_scheme_decision__{"action":"confirm","selected_ids":["A"]}'
    )
    assert decision["action"] == "confirm"
    schemes = [MacroScheme(id="A", label="A", summary="s").model_dump(mode="json")]
    out = apply_macro_scheme_decision(
        {"macro_schemes": schemes},
        {**decision, "selected_ids": ["A"]},
    )
    assert out["phase"] == "canvas_ssot_commit"


@pytest.mark.asyncio
async def test_canvas_ssot_commit_upsert():
    nest = FakeNest()
    node = make_canvas_ssot_commit_node(nest=nest)
    state = {
        "macro_scheme_draft": CRAB_DRAFT["draft_prose"],
        "selected_macro_scheme_ids": ["A"],
        "macro_schemes": CRAB_DRAFT["macro_schemes"],
        "visual_intent": {"primary_goal": "packaging_design"},
    }
    out = await node(state)
    assert out["plan_node_id"] == "node-1"
    assert out["phase"] == "decompose_from_ssot"
    assert nest.calls[0][0] == "upsert_prompt_node"
    content = nest.calls[0][1]["content"]
    assert "中秋" in content
    assert not content.strip().startswith('{"image_types"')


def test_build_ssot_ab_sections():
    content = build_ssot_content_from_state(
        {
            "macro_scheme_draft": "draft",
            "selected_macro_scheme_ids": ["A", "B"],
            "macro_schemes": [
                {"id": "A", "label": "A"},
                {"id": "B", "label": "B"},
            ],
        }
    )
    assert "## 方案 A" in content
    assert "## 方案 B" in content
    assert ssot_section_keys(content) == ["A", "B"]


def test_build_ssot_ab_sections_from_marked_draft():
    body_a = "红金礼盒方案正文。" * 8
    body_b = "极简牛皮方案正文。" * 8
    draft = f"## 方案 A\n\n{body_a}\n\n## 方案 B\n\n{body_b}"
    content = build_ssot_content_from_state(
        {
            "macro_scheme_draft": draft,
            "selected_macro_scheme_ids": ["A", "B"],
            "macro_schemes": [
                {"id": "A", "label": "A"},
                {"id": "B", "label": "B"},
            ],
        }
    )
    assert ssot_section_keys(content) == ["A", "B"]
    assert body_a.strip() in content
    assert body_b.strip() in content
