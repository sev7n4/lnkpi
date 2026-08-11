"""Gen prompt synthesis from shot prose (spec R-Prompt-Synthesize)."""

from __future__ import annotations

from typing import Any


def synthesize_gen_prompt_hint(
    *,
    shot_prose: str,
    shot_label: str,
    type_id: str,
    visual_intent: dict[str, Any] | None = None,
) -> str:
    """Deterministic stub synthesizer; LLM implementation replaces internals."""
    intent = visual_intent or {}
    style = ", ".join(intent.get("style_hints") or []) or "commercial product visual"
    constraints = ", ".join(intent.get("user_stated_constraints") or [])
    base = (
        f"{type_id} generation: {shot_label}. "
        f"Style: {style}. "
        f"Composition brief: {shot_prose.strip()[:500]}"
    )
    if constraints:
        base += f" Constraints: {constraints}."
    base += " High quality, consistent with product reference images."
    if base.strip() == shot_prose.strip():
        base += " [synthesized]"
    return base.strip()
