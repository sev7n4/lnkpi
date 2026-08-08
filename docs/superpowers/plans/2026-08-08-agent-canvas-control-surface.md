# Agent 画布控制面（Hybrid A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按 Task 执行。步骤用 `- [ ]` 跟踪。
>
> **Spec SSOT:** `docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md`（v1.2）

**Goal:** Agent 通过 explore 子图 + Harness Tool + `canvas_command` SSE，驱动画布读/轻写/生命周期，高成本生成仍走 Graph。

**Architecture:** 三通道 — Harness Tool（数据）/ LangGraph Command（仅 fan-out）/ `canvas_command` SSE（UI）。explore 白名单见 `tool_registry.py`。

**Tech Stack:** Python agent-runtime（LangGraph）、Nest Harness internal API、Vue AgentSideRail SSE。

## Global Constraints

- CS-4：explore **禁止** `run_*_generation`、`remove_*`、batch topology tools
- CS-9：LangGraph `Command` **仅** gen_scheduler Send；HITL 用 `interrupt_before` + `aupdate_state`
- Harness SSOT：`/agent/internal/*`；TS `CANVAS_TOOLS` deprecated（P4 移除 mock）
- 每个 PR **仅**包含本 Task 文件；禁止混入无关 UI（Seedream/ImageParams 等）

---

## SDD 阶段与 PR 切分

| PR | Wave | 范围 | 状态 |
|----|------|------|------|
| **PR-A** | P0 + P1 Harness/SSE | explore、lifecycle、tasks/assets、canvas_command | **代码就绪，待 commit** |
| **PR-B** | P1 Graph | atomic P6、mixed confirm、sidebar explore bind | 未开始 |
| **PR-C** | P2 | layout、duplicate、upload/export、group/ungroup | 未开始 |
| **PR-D** | P3–P4 | 精修、trace、undo command、TS 降级 | 未开始 |

---

## PR-A — 已完成实现（待提交）

### Task A1: Tool registry + explore 子图（P0）

**Files:**
- Create: `services/agent-runtime/app/tools/tool_registry.py`
- Create: `services/agent-runtime/app/graph/nodes/explore.py`
- Create: `services/agent-runtime/app/graph/canvas_commands.py`
- Modify: `services/agent-runtime/app/tools/definitions.py`
- Modify: `services/agent-runtime/app/graph/builder.py`, `route_decide.py`, `runs.py`

- [x] explore allowlist + `build_explore_tools()`
- [x] `route_decide` → `explore_canvas`
- [x] 测试：`test_explore_tools.py`, `test_route_decide_explore.py`

### Task A2: Lifecycle Harness（P0）

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`, `.controller.ts`
- Modify: `services/agent-runtime/app/tools/nest_client.py`

- [x] cancel / diagnostic / platform fallback internal API
- [x] 测试：`agent-canvas-tools.service.test.ts` lifecycle block

### Task A3: P1 read/write Harness + explore bind

**Files:** 同上 service/controller/definitions/nest_client/tool_registry

- [x] `list_generation_tasks`, `list_*_assets`, `save_node_to_asset_library`
- [x] `introduce_nodes_to_agent`, `apply_asset_to_node`, `focus_node`（UI tool）
- [x] `canvas_command` SSE + AgentSideRail handler
- [x] HITL 注释修正（非 LangGraph Command(resume)）

### Task A4: 规格文档

- [x] Spec v1.2（UI 对照 + LangGraph Command 边界）
- [x] 本 Plan（SDD 格式）

### Task A5: 验证（PR-A gate）

```bash
cd services/agent-runtime && python3 -m pytest \
  tests/test_canvas_commands.py tests/test_explore_tools.py \
  tests/test_route_decide_explore.py tests/test_nest_client.py \
  tests/test_route_decide.py -q
# Expected: 31 passed

cd apps/server && npm test -- agent-canvas-tools.service.test.ts --run
# Expected: 36 passed
```

- [x] 2026-08-08 验证通过（31 + 36 passed）

### Task A6: Commit PR-A（**待用户确认**）

**Stage 范围（仅 PR-A）：**

```
docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md
docs/superpowers/plans/2026-08-08-agent-canvas-control-surface.md
services/agent-runtime/app/** (explore, tool_registry, canvas_commands, …)
services/agent-runtime/tests/test_*explore* test_canvas_commands test_nest_client
apps/server/src/agent/agent-canvas-tools.*
apps/server/src/agent/agent-runtime.client.ts
apps/server/src/agent/agent.controller.ts
apps/server/src/agent/agent.service.ts
apps/web/src/components/agent/AgentSideRail.vue
packages/agent/src/tools/canvas-tools.ts
```

**排除：** `ImageParamsSelector.vue`, `ProviderConfigDialog.vue`, `ImageDockPanel.vue`, `CanvasPage.vue`（若非本 feature 改动）

- [ ] `git add` 上述路径
- [ ] `git commit -m "feat(agent): canvas control surface P0+P1 explore and harness"`
- [ ] `git push -u origin feat/agent-canvas-control-surface`
- [ ] `gh pr create`（mydev-github-workflow）

---

## PR-B — P1 Graph 剩余（下一 Session）

### Task B1: `apply_sidebar_attachments` 纳入 explore

- [ ] definitions + tool_registry + nest 已有 → 加入 EXPLORE_TOOL_NAMES
- [ ] 测试：explore bind 含该 tool

### Task B2: atomic video P6 参数贯通

- [ ] `atomic_create_gate` 读取 video P6 字段
- [ ] 测试 + prod verify 扩展

### Task B3: mixed 模态 confirm + lifecycle 双路径

- [ ] material vs studio record 归一
- [ ] 见 spec §1.4

---

## PR-C / PR-D

见 Spec §1.1–§1.5 能力矩阵；P2 布局/复制/上传，P3 精修，P4 trace/undo/TS 降级。

---

## 能力速查

| UI 操作 | Wave | 形态 |
|---------|------|------|
| 任务列表 | P1 ✅ | `list_generation_tasks` |
| 定位 | P1 ✅ | `canvas_command` focus_node |
| 资产/引入 Agent | P1 ✅ | Harness + SSE |
| 小地图/布局 | P2 | `get_canvas_layout` |
| 分组/整理 | P2–P3 | graph_batch |
| 撤销 | P4 | `canvas_command` undo |
