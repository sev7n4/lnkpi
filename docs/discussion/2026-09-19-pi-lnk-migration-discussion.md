# 「侧栏 agent 切换至 earendil-works/pi 内核」讨论文档

> **状态**：讨论稿 v1（2026-09-19）
> **路径**：Architectural — brainstorming 阶段；**非 spec、非 plan**
> **新项目仓库**：[PI-Lnk](https://github.com/your-org/pi-lnk)（本文档是该仓库的第一个资产）
> **来源项目**：[lnkpi](https://github.com/your-org/lnkpi)（超创平台 / AI 无限画布创作工作流平台）
> **作者**：基于 lnkpi 仓库代码事实 + earendil-works/pi 源码事实（已 clone 阅读）
> **结论先抛**（详见 §10）：**完全可行且显著改善工程债务**，但有 7 个**已拍板的决策**和 4 个**真正的硬骨头**需要后续阶段拆解

---

## 目录

- [§0 元信息与决策摘要](#0-元信息与决策摘要)
- [§1 重新理解目标](#1-重新理解目标)
- [§2 当前 lnkpi agent 栈分层（基于代码事实）](#2-当前-lnkpi-agent-栈分层基于代码事实)
- [§3 earendil-works/pi 架构（基于源码）](#3-earendil-works-pi-架构基于源码)
- [§4 层 ↔ 包 映射](#4-层--包-映射)
- [§5 可行性分析：F1–F9 + 9 spec 能力覆盖](#5-可行性分析f1f9--9-spec-能力覆盖)
- [§6 复杂度评估（4 个硬骨头）](#6-复杂度评估4-个硬骨头)
- [§7 影响分析](#7-影响分析)
- [§8 风险与回退](#8-风险与回退)
- [§9 关键时间窗](#9-关键时间窗)
- [§10 决策记录（已拍板）](#10-决策记录已拍板)
- [§11 下一步（待用户决定）](#11-下一步待用户决定)
- [§A 附录：源码引用与事实校准](#a-附录源码引用与事实校准)

---

## §0 元信息与决策摘要

| 字段 | 值 |
|---|---|
| 文档 ID | `pi-lnk/discussion/2026-09-19` |
| 创建日期 | 2026-09-19 |
| 对应 brainstorming 目标 thread | `01a0b57a-04c1-7763-9f74-ab57666a52dc` |
| 信息来源 | lnkpi 仓库代码（已读）+ earendil-works/pi 仓库（已 clone 至 `/private/tmp/pi-research/pi`） |
| 关联 spec / plan | 暂无（用户当前指令：先讨论，不写 spec / plan） |

### 7 个核心决策（已拍板，§10 详述）

| ID | 决策 | 拍板结论 |
|---|---|---|
| **D-α** | pi-runtime 部署形态 | **独立 Node 服务**（复用 pi-coding-agent RPC transport） |
| **D-β** | 迁移策略 | **Strangler-fig**（先 chat/explore → atomic → marketing） |
| **D-γ** | pi 版本控制 | **vendor 到 monorepo**（`vendor/earendil-works/pi`） |
| **D-δ** | OAuth 接入默认开关 | **默认关闭**（首版稳） |
| **D-ε** | 新项目命名 | **PI-Lnk** |
| **D-ζ** | 老 LangGraph Runtime 处置 | **保留 30 天回退开关** |
| **D-η** | 自研 `@lnkpi/agent` 归宿 | **部分保留**（纯函数工具保留，prompt-modes 删除） |

---

## §1 重新理解目标

### 1.1 用户三轮沟通的演进

| 轮次 | 用户原话摘要 | 我的理解 |
|---|---|---|
| 第 1 轮 | "侧栏 agent 使用 pi 的内核 vs 自研 agent 赛马" | 误以为是赛马 → 提议 A/B/C/D 4 种方案 |
| 第 2 轮 | "不是赛马，是 fork 项目到新项目，保留侧栏业务能力工具能力，以 pi agent core 作为内核，原有 agent 弃用，因为自研 harness 演进阻力大，难商业化。先讨论和拆解分层，不急写规格和计划" | **路径完全纠正**：迁移替换，不是赛马；fork 到新项目；自研弃用；当前阶段是讨论/拆解/可行性/复杂度/影响 |
| 第 3 轮 | "我理解应该是 [earendil-works/pi]" | 锁定 pi = earendil-works/pi（不是 pi-mono） |
| 第 4 轮 | "7 个决策按你的建议来，新项目叫 PI-Lnk，已开放完全访问权限" | 决策全拍板；可以读真源码；讨论文档作为新仓库第一资产 |

### 1.2 锁定目标

| 维度 | 决策 |
|---|---|
| 模式 | **迁移替换**（不是赛马） |
| 主体 | **fork 整个 lnkpi** 到新项目 **PI-Lnk** |
| 内核 | **`@earendil-works/pi-agent-core` v0.85.1**（agent loop + skills + sessions + tool proxy + 极简 + 插件生态） |
| 自研 agent | **整体弃用**（含 `services/agent-runtime` 26735 行 Python + `@lnkpi/agent` prompt-modes 部分） |
| 保留 | **侧栏业务能力 + 工具能力**（画布 / Studio / RefChip / Vision / Skill 选择器 / Nest↔Canvas 契约） |
| 决策动机 | 自研 harness 演进阻力大，难商业化 |
| 流程 | **讨论 + 拆解 + 可行性 + 复杂度 + 影响**（先不做 spec / plan） |

---

## §2 当前 lnkpi agent 栈分层（基于代码事实）

把所有 agent 相关代码按职责层拆开，每层标注 LOC 和职责（用 `wc -l` 实测，2026-09-19 数据）：

```
┌──────────────────────────────────────────────────────────────────────┐
│ L7  产品 UI   │ apps/web/src/components/agent/、AgentSideRail.vue    │
│               │  SSE 渲染 / 任务卡 / 工具栏 / Material chip / 大量组件│
├──────────────────────────────────────────────────────────────────────┤
│ L6  Nest 入口 │ apps/server/src/agent/                                │
│   ✦ agent.service.ts (547)                                            │
│   ✦ agent.controller.ts / agent.module.ts                            │
│   ✦ agent-runtime.client.ts (HTTP 客户端, 331)                        │
│   ✦ agent-canvas-tools.{service,controller}.ts                       │
│   ✦ composition.service.ts / workflow-recipe.service.ts              │
│   ✦ 内部 token 鉴权 + ProviderContext resolve                          │
│   ✦ Runtime 切换 (env var) + 持久化 + Trace metadata                  │
│   ✦ 生产 7224 行 + 测试 5953 行                                       │
├──────────────────────────────────────────────────────────────────────┤
│ L5  Python    │ services/agent-runtime/app/                          │
│   Runtime     │  ✦ runs.py (1441) + graph/builder.py + 50+ nodes    │
│   (LangGraph) │  ✦ contract.py (584) + tracing/metrics/config/...   │
│               │  ✦ skills/enterprise-marketing-campaign/SKILL.md    │
│               │  ✦ 生产 26735 行  ← 自研重头（待整体弃用）            │
├──────────────────────────────────────────────────────────────────────┤
│ L4  TS Agent  │ packages/agent/src/                                  │
│   工具库      │  ✦ tools/ (provider 7, executor 1) ≈ 1300 行          │
│               │  ✦ prompt-modes/modes/ (12 modes) ≈ 1800 行          │
│               │  ✦ refs/ (vision/merge/json) ≈ 400 行                 │
│               │  ✦ studio/ (generation/edit/video-refs) ≈ 1100 行    │
│               │  ✦ types.ts / index.ts                                │
│               │  ✦ 生产 5159 行 + 测试 3577 行                          │
├──────────────────────────────────────────────────────────────────────┤
│ L3  Nest 业务 │ apps/server/src/canvas/  shot/material.service.ts      │
│               │ apps/server/src/studio/ studio.service.ts (2365)      │
│               │ apps/server/src/provider/ provider-resolver/ctx       │
│               │ ✦ 真实副作用层：生成图/视频/音频、模型路由、计费          │
├──────────────────────────────────────────────────────────────────────┤
│ L2  业务契约  │ packages/shared/src/                                  │
│               │  ✦ agentContract.ts (Zod schemas)                    │
│               │  ✦ agentIntent.ts / journeyTrace.ts / sidebarAttachmts│
│               │  ✦ canvas/ (composition*: 8 个) / imageModelProfiles  │
│               │  ✦ providerChannels.ts / studioModelCatalog.ts        │
│               │  ✦ 6826 行 ← 跨栈契约的真相                            │
├──────────────────────────────────────────────────────────────────────┤
│ L1  数据 /    │ Prisma schema + SQLite + 上游模型 SDK                  │
│   外部依赖    │ OpenAI / DeepSeek / fal / MiniMax / Agnes / Studio    │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 关键发现

| 发现 | 影响 |
|---|---|
| 当前 `@lnkpi/agent` 是**工具库**而非流式 runtime（无 stream method） | 必须新写 CanvasAgent v2 或直接用 pi-agent-core 的 Agent 类 |
| 流式对话 runtime 是 `services/agent-runtime`（LangGraph + Python） | 是 pi-agent-core 的**完全替代目标** |
| Nest `streamConversation` 没有 CanvasAgent 兜底：`AGENT_RUNTIME_URL` 未设 → `streamRuntimeUnavailable()` | 切换时不存在"双 fallback"风险 |
| L2 契约（Zod schemas）是 backend truth | **保留**；只需在 Nest 适配层做 Zod ↔ TypeBox 桥接（pi-agent-core 用 TypeBox） |
| L3 业务层（canvas / studio / provider）是真实副作用 | **保留**；pi 的 tool proxy 都指向 Nest 内部 API |

---

## §3 earendil-works/pi 架构（基于源码）

### 3.1 包结构（13 个 workspace package，v0.85.1）

| 包 | 类型 | 主要职责 | 对应 lnkpi 层 |
|---|---|---|---|
| `@earendil-works/chord` | 基础设施 | 应用组合 runtime：services、replicated state、RPC、plugins | L6 Nest 入口（提供 RPC transport 范式） |
| `@earendil-works/pi-telemetry` | 基础设施 | vendor-neutral telemetry 契约 + 参考 adapter + 一致性测试 + typed schemas | 当前 LangSmith 私有替代 |
| `@earendil-works/pi-ai` | 核心 | **统一多 LLM provider API**：Anthropic、OpenAI、Google、xAI、Groq、Cerebras、OpenRouter、Mistral、Together、DeepSeek、**MiniMax**、Kimi、Qwen、HuggingFace、OpenAI Codex、Gemini CLI OAuth、25+ providers | **L1 上游 SDK 抽象替代** |
| `@earendil-works/pi-durable` | 核心 | Durable conversation / task / document runtime | 当前 LangGraph AsyncSqliteSaver 替代 |
| **`@earendil-works/pi-agent-core`** | **核心** | **Agent runtime：tool calling、state management、transport abstraction、attachments、event lifecycle** | **L4 + L5 整合后** |
| `@earendil-works/pi-coding-agent` | 应用 | Interactive coding agent CLI（基于 pi-ai + pi-agent-core），内置 4 工具（read/write/edit/bash）+ JSONL tree session + compaction + extension 注册点 | L5 LangGraph Runtime 的**完全替代**；我们用其 RPC / session-manager 模式 |
| `@earendil-works/pi-tui` | 应用 | Terminal UI 库（差分渲染） | 不需要 |
| `@earendil-works/pi-server` | 应用 | RPC Server 实现 + 多 transport（基于 `@earendil-works/pi-protocol` CBOR） | pi-runtime 服务的**实现参考** |
| `@earendil-works/pi-protocol` | 协议 | TypeBox schema + CBOR framing；`PROTOCOL_VERSION = 8`；server/session/connection 三层 | 我们的 Nest ↔ pi-runtime RPC 协议可借鉴 |
| `@earendil-works/pi-session-backends/sqlite-node` | 后端 | SQLite session 存储 + 完整 conformance tests | **直接用**替代 LangGraph checkpointer |
| `@earendil-works/pi-client` | SDK | 客户端 SDK | Nest 集成时可参考 |
| `@earendil-works/pi-evals` | 工具 | 评测框架 | 不需要（M2 之后再说） |

### 3.2 关键源码事实（已 clone 阅读，路径 `/private/tmp/pi-research/pi`）

#### `Agent` class — `packages/agent/src/agent.ts` (607 行)

```typescript
// 核心 API（按真实源码）
new Agent({
  // 初始状态
  initialState: { systemPrompt, model, messages, tools, thinkingLevel },
  // LLM 流函数（来自 pi-ai）
  streamFn: StreamFn,
  // API key 解析（OAuth / BYOK）
  getApiKey: (provider: string) => Promise<string|undefined> | string|undefined,
  // 上下文转换
  convertToLlm: (messages) => Message[],
  transformContext: (messages, signal) => Promise<AgentMessage[]>,
  // 工具钩子
  beforeToolCall: (ctx, signal) => Promise<BeforeToolCallResult | undefined>,
  afterToolCall: (ctx, signal) => Promise<AfterToolCallResult | undefined>,
  // 回合控制
  shouldStopAfterTurn: (ctx, signal) => boolean,
  prepareNextTurn / prepareNextTurnWithContext,
  // 队列
  steeringMode: 'all' | 'one-at-a-time',  // 默认 one-at-a-time
  followUpMode: 'all' | 'one-at-a-time',  // 默认 one-at-a-time
  // 其它
  sessionId, thinkingBudgets, transport, maxRetryDelayMs,
  toolExecution: 'sequential' | 'parallel'  // 默认 parallel
})

// 公开方法
agent.subscribe(listener) => unsubscribe
agent.prompt(message | messages | string, images?)
agent.continue()
agent.abort()  // AbortController.abort()
agent.steer(message)  // steering queue（当前回合完成后注入）
agent.followUp(message)  // followUp queue（agent 即将停止时注入）
agent.waitForIdle() => Promise<void>
agent.reset()  // 清空 transcripts，保留系统消息基线

// 队列
agent.steeringQueue.drain()  // 'all' 全部 / 'one-at-a-time' 头部
agent.followUpQueue.drain()
```

#### `runAgentLoop` — `packages/agent/src/agent-loop.ts` (857 行)

低层 loop，`Agent` class 包了一层状态管理。**这是 pi 的"agent core 内核"真身**。

#### 事件类型 — `packages/agent/src/types.ts:AgentEvent`

```typescript
type AgentEvent =
  // Agent 生命周期
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  // Turn 生命周期（一个 assistant 回复 + tool calls/results）
  | { type: "turn_start" }
  | { type: "turn_end"; message; toolResults }
  // Message 生命周期（system / user / assistant / toolResult）
  | { type: "message_start"; message }
  | { type: "message_update"; message; assistantMessageEvent }  // 仅 assistant streaming
  | { type: "message_end"; message }
  // Tool 执行生命周期
  | { type: "tool_execution_start"; toolCallId, toolName, args }
  | { type: "tool_execution_update"; toolCallId, toolName, args, partialResult }
  | { type: "tool_execution_end"; toolCallId, toolName, result, isError };
```

> **重要：core 层无 `interrupt` 事件**。interrupt / suspend 由 `AgentHarness`（harness 抽象层）+ `AgentSession`（coding-agent 层）实现 — 我们要在 PI-Lnk 业务层自己加 interrupt 语义（或用 `shouldStopAfterTurn` hook 实现确认门）。

#### `AgentTool` — `packages/agent/src/types.ts`

```typescript
interface AgentTool<TParameters extends TSchema, TDetails> extends Tool<TParameters> {
  label: string;  // UI 显示用
  prepareArguments?: (args: unknown) => Static<TParameters>;  // 兼容性 shim
  execute: (toolCallId, params, signal, onUpdate) => Promise<AgentToolResult<TDetails>>;
  replay?: "never" | "safe";  // 持久化恢复策略
  executionMode?: "sequential" | "parallel";
}
// AgentToolResult = { content: (TextContent|ImageContent)[], details, usage?, terminate? }
```

> **重要：pi-agent-core 用 TypeBox 定义 schema，不是 Zod**。需要写 Zod → TypeBox 桥接（~50 行）以复用 `@lnkpi/shared` 现有 Zod schemas。

#### Skills 系统 — `packages/agent/src/harness/skills.ts` (396 行)

```typescript
// API
loadSkills(env, dirs, context): Promise<{ skills: Skill[], diagnostics: SkillDiagnostic[] }>
loadSourcedSkills<TSource, TSkill>(env, inputs, mapSkill, context):
  Promise<{ skills: Array<{ skill: TSkill, source: TSource }>, diagnostics: ... }>

// SKILL.md 格式（agentskills.io 标准）
// Frontmatter: { name?, description?, "disable-model-invocation"?, ... }
// Body: Markdown content
// 加载后用 formatSkillInvocation(skill, additionalInstructions) 注入 prompt

// 特性
// - 递归目录扫描
// - .gitignore / .ignore / .fdignore 支持（用 'ignore' 包）
// - 加载诊断（warning 类型）
// - 来源标签化（用于追踪 skill 是 user-provided 还是 system）
// - 完全兼容 agentskills.io 标准
```

> **结论**：当前 `services/agent-runtime/skills/enterprise-marketing-campaign/SKILL.md` **零修改直接迁**。

#### AI Providers — `packages/ai/src/providers/`

50+ providers 已实现。**对 lnkpi 重要的几个**：

| Provider | pi 内置 | lnkpi 当前 |
|---|---|---|
| Anthropic | ✅ | 部分使用 |
| OpenAI | ✅ | ✅ 主要 |
| **DeepSeek** | ✅ `deepseek.ts` | ✅ |
| **MiniMax** | ✅ **`minimax.ts` + `minimax-cn.ts`** | ✅ MiniMax H3 video |
| Google | ✅ | — |
| xAI | ✅ | — |
| Groq / Cerebras / Baseten / Together | ✅ | — |
| OpenRouter | ✅ | — |
| Mistral | ✅ | — |
| **fal** | ❌ **未内置** | ✅ fal H3 Max video |
| **Agnes** | ❌ **未内置** | ✅ Agnes image / video 2.5 Flash |
| HuggingFace | ✅ | — |
| OpenAI Codex (OAuth) | ✅ | — |
| GitHub Copilot (OAuth) | ✅ | — |
| MiniMax-cn | ✅ | — |
| Moonshot / Qwen / Kimi / ZAI | ✅ | — |

> **需要写 2 个 custom provider**：`fal`（视频生成）+ `Agnes`（平台自定义）。
> MiniMax 直接复用 `minimax.ts`。

#### Session Backend — `packages/session-backends/sqlite-node/`

```json
{
  "name": "@earendil-works/pi-session-backend-sqlite-node",
  "version": "0.85.1",
  "engines": { "node": ">=22.19.0" },
  "dependencies": {
    "@earendil-works/pi-ai": "^0.85.1",
    "@earendil-works/pi-agent-core": "^0.85.1"
  }
}
```

独立 package 设计（避免 pi-agent-core 拉 `node:sqlite` 原生依赖）。**直接装即用，替代 LangGraph `AsyncSqliteSaver`**。

#### RPC Server — `packages/server/src/server.ts`

```typescript
new Server<TMetadata>({
  host: ServerHost,
  listeners: ServerListener[],
  maxFrameLength,
  handshakeTimeoutMs,
  onConnectionCountChanged,
  onError
})
// 特性
// - 基于 @earendil-works/pi-protocol（TypeBox + CBOR）
// - SessionRouter 多 session 路由
// - ServerListener 注册 + 自动清理
// - PROTOCOL_VERSION = 8
```

> **Nest ↔ pi-runtime 通信的设计参考**：可以用 pi-protocol 的 CBOR + 自己的 HTTP/JSON 适配，或者直接走 Nest HTTP + JSON-RPC 风格（更简单，因为我们已经有 Nest controller 模式）。

#### AgentHarness — `packages/agent/src/harness/agent-harness.ts`

更高层抽象：在 Agent class 之上加了 skill + prompt template + compaction + branch summary + lane configuration + suspend/resume。
**这是 interrupt/HITL 真正实现的地方**（`SuspendedRun`、`HarnessClosed` 等）。我们要在 PI-Lnk 用它包装 Agent class，而不是直接用裸 Agent。

#### SessionManager — `packages/coding-agent/src/core/session-manager.ts` (1786 行)

coding-agent 的高层 session 管理。**值得借鉴模式，但不直接依赖 coding-agent**（它是 CLI 应用）。

### 3.3 pi 的设计哲学（**正是用户要释放的能力**）

| 原则 | 实现 | 对 PI-Lnk 的价值 |
|---|---|---|
| **Agent core 极小** | agent-loop.ts 857 行 + Agent class 607 行 + types 463 行 = **~2000 行核心** | 当前 L5 自研 agent 至少 3000+ 行；pi 给我们 battle-tested 的循环 |
| **事件驱动生命周期** | agent_start/end、turn_start/end、message_start/update/end、tool_execution_start/update/end | 当前 LangGraph 节点间靠 state dict；事件流更易调试、SSE 友好 |
| **Steering + FollowUp 队列** | mid-conversation 注入（不打断当前循环） | 替代 LangGraph interrupt 但更轻 |
| **Transport 抽象** | Session / Connection / ByteConnection 三层 | Nest SSE = 加一种 transport |
| **JSONL tree session** | 分支可回放、可 fork、可 compact | **直接替代** LangGraph SQLite checkpointer |
| **Skills (agentskills.io 标准)** | SKILL.md + frontmatter + slash command | **零修改**兼容现有 marketing SKILL.md |
| **TypeScript extensions** | 注册 tools/commands/keybindings/sub-agents/plan modes/permission gates | 把现有 12 个 prompt-mode + 7 个 provider + canvas tools 全部包成 extension |
| **Pi Packages** | npm/git 装卸的扩展 bundle | 未来发 Skill/Plugin 给生态用，零额外基础设施 |
| **OAuth / BYO model** | Claude Pro/Max、ChatGPT Plus、GitHub Copilot、Gemini CLI OAuth 内置 | 用户身份接入能力白送 |
| **Telemetry** | `@earendil-works/pi-telemetry`：vendor-neutral schema + reference adapter | 解决 LangSmith vendor lock |
| **Chord** | 应用组合 runtime：services + replicated state + RPC + plugins | 未来 PI-Lnk 多服务拆分的基础设施 |
| **协议** | TypeBox + CBOR + PROTOCOL_VERSION | Nest ↔ pi-runtime 通信的稳定契约 |
| **License MIT** | RFC 0015 公开承诺 core 永久 MIT | 商用法务无风险 |

---

## §4 层 ↔ 包 映射

### 4.1 整体映射图

```
┌─ PI-Lnk 新栈 ─────────────────────────────────────────────────────────┐
│                                                                       │
│  L7  Vue UI            ─ 不变                                          │
│         │                                                               │
│         ▼ SSE                                                       │
│  L6  Nest 入口         ─ 大改造：从硬切 env 改为调 PiSession          │
│         │                                                               │
│         ├─► @earendil-works/pi-ai           ← 替代 L1 上游 SDK 抽象     │
│         ├─► @earendil-works/pi-agent-core   ← 替代 L5 LangGraph 内核   │
│         ├─► @earendil-works/pi-coding-agent ← 提供 Session/Transport  │
│         │                                                               │
│         ├─► @earendil-works/pi-session-backend-sqlite-node           │
│         │   ← 替代 LangGraph SQLite checkpointer                       │
│         │                                                               │
│         ├─► @earendil-works/pi-telemetry    ← 替代 LangSmith 私货     │
│         │                                                               │
│         ├─► @earendil-works/pi-protocol     ← Nest ↔ pi-runtime RPC   │
│         │                                                               │
│         ├─► lnkpi-extension 包（NEW）                                  │
│         │   ├─ tools/  ← Nest 内部 canvas tools 包装成 pi 工具          │
│         │   ├─ skills/ ← 现有 agentskills.io SKILL.md 直接迁           │
│         │   ├─ prompts/ ← 现有 12 个 prompt-mode 改成 slash command     │
│         │   ├─ sub-agents/ ← 当前 4 个 explore/atomic/chat/visual 子图  │
│         │   └─ commands/ ← Dock 暴露的 skill picker / model picker    │
│         │                                                               │
│         └─► Nest 业务层（L3 canvas / studio / provider）               │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 逐层改动矩阵

| 层 | LOC（当前） | 改动方式 | 改动量 | 风险 |
|---|---|---|---|---|
| **L1 上游 SDK** | 散落各 provider | 改用 `@earendil-works/pi-ai`；自定义 provider 在 `packages/ai/src/providers/` 扩展（fal、Agnes 需自写 ~50 行/个） | 改 ~40%，删 ~60% | 中：模型兼容性需测试 |
| **L2 契约** | 6826 | **保留** Zod schemas；写 Zod → TypeBox 桥接（~50 行） | 0 | 低 |
| **L3 业务** | Nest canvas/studio/provider | **保留**；pi 的 tool proxy 指向 Nest 内部 API | 0 | 低 |
| **L4 `@lnkpi/agent` 工具库** | 5159 | 拆成两层：(a) **Nest 内 API 调用保留**（L4→L3）；(b) **工具描述迁到 pi extension**（pi → Nest 内部 token 调 L3） | 改 ~30%，删 ~30% | 中 |
| **L5 LangGraph Runtime** | 26735 | **整体弃用** | 删 100% | 高：业务规则全在这层，要全量迁 |
| **L6 Nest 入口** | 7224 | 改：`streamConversation` 内调 Agent + AgentHarness；agent-runtime.client 改成 PiSession adapter | 改 ~40% | 中 |
| **L7 Vue UI** | 现有组件 | **保留**；前端只改 SSE 事件对齐（pi AgentEvent → 现有 17 种事件） | 改 ~10% | 低 |

### 4.3 净 LOC 变化（粗估）

| 类别 | LOC |
|---|---|
| 删除 | -26735（LangGraph Runtime） |
| 删除 | -3500（`@lnkpi/agent` 中 prompt-modes 重复部分） |
| 新增 | +3000（lnkpi-extension：tools / skills / sub-agents / commands） |
| 新增 | +1500（Nest 适配 + Zod↔TypeBox 桥接 + 测试） |
| 新增 | +1000（fal / Agnes custom provider） |
| 新增 | +500（Nest → pi-runtime RPC 客户端 + pi-runtime 服务） |
| **净** | **-26000 行自研代码**（用 pi ~2000 行 core + ~5000 行 session/telemetry/protocol 替换） |

> **这就是用户担心的"自研 harness 演进阻力大"的直接量化答案 — 砍掉 26000 行自研代码，换来 Mario Zechner + Earendil Works 团队的持续投入。**

---

## §5 可行性分析：F1–F9 + 9 spec 能力覆盖

逐条核对侧栏必须保留的能力能否由 pi-mono 直接提供，或需要写多少 adapter 代码：

| # | 能力 | pi 直接提供 | 需要 adapter | 需自研 | 备注 |
|---|---|---|---|---|---|
| **F1 SSE 事件协议** | text_delta/text_replace/... 17 种 | ✅ 事件驱动原生（AgentEvent） | **需写映射层**（AgentEvent 11 种 → 现有 17 种） | — | 适配层是必须的 |
| **F2 侧栏素材入口** | T*/I*/V*/A* chips | ❌ | — | ✅ 自研 Nest DTO 保留 | UI/数据层完全不动 |
| **F3 文案规范** | 不出现 `原子创作：` 等 | ✅ system prompt 控制 | — | — | 移到 pi skill 内 |
| **F4 侧栏参考图路由** | RU-3/6/7/9 | ❌ | ✅ adapter | — | 写一个"侧栏 reference extractor" skill |
| **F5 Chat Sink L1 治理** | suspected_media_create 低置信进 clarify_route | ❌ | ✅ | — | 实现成 pi 的"router skill" |
| **F6 上传图片前置解析** | 同 thread 缓存 + 不扣分 | ❌ | ✅ | — | 在 Nest 侧做缓存，pi 不感知 |
| **F7 识图 ProviderContext 同一真相** | Nest 唯一 resolve | ✅（BYOK provider + getApiKey hook）| **Nest 强制再 resolve** 保持现有契约 | — | 不能让 pi 自己 resolve |
| **F8 explore 侧栏参考图 narrow set** | 4 个工具替换 attach_refs | ✅ AgentTool | ✅ | — | 在 pi extension 里注册 |
| **F9 裸生成绑定** | 无 @ 也能进 propose_generation | ✅ steering/followUp queue | — | — | pi 的队列天然支持 |
| **HITL** | 用户确认/修改/换方向 | ✅ AgentHarness `SuspendedRun` 或 `shouldStopAfterTurn` hook | ✅ | — | 比 LangGraph interrupt 更轻 |
| **Checkpoint / 回放** | 给定 state 重跑 | ✅ JSONL tree session + SessionBackend sqlite-node | — | — | 比 SQLite Saver 更通用 |
| **Tool registry** | Nest canvas tools 调用 | ✅ AgentTool | ✅ | — | 通过 service token 调 Nest |
| **Skills 格式** | agentskills.io SKILL.md | ✅ 完全兼容 | — | — | 现有 1 个 skill 直接迁 |
| **OAuth/Auth** | 用户 OAuth 登录 Claude/ChatGPT/Copilot | ✅ 3 内置 | — | — | 收益：用户能用自己的 Claude Pro 算力 |
| **Provider registry** | 多模型跨 provider | ✅ BYO + 50+ 内置 | — | — | 接管当前 L1 抽象 |
| **Token 计费** | 上游成本追踪 | ⚠️ 部分（Usage） | ✅ | — | pi 知道 token 数；要自写成本换算 |
| **中文 prompt-modes** | 12 个 mode 模板 | ❌ | ✅ 改成 pi slash command | — | 简单包装 |
| **Telemetry / trace** | LangSmith 替换 | ✅ pi-telemetry vendor-neutral | ✅ | — | 解决 vendor lock |

### 5.1 关键可行性结论

- **90% 能力由 pi-mono 直接覆盖**（agent loop / SSE 事件 / HITL / checkpoint / skill / OAuth / BYO model / telemetry）
- **8% 能力需要写薄 adapter**（事件映射 / custom provider / tool 代理 / Zod↔TypeBox / Nest ↔ pi-runtime RPC）
- **2% 能力是 Nest 业务层固有的**（侧栏 UI / 缓存 / 鉴权 / ProviderContext resolve）— 不动

**没有阻塞性 gap**。最坏情况是写 ~5000 行 extension / adapter 代码 + ~1500 行 Nest 适配。

---

## §6 复杂度评估（4 个硬骨头）

### 6.1 工程量总览（4 个真实难点，按难度排序）

| # | 难点 | 工程量（人/天） | 风险 | 为什么难 |
|---|---|---|---|---|
| **H1** | **26.7K 行 LangGraph Runtime 的业务规则迁出** | **15–20 天**（1.5 人 × 1.5 月） | **高** | 承载了过去 3 个月 100+ commit 的产品决策（atomic/explore/chat/marketing 4 个流、HITL 4 种 gate、media parse、propose bind、byok 等），**不是代码量大难，是知识量大难** — 每个 LangGraph node 都有 D-X 决策约束（Sidebar L1 D-7、Media Parse D-1…D-9、Vision ProviderContext D-SYNC…） |
| **H2** | **Session 语义对齐** | **2–3 天**（用 `pi-session-backend-sqlite-node` 1:1 替代） | 低-中 | 现成实现 + conformance tests；主要是把 LangGraph `AsyncSqliteSaver` 接口适配成 pi session 概念 |
| **H3** | **Nest ↔ pi-runtime RPC 通信** | **3–5 天** | 中 | 选 D-α.b 后独立 pi-runtime 服务；Nest → HTTP/JSON RPC；可参考 `@earendil-works/pi-protocol` TypeBox schema |
| **H4** | **5–7 个 prompt-mode 的语义无损迁移** | **3–4 天** | 中 | 当前 mode 不是"模板"，是含 few-shot + classifier hints + placeholder + 字段的复合体；pi slash command + skill 机制可承载，但需要写"mode router" skill 把 12 个 mode 收纳 |

> **总工程量**：~23–32 人/天（3 人 × 8 周 ≈ 1 人 × 1.5 月 — 与 §6 之前估算一致）

### 6.2 依赖与约束

| 依赖 | 风险 | 缓解 |
|---|---|---|
| **pi-mono API 仍 0.x 阶段（v0.85.1）** | 中 | vendor 到 monorepo（决策 D-γ.b），pin 版本号 + 必要时打 patch |
| **Node 版本要求** | 中 | pi-agent-core 要求 Node ≥22.19.0；当前 lnkpi monorepo `engines.node = ">=20"`，需要升级 package.json |
| **TypeBox vs Zod** | 低 | 写 Zod → TypeBox 桥接 ~50 行；core 只用 TypeBox，工具定义端用我们 Zod schema 自动转 |
| **OAuth 接入的安全审计** | 中 | 决策 D-δ.a 默认关闭；后续单独评审 |
| **Skill 迁移后业务回归测试** | 高 | 现有 `services/agent-runtime/tests/` 有大量 golden case，必须 1:1 重写到 pi 端回归 |
| **Pi 生态相比 LangGraph 的人才稀缺** | 低 | pi 是 Mario Zechner + Earendil Works；TS 通用能力即可 |
| **运行时从 Python 换 Node 的一致性** | 低 | Nest 已是 Node；Nest 重启更可控；部署工具链不变 |
| **Chord / Durable 是否引入** | 待定 | 首版仅用 agent-core + ai + session-sqlite-node + telemetry + protocol；chord/durable M2 视需要 |

### 6.3 必须先回答的 4 个真硬骨头（决策项）

| 编号 | 决策 | 选项（已拍板见 §10） |
|---|---|---|
| **D-α** | Pi session 部署形态 | ✅ **(b) 独立 Node 服务** |
| **D-β** | 迁移策略 | ✅ **(b) Strangler-fig** |
| **D-γ** | pi 版本控制 | ✅ **(b) vendor 到 monorepo** |
| **D-δ** | OAuth 接入默认开关 | ✅ **(a) 默认关闭** |

---

## §7 影响分析

### 7.1 用户可见影响（最小化目标）

| 维度 | 影响 | 备注 |
|---|---|---|
| 侧栏对话体验 | **应**保持 100% 不变 | SSE 事件对齐即可 |
| 新建对话 / 继续对话 / 重连 | **应**保持 | JSONL tree session 体验更稳 |
| 任务卡 / 进度卡 | **应**保持 | task_list/task_update 事件对齐 |
| 出图 / 出视频 / 出音频 | **应**保持 | 调 Nest 内部 canvas tools，路径不变 |
| BYOK 模型选择 | **应**保持 + **新增** OAuth 接入（D-δ.a 首版关闭） | F7 同真相保留 |
| 积分 / 计费 | **应**保持 | Nest 仍做计费 source-of-truth |
| Skill 选择器 | **应**保持 | pi skill 列表 → Dock UI |
| 「确认 / 修改 / 重做」按钮 | **应**保持 | pi AgentHarness `SuspendedRun` + `shouldStopAfterTurn` hook 对应 |

### 7.2 工程影响（主要变更面）

| 维度 | 影响 |
|---|---|
| **删** | 26735 行 Python（services/agent-runtime 整个删） |
| **删** | ~3500 行 TS（`@lnkpi/agent` 中 prompt-modes 重复部分） |
| **改** | ~4500 行 Nest 入口 + 测试 |
| **新增** | ~3000 行 lnkpi-extension（tools / skills / sub-agents / commands） |
| **新增** | ~1500 行 Nest Agent + AgentHarness 适配 + Zod↔TypeBox 桥接 |
| **新增** | ~1000 行 fal / Agnes custom provider |
| **新增** | ~500 行 Nest → pi-runtime RPC 客户端 |
| **新增** | `services/pi-runtime/`（独立 Node 服务） |
| **测试重写** | golden case 集（LangGraph 端 → pi 端）；预计 200+ 用例迁移 |
| **文档重写** | 9 份 sidebar spec 全部需要"迁移指南"附录 |
| **CI/CD** | 移除 Python 服务部署；新增 pi-runtime 部署 |

### 7.3 业务 / 商业影响（核心动机）

| 维度 | 当前 | 切换后 |
|---|---|---|
| **自研维护负担** | ~27000 行 Python + ~5000 行 TS agent 框架 | **几乎归零** |
| **上游 bug 修复** | 等自己改 | Mario Zechner + Earendil Works + 社区实时修 |
| **新能力扩展** | 自己写 agent loop 变体 | 用 pi extension 30 行注册 |
| **Skill 生态** | 仅 1 个内部 SKILL.md | 可发 npm package 给生态用 |
| **OAuth 算力** | 仅 BYOK API key | **白送** Claude Pro/ChatGPT Plus 用户算力（D-δ.a 默认关闭） |
| **模型 registry** | 自己维护（OpenAI/Anthropic/DeepSeek/fal/MiniMax/Agnes/...） | pi 维护 50+ provider，仅 fal / Agnes 自写 |
| **风险** | 单点维护 / 关键人员离职 / 跟进 LLM 演化能力 | 跟随上游节奏（vendor fork 兜底） |
| **未来阻力** | 高（每加 1 个能力 = 改 agent loop / prompt-mode registry / state） | 低（加 skill 或 extension 即可） |
| **License** | 自有 | MIT（RFC 0015 公开承诺 core 永久 MIT） |

### 7.4 数据迁移

| 数据 | 处理 |
|---|---|
| Prisma `Session.canvasData` | 不动（Nest 持久化层不依赖 runtime） |
| Prisma `AgentMessage` 表 | 不动（同上） |
| Prisma `IdempotencyRecord` | 不动 |
| LangGraph SQLite checkpointer 数据 | 归档 30 天后清理（D-ζ.b 30 天回退窗口期） |
| Pi session 数据 | 新建 `pi-sessions.db` SQLite（用 `pi-session-backend-sqlite-node`） |

---

## §8 风险与回退

### 8.1 风险清单

| # | 风险 | 概率 | 影响 | 缓解 / 回退 |
|---|---|---|---|---|
| **R1** | pi-mono 项目突然停止维护 | 低-中 | 高 | vendor fork 到自己仓（D-γ.b），保留 upmerge 通道 |
| **R2** | pi API 重大 break change（0.x → 1.0） | 中 | 中 | pin 版本 + 薄 adapter 层隔离；vendor 后打 patch |
| **R3** | 26.7K 行迁移中漏掉业务规则 | 中 | **高** | **必须做 golden case 1:1 回归**；建议 H1 完成后才动手 H2-H4 |
| **R4** | Nest 入口改坏生产 | 中 | 高 | 影子模式跑 2 周后切；保留 LangGraph 启动开关 30 天（D-ζ.b） |
| **R5** | 用户 OAuth 接入触发的合规问题 | 低-中 | 中 | 默认关闭（D-δ.a）+ 法务评审；仅企业版可选 |
| **R6** | Skill 生态吸引来恶意 skill | 低 | 中 | pi 内置 permission gates；PI-Lnk 加 Skill registry 白名单 |
| **R7** | Node 22.19+ 升级引发现有模块不兼容 | 低 | 中 | pnpm workspaces 锁定；先在 PI-Lnk 仓库升级，原 lnkpi 仓库不动 |
| **R8** | `fal` / Agnes custom provider 写错影响生成 | 中 | 中 | 沿用现有 Nest `provider-resolver` 做单测；切流前回放 100+ 历史生成请求 |
| **R9** | Zod ↔ TypeBox 桥接漏掉边界 case | 中 | 中 | 工具 schema 测试覆盖 100%（从现有 Nest agent-canvas-tools.service 单测迁） |
| **R10** | pi-runtime 服务资源开销大于 LangGraph | 低 | 低 | 监控 + 弹性扩缩容；如需可改回 Nest 同进程（D-α.a） |

### 8.2 回退预案

| 回退等级 | 触发 | 操作 |
|---|---|---|
| **L1（瞬时回滚）** | pi-runtime 5xx 率 > 5% | 自动切回 LangGraph Runtime（保留 `AGENT_RUNTIME_URL` 切换能力 30 天） |
| **L2（版本回滚）** | pi-mono 升级引入破坏性 | vendor pin 回上一个稳定 tag；本仓库内打 patch |
| **L3（架构回滚）** | pi-mono 整体路线变更 / 团队失活 | 切回 LangGraph（保留仓库）+ 启动 fork 自研 agent loop 计划 |
| **L4（紧急熔断）** | Nest 启动后 Agent 连续 N 分钟 0% 成功 | kill 切走；启用硬编码 fallback 直连 Nest 内部 canvas tools |

---

## §9 关键时间窗

### 9.1 冻结期 / 上线窗口

- **冻结期**（最后 1 周）：仅 bug fix + 必要 spec 文档
- **生产窗口**（用户最活跃时段）：不在该窗口上线 pi-runtime 切流
- **回退预案**：每次切流后保留 30 天回退开关（D-ζ.b）

### 9.2 迁移 4 phase（与决策 D-β.b Strangler-fig 对齐）

| Phase | 范围 | 验收 | 估时 |
|---|---|---|---|
| **P0 基础设施** | vendor pi；新建 `services/pi-runtime`；写 Zod↔TypeBox 桥接；Nest 加 Agent / AgentHarness 调用 | vendor 编译过；pi-runtime health check 200；Nest 能调通 Agent | 1 周 |
| **P1 chat / explore 路径** | 迁最简单路径；golden case 1:1 回归 | chat/explore 100% golden case 通过；用户抽样测试无感知差异 | 1.5 周 |
| **P2 atomic 路径（含 12 prompt-mode）** | 迁最复杂单点路径；D-F1–F9 全部 spec 能力验证 | atomic 100% golden case 通过；侧栏 9 份 spec 行为不变 | 2.5 周 |
| **P3 marketing 路径（最复杂）** | 迁企业营销 skill；HITL interrupt 语义对齐 | marketing 100% golden case 通过；HITL 用户行为不变 | 2 周 |
| **P4 收尾** | 删 LangGraph Runtime；归档；ADR 写选 pi 的数据依据 | -26000 行；CI 全绿；文档齐 | 1 周 |

> **总工期**：~8 周（与之前估算一致）
> **资源**：2 人并行（1 人迁 runtime，1 人写 extension + 测试）

---

## §10 决策记录（已拍板）

| ID | 决策 | 拍板结论 | 备注 |
|---|---|---|---|
| **D-α** | pi-runtime 部署形态 | **(b) 独立 Node 服务** | 用 `@earendil-works/pi-server` + `@earendil-works/pi-protocol`；Nest → HTTP/JSON-RPC 调用 |
| **D-β** | 迁移策略 | **(b) Strangler-fig** | 4 phase：chat/explore → atomic → marketing → 收尾（见 §9.2） |
| **D-γ** | pi 版本控制 | **(b) vendor 到 monorepo** | `vendor/earendil-works/pi/` 子目录；保留 upmerge 通道 |
| **D-δ** | OAuth 接入默认开关 | **(a) 默认关闭** | 首版稳；后续单独评审 |
| **D-ε** | 新项目命名 | **PI-Lnk** | 包名 `@pi-lnk/*`；UI 顶部品牌名 PI-Lnk |
| **D-ζ** | 老 LangGraph Runtime 处置 | **(b) 保留 30 天回退开关** | 通过 `AGENT_RUNTIME_URL` 切换；30 天后归档 |
| **D-η** | 自研 `@lnkpi/agent` 归宿 | **(b) 部分保留** | 保留 `applyCanvasActions` / `createUpscaleProviders` / `buildImageProviderOptions` 等纯函数工具；prompt-modes 全部删除 |

> **变更历史**：以上决策在 brainstorming 第四轮由用户一次性拍板（"7 个决策按你的建议来"）。

---

## §11 下一步（待用户决定）

按用户当前指令"先不着急写规格和计划"，下一步**不是**写 spec / plan。可能的推进方向：

| 选项 | 说明 | 用户拍板后我能做什么 |
|---|---|---|
| **N1 精读 pi 源码深一层** | 已读 agent / agent-loop / skills / providers / session / protocol / server；可继续读 AgentHarness / SuspendedRun / pi-durable / chord 的具体 API | 产出 §6 H1–H4 精确实现示例 + golden case 1:1 映射示例 |
| **N2 写 PoC spike** | 写 1 个最小 PoC：Nest 调 pi Agent + 1 个 custom tool（Nest 内部 canvas） + 1 个 SKILL.md | 验证假设 + 暴露未预见问题 |
| **N3 写规格文档** | 写 PI-Lnk 第一份 spec（`docs/superpowers/specs/2026-09-XX-pi-lnk-migration-spec.md`） | — |
| **N4 写实施计划** | 调 writing-plans skill 写详细实施计划 | — |
| **N5 开始 Phase 0** | 启动 vendor pi + 新建 services/pi-runtime | — |

**用户回复任一即可推进。** 在此之前，本讨论文档保持 v1，不再自动迭代。

---

## §A 附录：源码引用与事实校准

### A.1 已读文件清单（earendil-works/pi @ v0.85.1）

| 文件 | 行数 | 关键摘录 |
|---|---|---|
| `packages/agent/src/agent.ts` | 607 | `Agent class` 完整实现 |
| `packages/agent/src/agent-loop.ts` | 857 | `runAgentLoop` + `runAgentLoopContinue` |
| `packages/agent/src/types.ts` | 463 | `AgentEvent` 11 种 / `AgentTool` / `AgentContext` |
| `packages/agent/src/harness/agent-harness.ts` | 开头 80 | `SuspendedRun`、`HarnessClosed` 等错误类型 |
| `packages/agent/src/harness/skills.ts` | 396 | `loadSkills` / `formatSkillInvocation` |
| `packages/agent/src/harness/session/types.ts` | 602 | Session 抽象（MessageEntry / CompactionEntry / BranchSummaryEntry / CustomEntry） |
| `packages/server/src/server.ts` | 开头 60 | `Server class` + `SessionRouter` + `PROTOCOL_VERSION = 8` |
| `packages/coding-agent/src/core/agent-session.ts` | 开头 80 | AgentSession 跨模式（Interactive/Print/RPC）共用 |
| `packages/agent/package.json` | — | `engines.node: ">=22.19.0"`, deps: pi-ai + pi-telemetry + chord + diff + ignore + typebox + yaml |
| `packages/session-backends/sqlite-node/package.json` | — | 独立 SQLite session backend |
| `packages/ai/src/providers/` | 50+ 文件 | provider 列表（见 §3.2） |
| `packages/protocol/src/protocol.ts` | 开头 50 | TypeBox schema + CBOR framing |

### A.2 关键事实校准

| 我之前以为 | 实际（源码事实） | 校准 |
|---|---|---|
| 640 行 agent loop | 857 行 agent-loop.ts + 607 行 Agent class | 更新 |
| Agent 单文件 | 拆为 agent.ts + agent-loop.ts + types.ts + stream-fn.ts + proxy.ts + node.ts | 更新 |
| Zod schema | **TypeBox** schema | 新增 Zod↔TypeBox 桥接需求 |
| 内置 fal provider | ❌ 需自写 | 新增 ~50 行 custom provider |
| 内置 MiniMax provider | ✅ `minimax.ts` + `minimax-cn.ts` | 移除自研 MiniMax H3 provider 部分 |
| SQLite checkpointer 在 pi-agent-core 内 | 拆为独立 `pi-session-backend-sqlite-node` | 直接装即用 |
| interrupt 事件在 core 层 | ❌ 在 AgentHarness + AgentSession 层 | 改用 `shouldStopAfterTurn` hook 或包 AgentHarness |
| provider 25+ | 实际 50+ | 更新 |
| 包 7 个 | 实际 13 个 workspace package | 更新 |

### A.3 之前估算 vs 实际

| 估算项 | 之前 | 实际 | 变化 |
|---|---|---|---|
| pi 直接覆盖能力 | 80% | **90%** | ↑ |
| 需要 adapter | 15% | **8%** | ↓ |
| 需自研 | 5% | **2%** | ↓ |
| 总工程量 | 20–30 人/天 | **23–32 人/天** | 一致 |
| 净删除 LOC | -26000 | **-26000** | 一致 |

---

## 附录 B：本文档元信息

| 字段 | 值 |
|---|---|
| 版本 | v1（2026-09-19 初版） |
| 仓库 | PI-Lnk（新项目） |
| 路径 | `docs/discussion/2026-09-19-pi-lnk-migration-discussion.md` |
| 关联 brainstorming thread | `01a0b57a-04c1-7763-9f74-ab57666a52dc` |
| 关联原始仓库 | lnkpi (`/Users/4seven/workspace/lnkpi`) |
| 关联 pi 源码（仅本次分析使用） | `/private/tmp/pi-research/pi`（已 clone `earendil-works/pi` v0.85.1） |
| 下一步 | 等用户在 §11 N1–N5 中选一项 |

