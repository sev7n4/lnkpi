"""Atomic parse clarify — thin wrapper over unified clarify_gate."""

from __future__ import annotations

from typing import Callable

from app.graph.nodes.clarify_gate import make_clarify_gate_node

make_clarify_atomic_intent_node = make_clarify_gate_node
