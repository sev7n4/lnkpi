# Agent 侧栏识图 P0.5：重试 / 预算 / 错误包收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 Runtime×Nest 双重重试、让墙钟 180s 真正约束单次 Nest 调用、空内容按格式异常硬失败、Nest catch 回包带 `errorClass`。

**Architecture:** 重试权威留在 Runtime `parse_sidebar_media`（N=2 / 最多 3 attempt + 180s）。Nest `runVisionQaInternal` 调 `generateVisionQaJson` 时 **`maxRetries: 0`**；`nest_client.run_vision_qa` 超时改为 `min(120, remaining_budget)`。空 LLM content 立即 throw，不 `continue`。catch 路径映射 `errorClass` + 中性 reason。

**Tech Stack:** `@lnkpi/agent` `vision-qa-json.ts`、Nest `studio.service.ts`、Runtime `nest_client.py` / `parse_sidebar_media.py`、Vitest / pytest。

**Parent spec:** [2026-09-16-agent-sidebar-vision-provider-context-design.md](../specs/2026-09-16-agent-sidebar-vision-provider-context-design.md)（D-RETRY / D-BUDGET）

## Global Constraints

- **D-RETRY:** 仅 429 与超时可重试；5xx / 格式异常（含空 content）不重试。
- **D-BUDGET:** 墙钟总预算 180s（含重试）；单次 Nest HTTP 不得超过剩余预算。
- **单侧重试:** Nest 识图路径 `maxRetries: 0`；Runtime 保留最多 3 attempt。库函数仍允许调用方显式传 `maxRetries>0`（其它场景），但侧栏路径必须为 0。
- **不改:** ProviderContext 契约、缓存键、P2、选择器标注。
- **分支:** `fix/vision-retry-budget-errorclass` from `origin/main`。

---

## File map

| File | Change |
|------|--------|
| `packages/agent/src/refs/vision-qa-json.ts` | 空 content → throw（不重试） |
| `packages/agent/src/refs/vision-qa-json.test.ts` | 空 content 单次失败；可选保留 maxRetries>0 的 429 测 |
| `apps/server/src/studio/studio.service.ts` | `maxRetries: 0`；catch → `errorClass` + 中性 reason |
| `apps/server/src/studio/run-vision-qa-context.test.ts` | catch / maxRetries 断言 |
| `services/agent-runtime/app/tools/nest_client.py` | `run_vision_qa(..., timeout=)` |
| `services/agent-runtime/app/graph/nodes/parse_sidebar_media.py` | 按剩余预算设 timeout |
| Runtime tests | timeout 传入 / 预算切超时 |
| Spec header（可选） | 注明 P0.5 残留收敛 |

---

### Task 1: 空 content 硬失败 + Nest `maxRetries: 0` + catch `errorClass`

**Files:** vision-qa-json.ts(+test)、studio.service.ts、run-vision-qa-context.test.ts

- [x] **Step 1:** 测试 — 空 content 只 fetch 1 次并 throw（即使 `maxRetries: 2`）
- [x] **Step 2:** 实现 — `if (!text) throw new Error('Vision LLM 返回空内容')`（去掉 `continue`）
- [x] **Step 3:** 测试 — `runVisionQaInternal` 传给 `generateVisionQaJson` 的 opts 含 `maxRetries: 0`；上游 throw 时返回 JSON 含 `errorClass`（429→`VISION_RATE_LIMIT`，timeout→`VISION_TIMEOUT`，fetch→`VISION_FETCH_FAILED`，其它→`VISION_UPSTREAM`），`reason` 为中性中文（不原样英文长文）
- [x] **Step 4:** 实现 studio catch 映射 + `maxRetries: 0`
- [x] **Step 5:** 跑测并提交

```bash
pnpm --filter @lnkpi/agent exec vitest run src/refs/vision-qa-json.test.ts
pnpm exec vitest run apps/server/src/studio/run-vision-qa-context.test.ts
git commit -m "fix(server): vision Nest no nested retry; empty content hard-fail; catch errorClass"
```

---

### Task 2: Runtime Nest 超时对齐剩余 180s 预算

**Files:** nest_client.py、parse_sidebar_media.py、相关 pytest

- [x] **Step 1:** 测试 — `run_vision_qa` 接受 `timeout=` 并传给 `_post`
- [x] **Step 2:** 测试 — parse 节点在剩余预算 30s 时以 ≤30s timeout 调 nest（mock）
- [x] **Step 3:** 实现 `timeout: float | None = None`（默认 120）；节点内 `min(120.0, max(1.0, remaining))`
- [x] **Step 4:** pytest 通过并提交

```bash
cd services/agent-runtime && uv run pytest tests/test_nest_client.py tests/test_parse_sidebar_media_node.py -q
git commit -m "fix(runtime): cap run-vision-qa HTTP timeout by D-BUDGET remaining"
```

---

### Task 3: 规格注记 + PR

- [x] 规格 §8 或文首补一句：P0.5 重试权威在 Runtime；Nest `maxRetries:0`；HTTP timeout 受 180s 剩余约束
- [ ] PR：链 parent spec + 本计划；注明生产已验证 P0 主路径，本 PR 为决策对齐加固

---

## Spec coverage

| 决策 | Task |
|------|------|
| 单侧重试（消双重） | T1 |
| 格式异常不重试（空 content） | T1 |
| Nest catch errorClass | T1 |
| D-BUDGET 约束单次 Nest | T2 |
