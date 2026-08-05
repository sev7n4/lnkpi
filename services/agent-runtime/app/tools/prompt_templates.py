"""Built-in prompt templates referenced by canvas agent tools.

Keep in sync with packages/agent/src/prompt-modes/modes/character-turnaround.ts
"""

from __future__ import annotations

from app.tools.character_turnaround_deai import format_deai_rules_for_system
from app.tools.character_turnaround_presets import (
    CHARACTER_TURNAROUND_EXAMPLE_USERS,
    CHARACTER_TURNAROUND_STYLE_PRESETS,
    format_style_presets_for_system,
)
CHARACTER_TURNAROUND_TEMPLATE = """一张专业的{摄影风格}写实摄影{图类型}，主角是一位{角色一句话概述}。

角色特征：{性别}，{年龄}，{体型描述（含身高）}，{肤色}，
发型：{发型详细描述}，
五官：{五官详细描述}，
服装：{完整服装描述，含风格与面料}，
配饰/道具：{配饰列表}。

「{背景描述}」，确保角色清晰突出。

{光线描述}。

画面分为四格布局，统一水平对齐、相同比例、相同服装与细节：
第一格：{近景特写描述}，
第二格：{正面全身描述}，
第三格：{侧面全身描述}，
第四格：{背面全身描述}。

{摄影风格}摄影风格，高分辨率，{重点材质质感}，专业{图类型}参考图品质。"""

CHARACTER_TURNAROUND_TRIGGERS = (
    "三视图",
    "多视图",
    "模特图",
    "角色设定图",
    "模特定妆图",
    "四视图",
    "正侧背",
    "turnaround",
)

CHARACTER_TURNAROUND_DEFAULTS = f"""【风格预设库（按用户意图选最接近者）】
{format_style_presets_for_system()}

{format_deai_rules_for_system()}

【默认值（用户未指定时）】
- 优先匹配上述预设；无明确风格时用「写实商业模拍」
- 图类型：角色设定图 / 模特定妆参考图
- 背景：「纯白背景」（赛博朋克/3D 等预设除外；写实模拍用白墙细微肌理）
- 四格：近景特写 + 正 / 侧 / 背全身

【质量要求】
0. 用户说「三视图」时：产品仍称三视图，但输出**必须是四格**（第一格近景特写 + 第二至四格正/侧/背全身），**禁止**写「三格布局」或省略近景格
1. 四格必须为同一角色、同一服装发型，禁止每格换人换装
2. 第一格为近景/特写，后三格为正 / 侧 / 背全身；四格同框、一次出图
3. **仅** photoreal_commercial「写实商业模拍」或用户明确要写实摄影真人模拍时启用「去AI化」与 Negative Prompt；其他 preset 禁止注入
4. 若用户要求多种风格，分段输出多个完整提示词
5. 若用户只要单张定妆/肖像（不含多视图），省略四格布局，改为单张半身或全身描述"""


def upsert_prompt_node_tool_description() -> str:
    triggers = " / ".join(CHARACTER_TURNAROUND_TRIGGERS)
    preset_labels = "、".join(p["label"] for p in CHARACTER_TURNAROUND_STYLE_PRESETS)
    example_hints = "\n".join(f"  · {u}" for u in CHARACTER_TURNAROUND_EXAMPLE_USERS[:4])
    return f"""创建或更新画布上的 prompt 节点。

当用户请求生成「{triggers}」等人物多视图提示词时：
- prompt：用户短需求原文（作节点标题）
- content：按内置 character_turnaround 模版生成**单段中文生图提示词**（连贯段落，非 Markdown 分节、非 JSON）

支持风格预设：{preset_labels}

内置模版骨架（将 {{占位符}} 替换为具体内容）：
{CHARACTER_TURNAROUND_TEMPLATE}

{CHARACTER_TURNAROUND_DEFAULTS}

样例用户说法：
{example_hints}

其他类型（营销方案、分镜、文案等）content 可输出 Markdown 结构化长文。"""


UPSERT_PROMPT_NODE_PROMPT_FIELD = "用户短需求原文，作 prompt 节点标题"

UPSERT_PROMPT_NODE_CONTENT_FIELD = """节点正文。人物多视图类（三视图/模特图/角色设定图/多视图/模特定妆图/四视图）须按内置 character_turnaround 模版输出单段中文生图提示词；营销方案等可输出 Markdown。"""
