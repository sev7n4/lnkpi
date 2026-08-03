# Phase C：画布同步后出图 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement task-by-task.

**Goal:** 用户在 await_topo 手工改画布后，「执行生图/确认出图」以画布为准同步 manifest 再出图。

**Architecture:** `get_canvas_summary` → `reconcile_manifest_from_canvas` in `start_gen` before topo sort.

**Tech Stack:** Python agent-runtime, Nest internal API (已有 get-canvas-summary)

---

### Task 1: Contract + nest_client ✅
- `packages/shared/src/agentContract.ts`, `contract.py`, `verify-contract.ts`, `nest_client.get_canvas_summary`

### Task 2: canvas_sync + start_gen ✅
- `app/graph/canvas_sync.py`, `start_gen` 集成，`intent` 增加「执行生图」

### Task 3: Tests ✅
- `tests/test_canvas_sync.py`

### Task 4: Prod verify（后续）
- 扩展 `prod-phase-b-user-verify.py` 或 `prod-phase-c-user-verify.py`：手工 API 删/增 canvas 节点后「执行生图」

---

Spec: `docs/superpowers/specs/2026-08-03-agent-phase-c-canvas-sync-gen-design.md`
