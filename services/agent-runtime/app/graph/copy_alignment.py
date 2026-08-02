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

# Channel / platform terms — must not satisfy alignment on their own
_CHANNEL_NOISE = frozenset(
    {
        "天猫",
        "京东",
        "抖音",
        "旗舰店",
        "官方",
        "自营",
        "电商",
        "官网",
        "店铺",
        "平台",
        "渠道",
        "销售",
        "正品",
        "联保",
        "退换",
        "物流",
        "客服",
    }
)

_PLAN_DRAFT_EXCERPT = 3200
_MAX_COPY_ATTEMPTS = 3


def _add_term(terms: list[str], seen: set[str], raw: str) -> None:
    t = raw.strip().strip("|").strip()
    if len(t) < 2 or t in _BRIEF_STOPWORDS or t in _PLAN_NOISE or t in seen:
        return
    seen.add(t)
    terms.append(t)


def _add_strong(terms: list[str], seen: set[str], raw: str) -> None:
    t = raw.strip().strip("|").strip("（）()")
    if len(t) < 2 or t in _BRIEF_STOPWORDS or t in _PLAN_NOISE or t in _CHANNEL_NOISE:
        return
    if t in seen:
        return
    seen.add(t)
    terms.append(t)


def extract_strong_anchors(user_brief: str, plan_draft: str) -> list[str]:
    """Brand + product category anchors — at least one must appear in copy."""
    terms: list[str] = []
    seen: set[str] = set()
    brief = (user_brief or "").strip()
    plan = (plan_draft or "").strip()

    for m in re.finditer(r"品牌\s*[:：]?\s*([A-Za-z0-9\u4e00-\u9fff]+)", brief):
        _add_strong(terms, seen, m.group(1))

    for m in re.finditer(r"\b[A-Za-z]{2,}\b", brief):
        w = m.group(0)
        if w.lower() not in {"ipod", "pro", "sku", "hero", "banner", "the", "and", "for"}:
            _add_strong(terms, seen, w)

    for pat in (
        r"\|\s*产品品类\s*\|\s*([^|\n]+)",
        r"\|\s*品牌名称\s*\|\s*([^|\n]+)",
        r"\|\s*品牌\s*\|\s*([^|\n]+)",
        r"产品类别\s*[:：]\s*([^\n|]+)",
        r"产品品类\s*[:：]\s*([^\n|]+)",
    ):
        m = re.search(pat, plan)
        if m:
            val = m.group(1).strip()
            for part in re.split(r"[/（(、,，]", val):
                chunk = part.strip()
                if chunk:
                    _add_strong(terms, seen, chunk)

    for m in re.finditer(r"[\u4e00-\u9fff]{3,8}", brief):
        chunk = m.group(0)
        if chunk not in _BRIEF_STOPWORDS and chunk not in _CHANNEL_NOISE:
            _add_strong(terms, seen, chunk)

    for m in re.finditer(r"\b[A-Za-z]{2,}\b", plan[:_PLAN_DRAFT_EXCERPT]):
        w = m.group(0)
        if w.lower() not in {"the", "and", "for", "pro", "sku", "hero", "banner", "ln"}:
            _add_strong(terms, seen, w)

    return terms[:12]


def extract_anchor_terms(user_brief: str, plan_draft: str) -> list[str]:
    """Terms that copy should reflect — derived from brief + plan, not hardcoded SKUs."""
    terms: list[str] = []
    seen: set[str] = set()
    brief = (user_brief or "").strip()
    plan = (plan_draft or "").strip()

    for t in extract_strong_anchors(brief, plan):
        _add_term(terms, seen, t)

    for m in re.finditer(r"[\u4e00-\u9fff]{2,8}", brief):
        _add_term(terms, seen, m.group(0))

    for m in re.finditer(r"[A-Za-z0-9]{2,}", brief):
        _add_term(terms, seen, m.group(0))

    excerpt = plan[:_PLAN_DRAFT_EXCERPT]
    for m in re.finditer(r"[\u4e00-\u9fff]{2,8}", excerpt):
        chunk = m.group(0)
        if chunk not in _CHANNEL_NOISE:
            _add_term(terms, seen, chunk)

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
    alignment_feedback: str = "",
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
    if alignment_feedback:
        parts.append(
            "【上次生成不合格 - 必须重写】\n"
            f"{alignment_feedback}\n"
            "请严格按方案中的品牌与产品品类重写，禁止写其他行业产品。"
        )
    strong = extract_strong_anchors(brief, plan)
    if strong:
        must = "、".join(strong[:6])
        parts.append(f"【必须出现的关键词】\n{must}")
    return "\n\n".join(parts)


def validate_copy_alignment(
    user_brief: str,
    plan_draft: str,
    copy_draft: str,
) -> tuple[bool, str | None]:
    """Return (ok, user-facing reason). Fail-closed when context or strong anchors missing."""
    body = (copy_draft or "").strip()
    if not body:
        return False, "主文案为空，无法写入。"

    brief = (user_brief or "").strip()
    plan = (plan_draft or "").strip()
    if not brief and not plan:
        return False, "缺少方案上下文，无法校验主文案一致性。请重新确认方案后再写入。"

    strong = extract_strong_anchors(brief, plan)
    if not strong:
        return False, "无法从需求/方案提取校验锚点，请重新确认方案后再写入。"

    hay = body.lower()
    strong_hits = [t for t in strong if t.lower() in hay]
    if not strong_hits:
        sample = "、".join(strong[:6])
        return False, (
            f"主文案与当前方案/需求不一致（缺少品牌或产品关键词：{sample}）。"
            "请说明修改意见后重新生成，或点「换方向」重开方案。"
        )

    return True, None
