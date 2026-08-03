"""W20: Few-shot loading and build_llm_messages assembly."""

from __future__ import annotations

from pathlib import Path

import yaml
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.few_shot import build_llm_messages, few_shots_for_skill, load_few_shots


def test_load_few_shots_from_yaml(tmp_path: Path):
    skill_dir = tmp_path / "demo-skill"
    assets = skill_dir / "assets"
    assets.mkdir(parents=True)
    (assets / "few-shots.yaml").write_text(
        yaml.dump(
            {
                "nodes": {
                    "generate_plan": [
                        {"user": "u1", "assistant": "a1"},
                        {"user": "u2", "assistant": "a2"},
                    ]
                }
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    loaded = load_few_shots(skill_dir)
    assert loaded["generate_plan"] == [("u1", "a1"), ("u2", "a2")]


def test_build_llm_messages_order():
    msgs = build_llm_messages(
        system="sys",
        user="final",
        few_shots=[("ex-u", "ex-a")],
    )
    assert [type(m).__name__ for m in msgs] == [
        "SystemMessage",
        "HumanMessage",
        "AIMessage",
        "HumanMessage",
    ]
    assert isinstance(msgs[0], SystemMessage) and msgs[0].content == "sys"
    assert isinstance(msgs[1], HumanMessage) and msgs[1].content == "ex-u"
    assert isinstance(msgs[2], AIMessage) and msgs[2].content == "ex-a"
    assert isinstance(msgs[3], HumanMessage) and msgs[3].content == "final"


def test_builtin_skill_few_shots():
    root = Path(__file__).resolve().parents[1] / "skills"
    shots = few_shots_for_skill(
        "enterprise-marketing-campaign",
        "generate_plan",
        skills_dir=root,
    )
    assert len(shots) >= 1
    assert "lnkpi" in shots[0][1].lower()
