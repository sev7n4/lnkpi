"""L0 composition structure / confirm detectors (generic canvas compose)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from app.graph.planner_copy import is_planner_cancel_chip, is_planner_confirm_chip

GOLD_COMPOSE_1 = (
    "@I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，"
    "写入画布，待我确认后再做生图生视频"
)
GOLD_COMPOSE_2 = (
    "@I1 是产品，@I2 是使用场景，先出一张白底再出一张场景图，连好线写到画布，先不要生成"
)

# Same keyword rules as packages/shared/src/canvas/compositionExtract.ts
_STRUCTURE_PLAN = re.compile(r"设计|规划|编排|做一段|做一套|做一个|搭一套")
_STRUCTURE_PIPELINE = re.compile(r"工作流|流水线")
_STRUCTURE_WIRE = re.compile(r"连线|连好线")
_STRUCTURE_LAND = re.compile(r"写入画布|落到画布|写到画布")
_RESUME_CONTINUE = re.compile(r"继续刚才|刚才那个")
_RESUME_ASSIGN = re.compile(r"@?I[0-9]+\s*(?:作为)?(?:是)?(?:模特|服装|产品|使用场景|场景)")
PENDING_TTL_MS = 15 * 60 * 1000


def is_composition_structure_utterance(text: str | None) -> bool:
    t = text or ""
    if _STRUCTURE_PLAN.search(t) and _STRUCTURE_PIPELINE.search(t):
        return True
    if _STRUCTURE_WIRE.search(t) and _STRUCTURE_LAND.search(t):
        return True
    return False


def is_composition_confirm_chip(text: str | None) -> bool:
    return is_planner_confirm_chip(text) or is_planner_cancel_chip(text)


def is_fresh_composition_pending(raw: Any) -> bool:
    if not raw:
        return False
    payload: Any = raw
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return True
    if not isinstance(payload, dict):
        return True
    ts = payload.get("ts")
    if not ts:
        return True
    try:
        parsed = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return True
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    age_ms = (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds() * 1000
    return age_ms <= PENDING_TTL_MS


def leaves_composition_pending(text: str | None) -> bool:
    t = text or ""
    if is_composition_structure_utterance(t):
        return False
    if "穿上" in t and "保持构图" in t:
        return True
    if _RESUME_CONTINUE.search(t) or _RESUME_ASSIGN.search(t):
        return False
    return True


def is_live_composition_pending(raw: Any, utterance: str | None = None) -> bool:
    if not is_fresh_composition_pending(raw):
        return False
    return not leaves_composition_pending(utterance)
