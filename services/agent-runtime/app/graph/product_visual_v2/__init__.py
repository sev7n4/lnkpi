"""Product visual scheme v2 (prose SSOT + L1/L2/L3). Spec 2026-08-11."""

from app.graph.product_visual_v2.limits import (
    MAX_DOWNSTREAM,
    MAX_MACRO_SCHEMES_SELECTED,
    MAX_SHOTS_PER_MACRO_SCHEME,
    count_downstream,
    is_valid_shot_id,
    validate_downstream_limit,
)
from app.graph.product_visual_v2.macro_select import (
    apply_macro_selection,
    normalize_recommended_macros,
    should_skip_macro_hitl,
    validate_macro_selection,
)
from app.graph.product_visual_v2.models import DialogDraftOutput, MacroScheme, ShotManifestItem
from app.graph.product_visual_v2.routing import (
    is_v2_enabled,
    route_after_image_qa_check_v2,
    route_after_dialog_draft,
)
from app.graph.product_visual_v2.ssot import build_ssot_prose, is_prose_content, prose_min_length
from app.graph.product_visual_v2.synthesize import synthesize_gen_prompt_hint
from app.graph.product_visual_v2.vision_qa import VisionQAResult, evaluate_vision_qa_v2

__all__ = [
    "MAX_DOWNSTREAM",
    "MAX_MACRO_SCHEMES_SELECTED",
    "MAX_SHOTS_PER_MACRO_SCHEME",
    "DialogDraftOutput",
    "MacroScheme",
    "ShotManifestItem",
    "VisionQAResult",
    "apply_macro_selection",
    "build_ssot_prose",
    "count_downstream",
    "evaluate_vision_qa_v2",
    "is_prose_content",
    "is_valid_shot_id",
    "is_v2_enabled",
    "normalize_recommended_macros",
    "prose_min_length",
    "route_after_dialog_draft",
    "route_after_image_qa_check_v2",
    "should_skip_macro_hitl",
    "synthesize_gen_prompt_hint",
    "validate_downstream_limit",
    "validate_macro_selection",
]
