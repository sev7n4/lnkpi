# Agent Execution Trace — P1/P2 执行计划

> 日期：2026-08-06  
> 前置：[2026-08-06-agent-execution-trace-design.md](../specs/2026-08-06-agent-execution-trace-design.md)  
> P0 状态：实现中（本仓库 PR）

---

## 里程碑

| 阶段 | PR | 依赖 | 预估 |
| --- | --- | --- | --- |
| **P0** | `feat/agent-execution-trace-p0` | sidebar_copy 已 merge | 1 周 |
| **P1** | `feat/agent-execution-trace-p1` | P0 merge | 2–3 周 |
| **P2a** | `feat/agent-thinking-explore` | P1 | 1–2 周 |
| **P2b** | `feat/agent-replay-timeline` | P0（可并行 P1） | 1 周 |

---

## P1 任务清单（spec §5）

### 1. Runtime `step` / `phase_hint` 事件

- [ ] `services/agent-runtime/app/graph/step_copy.py` — 人话 label 表
- [ ] `runs.py` — `graph.astream` 进入/离开 node 时 emit `step`
- [ ] `interrupt` 前 emit `phase_hint`
- [ ] `tests/test_step_events.py`

### 2. 类型与 Nest 透传

- [ ] `packages/agent/src/types.ts` — 补齐 `step`, `phase_hint`, `interrupt`, `ping`, `force_choice`
- [ ] `agent.service.ts` — 透传无 transform

### 3. 前端 reducer 优先级

- [ ] `executionTraceReducer.ts` — **`step` 事件优先**于 text 启发式；同 id update
- [ ] dedupe：`step` 与 `text_stage` 同 label 合并

### 4. 结构化错误

- [ ] `executionStepErrors.ts` — error_type → detail 映射
- [ ] `handleEvent('error')` — 写 failed 步骤
- [ ] `AgentTaskProgressCard.vue` — 展示 `errorHint` / `errorCode`

### 5. interrupt 阶段

- [ ] `PHASE_HINT_LABELS` + `applyPhaseHint()`
- [ ] 重连 `thread-state` → 轨迹 `waiting_user` 步骤

**P1 验收：** Campaign 确认流可见「拟定方案 → 等待确认」；失败步骤有 retry_hint。

---

## P2 任务清单（spec §6）

### P2-9 Thinking

- [ ] env `AGENT_THINKING_UI`（默认 false）
- [ ] parse/plan LLM 完成后 emit `thinking` `{ status, summary }`
- [ ] `AgentExecutionTrace` — `kind: thinking` 默认折叠

### P2-10 Explore

- [ ] `context_packet.py` build 后 emit `explore` 摘要
- [ ] 轨迹步骤：「参考画布上下文（N 个节点）」

### P2-11 Replay / timeline

- [ ] `ReplayPage.vue` — 只读轨迹（从 messages + timeline API）
- [ ] `?agentDebug=1` — 展示 `thread-timeline` 内部 phase
- [ ] 可选：`replay.py` entry 增加 `durationMs`

**P2 验收：** debug 模式可见 timeline；Explore 无 raw context；Thinking 默认不可见。

---

## Checkpoint 评审

| 时机 | 内容 |
| --- | --- |
| P0 PR merge | 生产跑 `deploy/prod-execution-trace-verify.py` |
| P1 开发中 | reducer 与 Runtime step id 对齐单测 |
| P1 merge | 更新 prod smoke 断言 `step` 事件 |
| P2 启动前 | 确认 Thinking 合规与产品开关 |

---

## 非目标（本期不做）

- 轨迹 DB 持久化（`agentMessage.metadata`）
- Panel / 浮窗同步轨迹
- 全量 raw CoT 流式展示
