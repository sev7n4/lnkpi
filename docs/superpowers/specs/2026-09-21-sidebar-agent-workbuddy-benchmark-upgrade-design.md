# 侧栏 Agent 架构升级设计：对标 WorkBuddy 内核的四项能力补强

- 日期：2026-09-21
- 状态：待评审
- 级别：Architectural（agent-runtime 恢复策略层 + 动态规划引入 + 工具注册表规范化）

## 1. 背景与目标

### 1.1 调研输入

对 WorkBuddy（腾讯）桌面端做了拆包调研（`/Applications/WorkBuddy.app`）+ 公开资料交叉验证，结论：

- **agent 内核为腾讯自研**：CodeBuddy Agent（内部代号 `genie`，包名 `@genie/agent-cli` → `@tencent-ai/codebuddy-code`），Electron 壳内嵌该 CLI 作为 agent 运行时；内置文档自称 "CodeBuddy Agent SDK"。
- **不是** LangChain/LangGraph/PI/OpenClaw/Hermes。langchain/langgraph 在 app.asar 与 CLI 依赖中零命中。
- 真实技术栈组合：`@openai/agents` 0.5.2（OpenAI Agents SDK 作编排底库）+ `@anthropic-ai/sandbox-runtime`（bash 沙箱）+ MCP SDK 1.29.0 + ACP + `@celljs/*`（IoC）+ 内部 SDK（agentdr / galileo 遥测）。
- 内核四组件（值得对标的抽象）：**任务规划器**（分层拆解 + 执行中动态调整）、**工具调度器**（统一注册表 + 自动选工具 + MCP 扩展）、**执行监控器**（失败分析 → 自动重试/重规划/上报三选一）、**子代理协作**（sub-agent / Agent Teams，任务隔离 + 并行）。

### 1.2 为什么框架结论对我们重要

WorkBuddy 换编排底库、换沙箱实现都不改产品架构——**规划/监控/工具三层抽象才是护城河**。我们继续用 LangGraph（`langgraph>=0.2` + sqlite checkpoint）没有问题，需要补的是这三层里缺失的部分。

### 1.3 目标

本 spec 把调研结论转化为四项开发工作流（W1–W4），按投入产出排序：

| # | 工作流 | 对标 WorkBuddy 组件 | 优先级 |
|---|---|---|---|
| W1 | 统一失败恢复策略层 | 执行监控器 | P0（成本最低、收益最直接） |
| W2 | 动态重规划（planner lane） | 任务规划器 | P1（中期方向） |
| W3 | Skill manifest 规范化 + 自动选工具 | 工具调度器 | P2（随 provider 扩张顺势做） |
| W4 | 阶段性任务 subagent 并行化 | Sub-agent / Agent Teams | P3（性能成为瓶颈再启动） |

## 2. 现状审计（基于代码，2026-09-21）

### 2.1 现有资产

| 资产 | 位置 | 状态 |
|---|---|---|
| LangGraph 静态图 | `services/agent-runtime/app/graph/`（60+ 节点文件） | 路由靠硬编码规则（`route_hard` / `route_precedence` / `decide_lane`），每加意图需改图 |
| 结构化错误分类 | `app/errors.py`：6 类（`param_error` / `permission_denied` / `tool_timeout` / `downstream_unavailable` / `internal_error` / `circuit_open`）+ `retry_hint` | **分类已存在**；`AgentToolError` 由 `nest_client` / `gen_node` / `explore` 抛出 |
| 失败恢复 | 分散在各节点各自处理 | **无集中策略层**，重试/降级/上报行为不一致 |
| HITL interrupt | `interrupt_before` 闸门，`userDecision`（confirm / revise / replan / confirm_gen / topo_revise / node_revise）经 `aupdate_state` 恢复 | 已领先，保留 |
| Checkpoint | `langgraph-checkpoint-sqlite>=2.0.8` + `checkpoint_observability.py` | 已领先，保留 |
| Skill 体系 | `services/agent-runtime/skills/`（`enterprise-marketing-campaign` / `ecommerce-product-visual` / `_shared`）+ `app/skills/loader.py`（frontmatter + `canvas_manifest` + `max_downstream` + `prompt_version`） | manifest 有雏形；**缺能力描述/成本/前提字段**，选择靠手工映射 |
| UI→runtime skill 映射 | `apps/server/src/agent/agent-skill-map.ts`：`SKILL_UI_TO_RUNTIME` 硬编码 2 条 | 每＋一个 skill 改一处代码 |
| 执行流 UI | 前端 `AgentSideRail` + `executionTraceReducer`（steps / phaseHint / structuredError / journeyTrace / presentation） | 已领先，保留；W1 需要它渲染恢复动作 |
| Provider 工具链 | `app/tools/`：image / video（含 fal 队列、minimax-h3）/ text / audio provider | 硬编码注册，无统一元数据 |

