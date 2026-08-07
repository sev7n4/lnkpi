# ADR: Atomic Studio vs Campaign Orchestration Boundary (P5)

**Status:** Accepted  
**Date:** 2026-08-04  
**Context:** Phase 4 hybrid intent — prevent atomic gate from silently absorbing high-complexity marketing work.

## Decision

| User intent shape | Route | Rationale |
|-------------------|-------|-----------|
| Single / enumerated multi (≤5 same-modality items) | `atomic_create` | Single-shot Studio loop |
| ≥4 storyboard shots, 全链路, 详情页方案, 14节点 | `campaign` | Requires plan/split/topo |
| Vague「帮我生成」| `clarify` (parse) or `chat` | No silent node creation |
| Same-node retry「重新生成一张」| `atomic_regenerate` | LC-5 V2 |
| Variant retry「…背景改成白色」| `atomic_create` (new node) | User asked for another asset |
| Mixed image + video/audio multi | `await_atomic_confirm` | HITL before expensive gen |

## Rules

1. **L1 intake** may override `atomic_create` → `campaign` when `orchestration_complexity_intent` returns `campaign` **and** user has explicitly selected a Skill (`requested_skill_id`) with high-confidence plan intent. **Without explicit skill, silent campaign override is forbidden** (R0/R1, 2026-08-07).
2. **Parse** enforces `MAX_ATOMIC_MULTI_ITEMS = 5`; excess → clarify suggesting Campaign.
3. **LLM parse** does not change L1 `flow_mode`; only structure/items.
4. **Thread isolation:** atomic turns clear `split_manifest` (Phase 3).

## Supersedes (partial, R0/R1)

- Prior rule 1 allowed orchestration override from utterance keywords alone; replaced by `route_decide` + explicit skill contract per [platform-route-skill-boundary-design](../superpowers/specs/2026-08-07-platform-route-skill-boundary-design.md).
- `marketing_intent → enterprise-marketing-campaign` implicit binding removed (R0).
- `has_planning_image_conflict` exempts preserve phrases (主图风格/构图不变) for img2img (R0).

## Consequences

- Eval: `eval-orchestration-set.yaml` (20 cases) + existing 95-case routing set.
- Prod smoke: `deploy/prod-atomic-intent-verify.py` ≥12 cases covering regen, multi, variant, clarify.

## References

- `docs/superpowers/specs/2026-08-04-atomic-intent-hybrid-design.md` § Phase 4
- `services/agent-runtime/app/graph/atomic_intent.py` — `orchestration_complexity_intent`
