"""Photoreal turnaround de-AI rules (appended to main prompt; no separate negativePrompt field).

Keep in sync with packages/agent/src/prompt-modes/modes/character-turnaround-deai.ts
"""

from __future__ import annotations

PHOTOREAL_DEAI_PRESET_IDS = frozenset({"photoreal_commercial"})

TURNAROUND_NEGATIVE_PROMPT = (
    "3D render, CGI, plastic skin, waxy texture, over-smooth, airbrushed, "
    "porcelain skin, perfect symmetry, mannequin, stiff pose, high contrast HDR, "
    "overexposed, cartoon, illustration, flat lighting, no texture, glassy eyes, "
    "dead eyes, double chin (if not age-appropriate), cloned features"
)

DEAI_LENS_OPTICS = (
    "85mm定焦人像镜头、f/2.8大光圈浅景深、边缘自然暗角、轻微色散、"
    "柯达 Portra 400 胶片模拟与轻微颗粒"
    "（Shot on 85mm prime lens, aperture f/2.8, shallow depth of field, "
    "natural vignetting, slight chromatic aberration）"
)

DEAI_SKIN_BIOLOGY = (
    "鼻翼与脸颊可见毛孔、淡淡雀斑、眼角细纹、肤色自然不均、"
    "皮下毛细血管次表面散射、面部细微绒毛；真实油脂高光而非塑料反光；"
    "严禁只写「光滑皮肤」"
)

DEAI_LIGHT_PHYSICS = (
    "左侧单一自然窗光、由亮到暗自然光衰、右侧可见核心阴影、无填充光、"
    "布料褶皱深处环境光遮蔽；禁用柔光箱/HDR/死黑死白"
)

DEAI_BODY_DYNAMICS = (
    "放松且有张力的站姿、双肩不等高、轻微歪头、手势不对称、"
    "重心落于单腿、布料因重力产生斜向褶皱"
)


def should_apply_deai(preset_id: str) -> bool:
    return preset_id in PHOTOREAL_DEAI_PRESET_IDS


def format_deai_rules_for_system() -> str:
    return f"""【写实人物去AI化（**仅限写实**，其他风格 preset 整段省略）】
启用条件（须同时满足「写实摄影真人模拍」意图，且**不得**套用高定/赛博/动画/Q版/3D CG/美妆/插画等风格）：
- 选用 photoreal_commercial「写实商业模拍」preset；或
- 用户明确要求「写实/真实摄影/真人模拍/不像AI」且未指定任何非写实风格

**禁止**对 fashion_editorial、cyberpunk、anime、chibi、cg_digital_human、beauty_cosmetic、kpop 等一切非「写实商业模拍」preset 注入本段。

满足条件时，必须在单段提示词中连贯融入以下四维度（勿用 Markdown 小标题拆开）：
1. 摄影镜头物理：{DEAI_LENS_OPTICS}
2. 皮肤生物学：{DEAI_SKIN_BIOLOGY}
3. 光线物理：{DEAI_LIGHT_PHYSICS}
4. 人体微动态与不对称：{DEAI_BODY_DYNAMICS}

四格微动态策略（专克僵化排版）：禁止写「三格布局」或机械正/侧/背整齐排列；第一格近景强调皮肤微结构；第二格正面全身带重心偏移；第三格约45度微侧身（非纯90度侧）展示体积；第四格背面头部微偏露出耳廓，发丝粗细不一带轻微毛躁。背景可为白墙但须带细微墙面肌理，非纯白死白。

输出末尾单独一行追加：Negative Prompt：{TURNAROUND_NEGATIVE_PROMPT}"""