### 2.2 差距清单

- **G1**：错误有了"分类"但没有"处置"。同一类错误在不同节点可能静默失败、可能直接报给用户、可能中断整次 run，行为不一致且无重试预算控制。
- **G2**：静态图路由表持续膨胀，新场景 = 改图 + 全量回归，边际成本递增。
- **G3**：skill 新增需要同时改 runtime skills 目录、`loader.py` 假设、server 端 `SKILL_UI_TO_RUNTIME`，三处联动，无"声明即接入"。
- **G4**：vision-QA、分镜批量出图、多方案生成等天然并行任务在单图中串行执行，长任务端到端耗时无优化空间。

## 3. W1 统一失败恢复策略层（P0）

### 3.1 设计

引入集中式 `RecoveryPolicy`（`app/recovery.py`），位于节点错误抛出与图流转之间：

```
节点抛 AgentToolError
  → RecoveryPolicy.classify(error)         # 已有 6 类，扩充 2 类
  → RecoveryPolicy.decide(error, ctx)      # 返回处置动作
      ├─ retry（同节点，带退避，预算内）
      ├─ degrade（降级 provider/模型，需 manifest 声明 fallback 链，依赖 W3）
      ├─ hitl（转结构化追问，走既有 interrupt 闸门）
      └─ abort（终止 run，带原因上报）
  → 处置结果写入 executionTrace（复用 trackStructuredError / trackStep）
```

关键规则：

1. **错误类型 → 处置映射表**为纯配置（dict），节点不再自带重试逻辑：
   - `tool_timeout` / `downstream_unavailable` / `circuit_open` → retry（指数退避，单节点上限 2 次，整 run 重试预算 5 次）
   - `param_error` → retry 1 次（注入 retry_hint 自纠错），仍失败 → hitl
   - `permission_denied` → hitl（引导重新授权）
   - `internal_error` → abort + 上报
   - 新增 `content_rejected`（provider 内容审核拒绝）→ degrade；无 fallback → hitl 追问改 prompt
   - 新增 `quota_exhausted`（积分/配额不足）→ hitl（前端展示积分引导）
2. **重试预算**（per-run counter）防止无限循环；预算耗尽统一降级为 hitl 或 abort。
3. **恢复动作全部上报前端**：扩展 `structuredError` 事件带 `recoveryAction` 字段，execution trace 显示"已自动重试（1/2）/ 已降级到 X / 需要你确认"。
4. `runs.py` / `gen_node` / `explore` 现有散落的错误处理收编到 policy，节点只负责抛 `AgentToolError`。

### 3.2 验收标准

- 同类错误在任意节点产生一致处置行为（矩阵测试：6+2 类错误 × retry/degrade/hitl/abort 路径）。
- 重试预算耗尽后 run 必然终止于终态（不悬挂），且用户可见原因。
- 前端 execution trace 能区分"自动恢复成功"与"需要用户介入"两类恢复结果。
- 现有 `agent.service.*` 与 runtime 测试全绿；新增 recovery 策略单测覆盖映射表全部分支。

## 4. W2 动态重规划：planner lane（P1）

### 4.1 设计

原则：**保留全部现有 lane 作为"执行模式"，只在路由入口加一层 LLM planner，作为兜底路径**。静态图不推倒。

```
intent 解析（现有）
  → route 入口改造：
      ├─ 命中现有 lane（marketing / product-visual / atomic…）→ 走静态图（现状不变，收益稳定）
      └─ 未命中 / 低置信 / 多意图复合
          → planner 节点：LLM 生成显式子任务列表（DAG：节点 + 依赖 + 每 task 绑定 atomic 工具）
          → 逐 task 执行（复用 atomic-as-tools 成果），每 task 完成回写
          → 执行中允许 planner 基于失败/新信息 revise 剩余子任务（上限 2 次/run）
```

