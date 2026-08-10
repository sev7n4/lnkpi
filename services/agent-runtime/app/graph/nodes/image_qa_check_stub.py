"""Temporary stub for image_qa_check — replaced by real gate in Task 2."""

from __future__ import annotations

from typing import Callable


def make_image_qa_check_node() -> Callable:
    async def image_qa_check(_state: dict) -> dict:
        return {"phase": "image_qa"}

    return image_qa_check
