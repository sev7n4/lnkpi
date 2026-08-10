"""Product visual plan schema (spec §2.1 / appendix A)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.graph.atomic_parse_llm import extract_json_object

MAX_SCHEMES_PER_TYPE = 3
MIN_SCHEMES_PER_TYPE = 1
PHASE1_TARGET_TYPE: Literal["image"] = "image"


class VisualIntent(BaseModel):
    industry_context: str | None = None
    primary_goal: str
    domain_tags: list[str] = Field(default_factory=list)
    user_stated_constraints: list[str] = Field(default_factory=list)
    inferred_constraints: list[str] = Field(default_factory=list)
    output_types_requested: list[str] = Field(default_factory=list)
    default_type_set_applied: bool = False
    style_hints: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class VisualScheme(BaseModel):
    scheme_id: str
    name: str | None = None
    recommended: bool = False
    prompt: str
    key_elements: dict[str, Any] = Field(default_factory=dict)

    @field_validator("scheme_id", "prompt")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if not cleaned:
            raise ValueError("scheme_id and prompt are required")
        return cleaned


class ImageTypePlan(BaseModel):
    type_id: str
    type_label: str
    domain_tags: list[str] = Field(default_factory=list)
    target_type: Literal["image"] = PHASE1_TARGET_TYPE
    schemes: list[VisualScheme]
    selected_scheme_ids: list[str] = Field(default_factory=list)

    @field_validator("type_id", "type_label")
    @classmethod
    def _non_empty_id(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if not cleaned:
            raise ValueError("type_id and type_label are required")
        return cleaned

    @field_validator("target_type", mode="before")
    @classmethod
    def _default_target_type(cls, value: Any) -> str:
        if value is None or str(value).strip() == "":
            return PHASE1_TARGET_TYPE
        target = str(value).strip()
        if target != PHASE1_TARGET_TYPE:
            raise ValueError(f"Phase 1 only supports target_type={PHASE1_TARGET_TYPE!r}")
        return target

    @model_validator(mode="after")
    def _validate_schemes(self) -> ImageTypePlan:
        count = len(self.schemes)
        if count < MIN_SCHEMES_PER_TYPE or count > MAX_SCHEMES_PER_TYPE:
            raise ValueError(
                f"each image type must have {MIN_SCHEMES_PER_TYPE}..{MAX_SCHEMES_PER_TYPE} schemes"
            )
        scheme_ids = [s.scheme_id for s in self.schemes]
        if len(set(scheme_ids)) != len(scheme_ids):
            raise ValueError("scheme_id must be unique within an image type")
        recommended = [s for s in self.schemes if s.recommended]
        if len(recommended) > 1:
            raise ValueError("at most one recommended scheme per image type")
        return self


class ProductVisualPlan(BaseModel):
    visual_intent: VisualIntent
    image_types: list[ImageTypePlan]

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="after")
    def _validate_image_types(self) -> ProductVisualPlan:
        if not self.image_types:
            raise ValueError("image_types must not be empty")
        type_ids = [t.type_id for t in self.image_types]
        if len(set(type_ids)) != len(type_ids):
            raise ValueError("type_id must be unique across image_types")
        return self


def parse_product_visual_plan(raw: str) -> ProductVisualPlan:
    """Parse and validate LLM JSON into ProductVisualPlan."""
    data = extract_json_object(raw)
    if not isinstance(data, dict):
        raise ValueError("plan payload must be a JSON object")
    return ProductVisualPlan.model_validate(data)


def plan_all_types_single_scheme(plan: ProductVisualPlan) -> bool:
    return all(len(t.schemes) == 1 for t in plan.image_types)


def prefill_selected_schemes(plan: ProductVisualPlan) -> ProductVisualPlan:
    """Silent-select when every type has exactly one scheme (AC-5)."""
    if not plan_all_types_single_scheme(plan):
        return plan
    updated: list[ImageTypePlan] = []
    for image_type in plan.image_types:
        updated.append(
            image_type.model_copy(
                update={"selected_scheme_ids": [image_type.schemes[0].scheme_id]}
            )
        )
    return plan.model_copy(update={"image_types": updated})


def plan_to_state_dict(plan: ProductVisualPlan) -> dict[str, Any]:
    return plan.model_dump(mode="json")
