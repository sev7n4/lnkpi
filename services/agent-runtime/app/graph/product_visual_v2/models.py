"""Pydantic models for product visual v2 (spec §4.1)."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from app.graph.atomic_parse_llm import extract_json_object
from app.graph.product_visual_v2.limits import is_valid_shot_id
from app.graph.product_visual_v2.scheme_draft import (
    SCHEME_DRAFT_HEADINGS,
    normalize_macro_scheme_card,
    scheme_draft_has_four_sections,
)


class MacroScheme(BaseModel):
    id: str
    label: str
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    recommended: bool = False
    recommend_reason: str | None = None

    @field_validator("id", "label")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if not cleaned:
            raise ValueError("macro scheme id and label are required")
        return cleaned


class DialogDraftOutput(BaseModel):
    draft_prose: str
    macro_schemes: list[MacroScheme]
    visual_intent: dict[str, Any] = Field(default_factory=dict)
    requires_standard_product_assets: bool = False

    @field_validator("draft_prose")
    @classmethod
    def _prose_min(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if len(cleaned) < 50:
            raise ValueError("draft_prose too short")
        if cleaned.startswith("{") and cleaned.endswith("}"):
            try:
                json.loads(cleaned)
                raise ValueError("draft_prose must not be JSON-only")
            except json.JSONDecodeError:
                pass
        if not scheme_draft_has_four_sections(cleaned):
            missing = [h for h in SCHEME_DRAFT_HEADINGS if h not in cleaned]
            raise ValueError(f"draft_prose missing sections: {missing}")
        return cleaned

    @model_validator(mode="after")
    def _validate_macros(self) -> DialogDraftOutput:
        if not self.macro_schemes:
            raise ValueError("macro_schemes must not be empty")
        ids = [m.id for m in self.macro_schemes]
        if len(set(ids)) != len(ids):
            raise ValueError("macro scheme ids must be unique")
        recommended = [m for m in self.macro_schemes if m.recommended]
        if len(recommended) > 1:
            raise ValueError("at most one macro scheme may be recommended")
        normalized = [normalize_macro_scheme_card(m.model_dump(mode="json")) for m in self.macro_schemes]
        self.macro_schemes = [MacroScheme.model_validate(item) for item in normalized]
        return self


class ShotManifestItem(BaseModel):
    shot_id: str
    type_id: str
    label: str
    shot_prose: str = ""
    macro_scheme_id: str | None = None
    node_id: str | None = None
    variant_count: int = Field(default=1, ge=1, le=3)
    variant_eligible: bool = False
    refs_policy: dict[str, Any] = Field(default_factory=dict)

    @field_validator("shot_id")
    @classmethod
    def _shot_id_format(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if not is_valid_shot_id(cleaned):
            raise ValueError(f"invalid shot_id format: {cleaned!r}")
        return cleaned


def parse_dialog_draft_output(raw: str) -> DialogDraftOutput:
    data = extract_json_object(raw)
    return DialogDraftOutput.model_validate(data)
