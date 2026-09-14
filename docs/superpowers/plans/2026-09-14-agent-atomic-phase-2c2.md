# Agent Atomic Phase 2c.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a formal `generation_propose` presentation card built from node SSOT (prompt/params summary; optional `credits_hint`) whenever propose chips are shown—including after refresh—without changing confirm=`generateForNode` or Nest cancel.

**Architecture:** Pure `buildGenerationProposePresentation(node)` → `AgentPresentationEnvelope`. AgentSideRail renders it via `AgentPresentationHost` (or thin wrapper) above confirm/cancel chips when `generation_propose`. Credits optional. Keep 2c.1 interrupt override + SSOT chip recovery.

**Tech Stack:** Vue AgentSideRail / presentation types; Vitest; optional Nest summary field pass-through only if already present.

**Spec:** [docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md](../specs/2026-09-14-agent-atomic-phase-2c-design.md) §2 / §6.0.4  
**Depends on:** Phase 2c.1 (#314).

## Global Constraints

- H1/H2/H3 unchanged; `run_*` never visible.
- Credits estimate **optional** (approved): missing must not block.
- Confirm = `generateForNode`; cancel = Nest clear (2c.1).
- No 2c.3 / 2d in this PR.
- Branch: `feature/agent-atomic-phase-2c2` from latest `main`.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md` | Authorize 2c.2 + §6.0.4 |
| `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md` | D9 → 2c.2 |
| `apps/web/src/components/agent/generationProposePresentation.ts` | `buildGenerationProposePresentation` |
| `apps/web/src/components/agent/generationProposePresentation.test.ts` | D1–D4 |
| `apps/web/.../presentation/AgentPresentationHost.vue` | Render `generation_propose` body (summary list + optional credits) |
| `apps/web/.../AgentSideRail.vue` | Bind presentation when awaitingGenerationPropose |
| Existing 2c.1 tests | D5/D6 regression |

---

### §6.0.4 hard table

| ID | Expectation |
|----|-------------|
| D1 | envelope kind + prompt preview from node |
| D2 | follows node prompt changes |
| D3 | ok without credits_hint |
| D4 | surfaces credits_hint when present |
| D5 | confirm still generateForNode |
| D6 | refresh recover still shows chip (+ card) |
| D7 | prod smoke |

---

### Task 0: Docs authorize

- [ ] Update 2c design §2 + parent D9; commit with this plan

### Task 1: Failing tests D1–D4

- [ ] Create `generationProposePresentation.test.ts` asserting D1–D4
- [ ] Commit failing tests

### Task 2: Builder + Host render

- [ ] Implement `buildGenerationProposePresentation`
- [ ] Host: `kind === 'generation_propose'` shows title, prompt preview, key params, optional credits_hint
- [ ] Tests pass; commit

### Task 3: Wire AgentSideRail

- [ ] When `awaitingGenerationPropose`, compute presentation from resolved pending node (canvasNodes)
- [ ] Render `AgentPresentationHost` above chips; primary chips unchanged
- [ ] D5/D6 regression green; commit

### Task 4: PR + D7 smoke after deploy

- [ ] Open PR 2c.2 only
- [ ] After merge/deploy: propose → see summary card → clear or confirm

## Done when

- [ ] D1–D6 CI green; D7 prod after deploy
- [ ] 2c.3 not started
