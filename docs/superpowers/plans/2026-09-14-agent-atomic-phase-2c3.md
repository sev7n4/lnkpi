# Agent Atomic Phase 2c.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weaken legacy `await_atomic_confirm` UX so propose pending wins, and atomic confirm chips map to `generateForNode` (with interrupt unwind) instead of bare `sendPreset('确认生成')`.

**Architecture:** Pure helpers for chip precedence + atomic confirm mapping; AgentSideRail reads `atomicNodeId` from thread-state; confirm clears local interrupt and resumes revise to avoid double-gen. No subgraph deletion (2d).

**Tech Stack:** Vue AgentSideRail / agentChipSet / agentInterruptGate; Vitest; existing Nest thread-state `atomicNodeId`.

**Spec:** [docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md](../specs/2026-09-14-agent-atomic-phase-2c-design.md) §3 / §6.0.5  
**Depends on:** Phase 2c.1 (#314), 2c.2 (#316).

## Global Constraints

- H1/H2/H3 unchanged; `run_*` never visible.
- Confirm with resolvable nodeId → `generateForNode` + unwind atomic interrupt.
- Fallback `sendPreset` only when nodeId unresolved (tested).
- Other interrupts (image_qa / scheme / topo / delivery) unchanged.
- No 2d / Phase 3 in this PR.
- Branch: `feature/agent-atomic-phase-2c3` from latest `main`.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md` | Authorize §3 + E1–E6 |
| `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md` | D9 → 2c.3 |
| `apps/web/src/components/agent/agentChipSet.ts` | Propose-over-atomic precedence helper; `confirmAtomicGeneration` |
| `apps/web/src/components/agent/agentChipSet.test.ts` | E1–E3 (+ E4 regressions) |
| `apps/web/src/components/agent/AgentSideRail.vue` | Wire precedence, atomicNodeId, confirm/cancel handlers |
| Optional: `agentInterruptGate.ts` | Keep `await_atomic_confirm → atomic` mapping (unchanged) |

---

### §6.0.5 hard table

| ID | Expectation |
|----|-------------|
| E1 | pending + atomic interrupt → generation_propose |
| E2 | atomic confirm + nodeId → generateForNode, unwind interrupt |
| E3 | no nodeId → sendPreset fallback |
| E4 | 2c.1/2c.2 regressions |
| E5 | no run_* visible |
| E6 | prod smoke |

---

### Task 0: Docs authorize

- [ ] Update 2c design §3 + parent D9; commit with this plan

### Task 1: Failing tests E1–E3

- [ ] Chip precedence: pending beats `await_atomic_confirm`
- [ ] `confirmAtomicGeneration` with nodeId → generateForNode + unwind callback; no sendPreset confirm
- [ ] without nodeId → sendPreset('确认生成')
- [ ] Commit failing tests

### Task 2: Implement helpers + SideRail

- [ ] `resolveChipSetWithAtomicProposePriority(...)`
- [ ] `confirmAtomicGeneration` / `resolveAtomicConfirmNodeId`
- [ ] SideRail: store `atomicNodeId` from thread-state; wire confirm/cancel; unwind via clear gate + sendPreset('取消') or dedicated resume revise **without** starting atomic gen after dock confirm
- [ ] Tests green; commit

### Task 3: PR + E6 smoke

- [ ] Open PR 2c.3 only
- [ ] After deploy: propose path still works; document atomic fallback if hard to trigger in prod

## Done when

- [ ] E1–E5 CI green; E6 prod after deploy
- [ ] 2d not started
