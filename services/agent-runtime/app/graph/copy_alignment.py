"""Copy draft context assembly and brief-alignment harness."""

from __future__ import annotations

import re

# Generic stopwords — not product-specific hardcoding
_BRIEF_STOPWORDS = frozenset(
    {
        "请",
        "帮我",
        "帮",
        "我",
        "做",
        "一个",
        "的",
        "营销",
        "方案",
        "请帮",
        "制作",
        "生成",
        "设计",
        "写出",
        "创建",
    }
)

_PLAN_NOISE = frozenset(
    {
        "市场背景",
        "目标人群",
        "默认设定",
        "项目参数",
        "核心卖点",
        "销售渠道",
        "视觉资产",
        "方案全文",
        "确认方案",
    }
)

_PLAN_DRAFT_EXCERPT = 3200


def _add_term(terms: list[str], seen: set[str], raw: str) -> None:
    t = raw.strip().strip("|").strip()
    if len(t) < 2 or t in _BRIEF_STOPWORDS or t in _PLAN_NOISE or t in seen:
        return
    seen.add(t)
    terms.append(t)


def extract_anchor_terms(user_brief: str, plan_draft: str) -> list[str]:
    """Terms that copy should reflect — derived from brief + plan, not hardcoded SKUs."""
    terms: list[str] = []
    seen: set[str] = set()
    brief = (user_brief or "").strip()
    plan = (plan_draft or "").strip()

    for m in re.finditer(r"品牌\s*[:：]?\s*([A-Za-z0-9\u4e00-\u9fff]+)", brief):
        _add_term(terms, seen, m.group(1))

    for m in re.finditer(r"[\u4e00-\u9fff]{2,8}", brief):
        _add_term(terms, seen, m.group(0))

    for m in re.finditer(r"[A-Za-z0-9]{2,}", brief):
        _add_term(terms, seen, m.group(0))

    for pat in (
        r"\|\s*产品品类\s*\|\s*([^|\n]+)",
        r"\|\s*品牌名称\s*\|\s*([^|\n]+)",
        r"\|\s*品牌\s*\|\s*([^|\n]+)",
    ):
        m = re.search(pat, plan)
        if m:
            val = m.group(1).strip()
            for part in re.split(r"[/（(、]", val):
                _add_term(terms, seen, part.strip())

    excerpt = plan[:_PLAN_DRAFT_EXCERPT]
    for m in re.finditer(r"[\u4e00-\u9fff]{2,8}", excerpt):
        _add_term(terms, seen, m.group(0))

    for m in re.finditer(r"\b[A-Za-z]{2,}\b", excerpt):
        w = m.group(0)
        if w.lower() not in {"the", "and", "for", "pro", "sku", "hero", "banner"}:
            _add_term(terms, seen, w)

    return terms[:18]


def build_copy_writer_context(
    *,
    user_brief: str,
    plan_draft: str,
    plan_summary: str,
    hint: str,
    user_revision: str = "",
) -> str:
    """Assemble LLM human message — brief + plan SoT, summary is supplementary only."""
    parts: list[str] = []
    brief = (user_brief or "").strip()
    if brief:
        parts.append(
            "【用户需求锚定 - 不可偏离】\n"
            f"{brief}\n"
            "主文案必须与上述产品/品牌一致，禁止换品类或写无关产品。"
        )
    plan = (plan_draft or "").strip()
    if plan:
        excerpt = plan if len(plan) <= _PLAN_DRAFT_EXCERPT else plan[:_PLAN_DRAFT_EXCERPT] + "\n…"
        parts.append(f"【已确认营销方案（全文摘录）】\n{excerpt}")
    summary = (plan_summary or "").strip()
    if summary:
        parts.append(f"【方案一句话摘要（仅供参考）】\n{summary}")
    if hint:
        parts.append(f"【主文案节点提示】\n{hint}")
    if user_revision:
        parts.append(f"【用户修改意见】\n{user_revision}")
    return "\n\n".join(parts)


def validate_copy_alignment(
    user_brief: str,
    plan_draft: str,
    copy_draft: str,
) -> tuple[bool, str | None]:
    """Return (ok, user-facing reason). Skip when no anchors can be derived."""
    body = (copy_draft or "").strip()
    if not body:
        return False, "主文案为空，无法写入。"

    anchors = extract_anchor_terms(user_brief, plan_draft)
    if not anchors:
        return True, None

    hay = body.lower()
    hits = [t for t in anchors if t.lower() in hay]
    required = min(2, len(anchors)) if len(anchors) >= 2 else 1
    if len(hits) >= required:
        return True, None

    sample = "、".join(anchors[:6])
    return False, (
        f"主文案与当前方案/需求不一致（缺少关键信息：{sample}）。"
        "请说明修改意见后重新生成，或点「换方向」重开方案。"
    )
