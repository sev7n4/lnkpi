"""Fallback dialog draft when LLM JSON parse fails (P0 degrade path)."""

from __future__ import annotations

from app.graph.product_visual_v2.models import DialogDraftOutput, MacroScheme
from app.graph.product_visual_v2.utterance import extract_user_request_labels
from app.graph.product_visual_v2.visual_intent import normalize_visual_intent


def build_fallback_dialog_draft(user_text: str) -> DialogDraftOutput:
    labels = extract_user_request_labels(user_text)
    label_line = "、".join(labels[:6]) if labels else "主图、场景与详情类电商用图"
    demand = (user_text or "您的电商视觉需求").strip()[:240]

    prose = f"""## 我理解您的需求
{demand}

## 设计方向摘要
围绕{label_line}，采用清晰、适合电商转化与平台规范的视觉风格；突出产品卖点与质感。

## 完整方案说明
将基于您上传的产品实拍图，分别产出各类电商用图。具体构图与文案将在确认宏观方案后拆解到画布节点。

## 接下来请您
请在下方选择宏观方案（最多 2 套），确认后继续。"""

    macros = [
        MacroScheme(
            id="A",
            label="方案 A · 清晰转化",
            summary="强调产品主体与白底/场景对比，适合主图与详情首屏。",
            tags=["电商", "清晰"],
            recommended=True,
            recommend_reason="默认推荐，兼顾主图与详情转化",
        ),
        MacroScheme(
            id="B",
            label="方案 B · 场景氛围",
            summary="更强生活场景与情绪表达，适合模特展示与营销海报。",
            tags=["场景", "氛围"],
            recommended=False,
        ),
    ]

    intent = normalize_visual_intent(
        {
            "primary_goal": "mixed_ecommerce",
            "confidence": 0.4,
            "user_stated_constraints": [],
            "output_types_requested": labels[:6],
        },
        user_text,
    )

    return DialogDraftOutput(
        draft_prose=prose,
        macro_schemes=macros,
        visual_intent=intent,
        requires_standard_product_assets=True,
    )
