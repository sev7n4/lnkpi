"""T5: unified clarify_context / pending_clarify."""

from __future__ import annotations

from app.graph.clarify_context import pending_clarify, pending_atomic_clarify


def test_pending_route_orchestration():
    state = {
        "clarify_context": {
            "kind": "route_orchestration",
            "original_utterance": "@T1 请按风格3出图",
            "clarify_question": "回复 1 / 2 / 3",
            "mentioned_keys": ["T1"],
        }
    }
    ctx = pending_clarify(state)
    assert ctx is not None
    assert ctx["kind"] == "route_orchestration"
    assert ctx["original_utterance"] == "@T1 请按风格3出图"
    assert ctx["mentioned_keys"] == ["T1"]


def test_pending_atomic_parse_still_works():
    state = {
        "clarify_context": {
            "original_utterance": "@I1 @I2 穿上",
            "clarify_question": "需要生成吗？",
            "clarify_kind": "img2img_confirm",
        }
    }
    ctx = pending_atomic_clarify(state)
    assert ctx is not None
    assert ctx["original_utterance"] == "@I1 @I2 穿上"


def test_pending_clarify_rejects_invalid_kind():
    state = {
        "clarify_context": {
            "kind": "unknown_kind",
            "original_utterance": "hello",
        }
    }
    assert pending_clarify(state) is None


def test_pending_clarify_requires_original_utterance():
    assert pending_clarify({"clarify_context": {"kind": "route_orchestration"}}) is None
