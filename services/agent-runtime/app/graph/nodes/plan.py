"""DEPRECATED: monolithic plan node — superseded by the plan/ package (W10/G-P3).

This file is kept ONLY for backward compatibility. ``tests/test_plan_summary.py``
still imports ``build_confirm_message`` from this module. The actual plan pipeline
is now implemented as 4 single-responsibility nodes in ``app/graph.nodes.plan/``:

  decide_plan_mode → generate_plan → revise_manifest → compose_confirm

See ``app/graph/nodes/plan/__init__.py`` for ``register_plan_nodes`` and
``route_after_plan``.
"""

from __future__ import annotations

import warnings

from app.graph.nodes.plan._shared import (  # noqa: F401 — re-export for backward compat
    build_confirm_message,
)

warnings.warn(
    "Importing from 'app.graph.nodes.plan' (monolithic) is deprecated. "
    "Use 'app.graph.nodes.plan' package (register_plan_nodes / route_after_plan) instead.",
    DeprecationWarning,
    stacklevel=2,
)
