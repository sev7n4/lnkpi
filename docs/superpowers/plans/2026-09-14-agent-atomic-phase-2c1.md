# Agent Atomic Phase 2c.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pending_confirm` nodes the SSOT for propose confirm/cancel chips across refresh/reload; confirm calls the same `generateForNode` as dock; cancel writes Nest SoT via `clearProposeGeneration`.

**Architecture:** Extend chip resolution to scan canvas nodes (selected → newest pending). Add Nest `clearProposeGeneration`. Wire AgentSideRail + CanvasPage cancel to Nest; keep confirm → `generateForNode`. Do not change interrupt-over-propose priority. No presentation/credit UI (2c.2). No atomic chip retirement (2c.3).

**Tech Stack:** Nest `agent-canvas-tools`; Vue AgentSideRail / CanvasPage / agentChipSet; Vitest + Nest vitest; optional prod smoke script.

**Spec:** [docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md](../specs/2026-09-14-agent-atomic-phase-2c-design.md) §1 / §6.0.3  
**Depends on:** Phase 2b merged (#312).

## Global Constraints

- **H1:** `run_*` never enter `model_visible_specs`.
- **H2:** No credits until confirm/dock generate starts.
- **H3:** Node is SSOT; chips are shortcuts only.
- **2c.1 only:** No 2c.2 presentation/credit; no 2c.3 atomic UX; no 2d subgraph delete.
- **Pinned (from spec §1.2):**
  1. Multi-pending: selected pending → else newest pending
  2. Interrupt chip still overrides propose recovery
  3. Confirm = `generateForNode`; never `sendPreset('确认生成')`
  4. Generate start clears `pending_confirm`
  5. Cancel = Nest `clear-propose-generation` then UI sync
- Branch: `feature/agent-atomic-phase-2c1` from latest `main`.
- Prefer TDD; additive Nest endpoints OK.

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md` | Spec (this phase) |
| `docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md` | D9 → authorize 2c.1; link §6.0.3 |
| `apps/server/.../agent-canvas-tools.service.ts` | `clearProposeGeneration` |
| `apps/server/.../agent-canvas-tools.controller.ts` | `POST clear-propose-generation` + DTO |
| `apps/server/.../agent-canvas-tools.service.test.ts` | C3 Nest unit |
| `apps/web/src/components/agent/agentChipSet.ts` | `resolvePendingConfirmNodeId(nodes, selectedId)` |
| `apps/web/src/components/agent/AgentSideRail.vue` | Chip from canvas pending + confirm/cancel handlers |
| `apps/web/src/pages/CanvasPage.vue` | Pass nodes/selection; Nest cancel; generate clears pending |
| `apps/web/.../agentChipSet.test.ts` (+ rail/handler tests) | C1/C2 |
| `deploy/prod-phase-2c1-verify.py` (optional) | C6 smoke |

---

### §6.0.3 Phase 2c.1 验收硬表（合入门禁）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **C1** | 无 toolCalls、仅画布 `pending_confirm` | 出 `generation_propose` chip（选中优先规则） |
| **C2** | 确认 | spy `generateForNode`；不 `sendPreset('确认生成')` |
| **C3** | 取消 | Nest clear；reload 非 pending |
| **C4** | tool_plan visible | 无 `run_image_generation` / `run_video_generation` |
| **C5** | route regression | 显式出图 / WORKFLOW → `canvas_agent` |
| **C6** | prod smoke | propose → refresh → confirm或cancel 可用 |

---

### Task 0: Branch + authorize docs

**Files:** parent spec D9 + this plan + 2c design (already drafted)

- [ ] **Step 1:** `git fetch origin main && git checkout -b feature/agent-atomic-phase-2c1 origin/main`
- [ ] **Step 2:** Parent D9: Phase 2b done；**2c.1 authorized**；2c.2/2c.3/2d 另开
- [ ] **Step 3:** Commit docs only

```bash
git add docs/superpowers/specs/2026-09-14-agent-atomic-phase-2c-design.md \
  docs/superpowers/plans/2026-09-14-agent-atomic-phase-2c1.md \
  docs/superpowers/specs/2026-09-14-agent-atomic-as-tools-design.md
git commit -m "$(cat <<'EOF'
docs: authorize Phase 2c.1 pending_confirm SSOT recover plan

EOF
)"
```

---

### Task 1: Failing tests C1–C3

**Files:** `agentChipSet.test.ts`, Nest service test, optional handler test

- [ ] **Step 1:** `resolvePendingConfirmNodeId` — selected wins; else newest; none → null
- [ ] **Step 2:** Chip detection with canvas nodes, **empty toolCalls** → `generation_propose` (C1)
- [ ] **Step 3:** Confirm handler test/spy: calls generateForNode, not sendPreset (C2)
- [ ] **Step 4:** Nest `clearProposeGeneration` failing test (C3)
- [ ] **Step 5:** Run → expect FAIL; commit tests

---

### Task 2: Nest `clearProposeGeneration`

- [ ] Implement service + controller + pass C3 tests
- [ ] Commit

```text
POST /agent/internal/clear-propose-generation
body: { sessionId, userId, nodeId }
→ { nodeId, status: 'draft', actions }
```

If node missing → NotFound. If not pending_confirm → idempotent draft OK (or BadRequest — pick **idempotent draft** for 2c.1).

---

### Task 3: Frontend SSOT recover + Nest cancel

- [ ] Implement `resolvePendingConfirmNodeId`
- [ ] AgentSideRail: resolve chip from props `canvasNodes` + `selectedNodeId` when toolCalls absent; keep interrupt override
- [ ] CanvasPage: pass nodes; cancel → API clear then patch/reload; confirm unchanged `generateForNode`
- [ ] Ensure generate path clears pending_confirm
- [ ] C1/C2 green; commit

---

### Task 4: Regression + PR

- [ ] C4 tool_plan / C5 route tests
- [ ] PR cite §6.0.3 C1–C6; **2c.1 only**
- [ ] After merge/deploy: C6 prod smoke

## Rollback

- Feature-flag chip recover from canvas nodes
- Cancel fallback to local patch only if Nest clear fails (log)

## Done when

- [ ] C1–C5 green in CI
- [ ] C6 prod smoke after deploy
- [ ] 2c.2 / 2c.3 / 2d **not** in same PR
