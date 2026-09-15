"""M3b: LLM structured lane decision (decide_lane) after hard short-circuit.

Spec: hard-feature short-circuit skips this module; on LLM/parse failure
fallback is canvas_agent (never zero-tool chat). Confidence < τ with a
non-agent lane → clarify_route.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence, TypedDict

from app.graph.atomic_parse_llm import extract_json_object
from app.graph.route_features import RouteFeatures

logger = logging.getLogger(__name__)

# Spec §3.4 / Global Constraints
CONFIDENCE_TAU = 0.55

ALLOWED_LANES: tuple[str, ...] = (
    "canvas_agent",
    "atomic_regenerate",
    "single_node",
    "campaign",
    "product_visual",
    "clarify_route",
)

_DECIDE_LANE_SYSTEM = """你是 Lnkpi 画布会话的 lane 路由器。根据用户 utterance、压缩多轮上下文与路由特征，输出 JSON（不要 markdown 代码块）。

输出 schema：
{
  "lane": "canvas_agent | atomic_regenerate | single_node | campaign | product_visual | clarify_route",
  "confidence": 0.0,
  "reason": "short",
  "clarify_question": null
}

硬约束：
- 无明确编排 hard 信号时偏向 canvas_agent（有工具控制面；闲聊也可）
- 明确「生成一张/来一张」类单点创作 → canvas_agent（由 agent 工具摆盘 + propose，禁止 atomic_create）
- 营销/详情页多节点编排 → campaign 或 clarify_route
- 歧义且无法安全偏向 agent → clarify_route，并给出 clarify_question
- confidence 为 0–1；不确定时降低 confidence
- 禁止输出 lane=atomic_create（已退役）
"""


class DecideLaneResult(TypedDict, total=False):
    lane: str
    confidence: float
    reason: str
    clarify_question: str | None


def _clamp_confidence(value: Any) -> float:
    try:
        conf = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, conf))


def parse_decide_lane_json(raw: str) -> DecideLaneResult | None:
    data = extract_json_object(raw)
    if not data:
        return None
    lane = str(data.get("lane") or "").strip()
    if lane == "chat" or lane == "explore_canvas":
        lane = "canvas_agent"
    # Phase 2d: map retired atomic_create before ALLOWED check
    if lane == "atomic_create":
        logger.info("decide_lane mapped atomic_create → canvas_agent (phase 2d)")
        lane = "canvas_agent"
    if lane not in ALLOWED_LANES:
        return None
    conf = _clamp_confidence(data.get("confidence"))
    reason = str(data.get("reason") or "decide_lane").strip() or "decide_lane"
    clarify = data.get("clarify_question")
    clarify_question = str(clarify).strip() if clarify else None
    return DecideLaneResult(
        lane=lane,
        confidence=conf,
        reason=reason,
        clarify_question=clarify_question,
    )


def _features_summary(features: RouteFeatures | None) -> str:
    if not features:
        return ""
    try:
        return json.dumps(dict(features), ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        return str(features)


def build_decide_lane_user_block(
    utterance: str,
    *,
    recent_turns: str = "",
    route_features: RouteFeatures | None = None,
    previous_lane: str | None = None,
    allowed_lanes: Sequence[str] | None = None,
) -> str:
    lanes = list(allowed_lanes) if allowed_lanes is not None else list(ALLOWED_LANES)
    parts = [
        f"utterance: {utterance.strip()}",
        f"allowed_lanes: {', '.join(lanes)}",
    ]
    if previous_lane:
        parts.append(f"previous_lane: {previous_lane}")
    if recent_turns.strip():
        parts.append(f"recent_turns:\n{recent_turns.strip()}")
    feat = _features_summary(route_features)
    if feat:
        parts.append(f"route_features: {feat}")
    return "\n".join(parts)


def _invoke_llm(llm: Any, messages: list[dict[str, str]]) -> str:
    """Sync invoke only — safe to call from async intake (LangChain Chat models).

    Models that only expose ``ainvoke`` must not be used here; nest a sync
    ``.invoke`` wrapper or call from an async helper that awaits ``ainvoke``.
    """
    if not hasattr(llm, "invoke"):
        raise TypeError("llm must provide sync invoke (ainvoke-only is not supported)")
    resp = llm.invoke(messages)
    return str(getattr(resp, "content", None) or "")


def decide_lane_llm(
    llm: Any,
    utterance: str,
    *,
    recent_turns: str = "",
    route_features: RouteFeatures | None = None,
    previous_lane: str | None = None,
    allowed_lanes: Sequence[str] | None = None,
) -> DecideLaneResult | None:
    """Call LLM for structured lane; None on failure."""
    if llm is None:
        return None
    user_block = build_decide_lane_user_block(
        utterance,
        recent_turns=recent_turns,
        route_features=route_features,
        previous_lane=previous_lane,
        allowed_lanes=allowed_lanes,
    )
    messages = [
        {"role": "system", "content": _DECIDE_LANE_SYSTEM},
        {"role": "user", "content": user_block},
    ]
    try:
        content = _invoke_llm(llm, messages)
        parsed = parse_decide_lane_json(content)
        if parsed is None:
            logger.warning("decide_lane_llm invalid JSON")
        return parsed
    except Exception as exc:  # noqa: BLE001
        logger.warning("decide_lane_llm failed: %s", exc)
        return None


def apply_decide_lane_postprocess(result: DecideLaneResult) -> DecideLaneResult:
    """Low confidence into a graph lane → clarify_route (τ = 0.55)."""
    lane = result.get("lane") or "canvas_agent"
    conf = _clamp_confidence(result.get("confidence"))
    # Treat retired atomic_create as a graph lane for low-confidence clarify,
    # then map any surviving atomic_create → canvas_agent (Phase 2d).
    if conf < CONFIDENCE_TAU and lane not in ("canvas_agent", "clarify_route"):
        return DecideLaneResult(
            lane="clarify_route",
            confidence=conf,
            reason=str(result.get("reason") or "low_confidence"),
            clarify_question=result.get("clarify_question")
            or "请确认：出图创作，还是画布控制面操作？",
        )
    if lane == "atomic_create":
        logger.info("decide_lane postprocess mapped atomic_create → canvas_agent")
        return DecideLaneResult(
            lane="canvas_agent",
            confidence=conf,
            reason=str(result.get("reason") or "decide_lane"),
            clarify_question=result.get("clarify_question"),
        )
    if conf < CONFIDENCE_TAU and lane == "clarify_route":
        return result
    return result
