"""L0 composition structure / confirm detectors (generic canvas compose)."""

from __future__ import annotations

import re

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


def is_composition_structure_utterance(text: str | None) -> bool:
    t = text or ""
    if _STRUCTURE_PLAN.search(t) and _STRUCTURE_PIPELINE.search(t):
        return True
    if _STRUCTURE_WIRE.search(t) and _STRUCTURE_LAND.search(t):
        return True
    return False


def is_composition_confirm_chip(text: str | None) -> bool:
    return is_planner_confirm_chip(text) or is_planner_cancel_chip(text)