关键规则：

1. **子任务 schema** 复用 `atomic_intent_ir` 的工具参数模型，planner 只做"拆分 + 排序 + 绑定"，不发明新工具。
2. **可见性**：planner 生成的子任务列表作为 `taskEvents` 推给前端（复用 `trackTaskUpdate` / 任务进度卡），用户在执行前可通过既有 HITL 闸门确认或修改。
3. **预算控制**：planner lane 单 run 子任务 ≤ 8；超出强制拆分对话轮次。
4. 退出条件：planner 连续 2 次 revise 仍失败 → 降级为"逐任务逐个确认"模式。

### 4.2 验收标准

- 现有 lane 回归零变化（lane 命中路径完全不动）。
- 构造 3 个当前静态图无法路由的复合意图（如"参考这张图出 3 版方案并把最好的做成视频"），planner lane 能生成合理子任务并完成执行。
- planner 产出对用户可见、可确认、可修改（HITL 打通）。
- planner 失败/超时有明确降级路径，不阻塞主链路。

## 5. W3 Skill manifest 规范化 + 自动选工具（P2）

### 5.1 设计

1. **扩展 skill frontmatter**（`app/skills/models.py`）新增字段：
   - `capabilities: string[]`（能做什么，供路由/planner 匹配）
   - `prerequisites`（需要的输入类型：ref 图 / prompt / 商品信息…）
   - `cost`（积分价目引用，与 points 体系对齐）
   - `fallback_skill_id`（降级链，供 W1 degrade 使用）
2. **单一事实源**：`SKILL_UI_TO_RUNTIME` 硬编码映射废弃，server 端启动时从 runtime 拉取（或经构建期共享）skill index（`SkillIndexEntry` 已含 id/name/description），UI skill 注册与 runtime manifest 对齐。
3. **工具注册表**：`app/tools/` provider 补齐元数据（能力 / 适用场景 / 平均耗时 / 成本），`route_context` 与 W2 planner 基于注册表做自动匹配，替代 if-else。
4. **向后兼容**：manifest 新字段全部 optional，旧 skill 不改也能跑。

### 5.2 验收标准

- 新增一个 skill 的改动收敛为"只在 skills 目录加目录+manifest"，server 端零改动。
- manifest 缺字段时行为与现状一致（无回归）。
- W1 的 degrade 能读到 fallback 链并实际生效。

## 6. W4 阶段性任务 subagent 并行化（P3，暂缓）

方向性设计（启动前需单独出计划）：vision-QA、多 shot 批量出图、多方案生成改为并行 subgraph / asyncio task group + 汇聚节点；受 provider 限流约束，并行度需与 fal 队列（`fal-video-queue`）预算联动。**性能数据证明是瓶颈后再启动**，本 spec 不展开。

## 7. 非目标

- 不更换 agent 框架（LangGraph 保留），不引入 OpenAI Agents SDK / Anthropic sandbox-runtime（我们是纯云端 web 场景，无本地沙箱需求）。
- 不重构 HITL / checkpoint / execution trace（已领先）。
- 不做 agent 间协作（Agent Teams），单图多 agent 并行（W4）已覆盖当前需求。
- W2 不追求全场景动态规划——静态 lane 命中的高频路径保持确定性优先。

## 8. 里程碑

| 阶段 | 内容 | 依赖 |
|---|---|---|
| M1 | W1 恢复策略层（含 2 个新错误类型、预算控制、前端恢复动作展示） | 无 |
| M2 | W3 manifest 扩展 + 注册表元数据 + 映射解耦 | 无（可与 M1 并行） |
| M3 | W2 planner lane + 子任务 DAG 执行 + HITL 确认打通 | W3（自动选工具依赖 manifest） |
| M4 | W4 并行化（单独立项） | W1 + 性能数据 |

每个里程碑按项目规范独立分支 + PR + CI 全绿 + squash merge；M1/M2 启动时用 `writing-plans` 产出任务级实施计划。
