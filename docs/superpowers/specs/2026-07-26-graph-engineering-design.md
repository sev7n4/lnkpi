# Graph Engineering 层产品规格（设计）

> 状态：**已确认**（2026-07-26）；**L1 Loop 层 ✅**（2026-08-04）  
> 日期：2026-07-26（v1.2）  
> 前置：[2026-07-23-agent-runtime-langgraph-design.md](./2026-07-23-agent-runtime-langgraph-design.md)  
> Loop 层：[2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md)

| 字段    | 值                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档版本  | v1.2                                                                                                                                                                              |
| 创建日期  | 2026-07-26                                                                                                                                                                        |
| 文档定位  | Graph Engineering 层的设计规格（指导实施计划）                                                                                                                                                  |
| 关联文档  | [agent-graph-engineering-refactor.md](../plans/2026-07-24-agent-runtime-langgraph.md)（实施计划）、[2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md)（L1） |
| 方法论来源 | IBM《What is loop engineering》、Alphamatch《Loop Engineering: The Quiet Revolution》、Anthropic《Building Effective Agents》、OpenAI《A Practical Guide to Building Agents》、LangGraph 官方哲学 |

***

## 一、Agentic AI 工程六层模型

### 1.1 完整的工程栈（2026 业界共识）

设计一个 Agentic AI 产品，需要处理**六个工程层**的问题。这是一个自底向上的栈，每一层解决不同时间维度的问题：

```
┌────────────────────────────────────────────────────┐
│  Observability Engineering  (监控与可观测性)         │  Trace/Metrics/Logs/告警/调试
│  ┌──────────────────────────────────────────────┐  │
│  │  Harness Engineering  (OS 操作系统)            │  │  工具/沙箱/权限/生命周期/部署
│  │  ┌────────────────────────────────────────┐  │  │
│  │  │  Loop Engineering  (进程调度循环)        │  │  │  ★ 迭代循环设计
│  │  │  Goal → Act → Observe → Adjust → Repeat │  │  │  自修正/终止策略/错误处理
│  │  │  ┌──────────────────────────────────┐  │  │  │
│  │  │  │  Graph Engineering  (文件系统+调度) │  │  │  │  ★ 本文档聚焦
│  │  │  │  State/Node/Edge/HITL/DAG/恢复     │  │  │  │  控制流图与数据依赖图
│  │  │  │  ┌────────────────────────────┐  │  │  │  │
│  │  │  │  │  Context Engineering (RAM) │  │  │  │  │  RAG/history 裁剪/tool desc 组装
│  │  │  │  │  ┌──────────────────────┐  │  │  │  │  │
│  │  │  │  │  │  Prompt Engineering  │  │  │  │  │  │  指令措辞/角色/格式约束
│  │  │  │  │  │       (CPU 指令)      │  │  │  │  │  │  单次推理的"怎么说"
│  │  │  │  │  └──────────────────────┘  │  │  │  │  │
│  │  │  │  └────────────────────────────┘  │  │  │  │
│  │  │  └──────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### 1.2 各层定义与边界

| 层                             | 定义（业界共识）                                    | 解决的核心问题               | 决策频率        | 时间维度   |
| ----------------------------- | ------------------------------------------- | --------------------- | ----------- | ------ |
| **Prompt Engineering**        | 设计单次推理的指令措辞、角色、格式约束                         | "如何对模型说话才能得到想要的输出"    | 系统设计时，写一次少改 | 单次推理   |
| **Context Engineering**       | 组装模型回答前需要看到的所有信息（RAG、history、tool desc）     | "模型回答前应该看到什么"         | 每次 LLM 调用前  | 单次调用   |
| **Graph Engineering**         | 用图结构组织多次 LLM 调用的控制流（State/Node/Edge/HITL）   | "如何用图结构编排多轮对话与任务流"    | 图设计时        | 整个会话   |
| **Loop Engineering**          | 设计代理的迭代循环机制（Goal→Act→Observe→Adjust→Repeat） | "代理如何自修正、何时终止、如何处理错误" | 循环设计时       | 迭代轨迹   |
| **Harness Engineering**       | 提供工具、沙箱、权限、生命周期管理、部署                        | "代理运行在什么环境、能调用什么工具"   | 系统级         | 整个生命周期 |
| **Observability Engineering** | Trace、Metrics、Logs、告警、调试                    | "如何观测、诊断、优化代理行为"      | 运行时持续       | 运维期    |

### 1.3 Loop Engineering 的定位（业界新共识）

**Loop Engineering 是什么？**

根据 IBM（2026-07）的定义：

> "Loop engineering is the practice of designing agentic workflows, or *loops*, that iteratively guide AI agents toward completing user-defined goals with minimal human intervention."

根据 Alphamatch（2026-06）的定义：

> "Loop engineering treats the LLM as a single component within a larger, self-correcting state machine. The 'unit of value' in AI has shifted from the *response* to the *trajectory*."

**Loop Engineering 与 Graph Engineering 的关系**：

| 维度   | Graph Engineering       | Loop Engineering                        |
| ---- | ----------------------- | --------------------------------------- |
| 关注点  | 图的静态结构（State/Node/Edge） | 图的动态行为（迭代轨迹）                            |
| 核心问题 | "有哪些节点、如何连接"            | "如何迭代、何时终止、如何自修正"                       |
| 时间维度 | 会话级（跨轮）                 | 轨迹级（迭代次数）                               |
| 典型模式 | StateGraph、DAG、HITL 门   | ReAct cycle、Critic-Refiner、self-healing |
| 设计输出 | 图结构定义                   | 终止策略、错误处理、feedback loop                 |

**关系模型**：Loop Engineering 是 Graph Engineering 的"动态语义层"。Graph 定义"骨架"，Loop 定义"行为"。一个完整的 Agent 系统需要同时定义静态图结构（Graph 层）和动态迭代逻辑（Loop 层）。

**本项目 Loop Engineering 层的产品设计文档预留**：

| 文档 ID | 文档名称                             | 设计内容                              | 与本文档衔接点                     |
| ----- | -------------------------------- | --------------------------------- | --------------------------- |
| L1    | [2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md) ✅ v1.0 | 有界 retry、HITL revise、LC-1~7 循环、断流关账 | 本文档 G-P6（故障分级传播）、W3（出图编排恢复） |
| L2    | evaluator-optimizer-pattern.md   | Critic-Refiner 模式、LLM judge、迭代改进  | 本文档 await\_\* 门 → revise 回路 |

### 1.4 设计 Agentic AI 产品的先后顺序

**业界最佳实践（Anthropic + OpenAI + LangGraph 团队）**：

```
设计顺序（自顶向下）：
─────────────────────────────────────────────────────────────────
阶段 1：业务建模与问题定义
  ├─ 定义用户场景、任务边界、成功标准
  └─ 输出：PRD、验收标准
        ↓
阶段 2：Graph Engineering（本文档）
  ├─ 设计控制流图（State/Node/Edge）
  ├─ 设计数据依赖图（DAG）
  ├─ 设计 HITL 确认门位置
  └─ 输出：本规格文档
        ↓
阶段 3：Loop Engineering ✅
  ├─ 定义每个节点的迭代策略
  ├─ 定义终止条件、错误处理
  └─ 输出：[2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md) v1.0
        ↓
阶段 4：Context Engineering
  ├─ 设计 RAG 检索策略
  ├─ 设计 history 裁剪规则
  ├─ 设计 tool description 措辞
  └─ 输出：context-engineering-product-spec.md
        ↓
阶段 5：Prompt Engineering
  ├─ 设计每个 LLM 节点的 prompt 模板
  ├─ 设计输出格式约束
  └─ 输出：prompt-engineering-product-spec.md
        ↓
阶段 6：Harness Engineering
  ├─ 实现工具、沙箱、权限
  ├─ 设计部署架构
  └─ 输出：harness-engineering-product-spec.md
        ↓
阶段 7：Observability Engineering
  ├─ 设计 trace/metrics/logs
  ├─ 设计告警与调试工具
  └─ 输出：observability-engineering-product-spec.md
        ↓
阶段 8：实施与迭代
  ├─ 按实施计划编码
  ├─ 集成测试
  └─ 生产验证
─────────────────────────────────────────────────────────────────
```

**为什么是这个顺序？**

1. **Graph 先于 Loop**：先定义静态图结构，再定义动态迭代行为。没有骨架，循环无处附着。
2. **Graph 先于 Context/Prompt**：先定义"有哪些节点"，再定义"每个节点看到什么、说什么"。Graph 层决定了 context 的使用场景。
3. **Loop 在 Graph 之后、Harness 之前**：Loop 依赖 Graph 的节点结构，但独立于 Harness 的工具实现。
4. **Harness 最后**：工具实现依赖前面所有层的设计稳定。

**例外情况**：

* 如果是 PoC 原型，可以直接从 Prompt 开始，自底向上试错。

* 如果是已有系统重构，可以从 Harness 向上审视（如本项目）。

### 1.5 各层产品设计文档的衔接体系

为确保可阅读性与可维护性，各层文档应遵循统一结构：

| 章节         | 内容                   | 衔接要求            |
| ---------- | -------------------- | --------------- |
| 一、层定位与边界   | 定义本层在工程栈中的位置、与其他层的关系 | 必须引用上层文档、明确本层边界 |
| 二、设计方法论    | 业界最佳实践、设计原则          | 可引用业界文献         |
| 三、产品规格     | 本项目的具体设计决策           | 必须引用业务 PRD、验收标准 |
| 四、设计决策记录   | ADR 列表，每个决策记录理由      | 必须引用设计原则编号      |
| 五、与实施计划的映射 | 规格 → 工作项 → Sprint    | 必须链接实施计划文档      |
| 六、验收标准     | 可量化、可测试的标准           | 必须对应产品规格        |
| 七、未覆盖的层    | 明确边界，链接其他层文档         | 必须列出待定义的层及文档 ID |

**本项目已定义的文档**：

| 文档 ID | 文档名称                                      | 状态    | 覆盖层                       |
| ----- | ----------------------------------------- | ----- | ------------------------- |
| M0    | master-product-design-spec.md             | ✅ 已完成 | 总纲（产品定位、架构概览、文档索引）        |
| G1    | graph-engineering-product-spec.md         | ✅ 本文档 | Graph Engineering         |
| L1    | loop-engineering-product-spec.md          | ✅ 已完成 | Loop Engineering          |
| C1    | context-engineering-product-spec.md       | ✅ 已完成 | Context Engineering       |
| P1    | prompt-engineering-product-spec.md        | ✅ 已完成 | Prompt Engineering        |
| H1    | harness-engineering-product-spec.md       | ✅ 已完成 | Harness Engineering       |
| O1    | observability-engineering-product-spec.md | ✅ 已完成 | Observability Engineering |
| I1    | agent-graph-engineering-refactor.md       | ✅ 已完成 | 实施计划（跨层）                  |

**文档体系完成度**：✅ 总-分结构文档体系已完成（M0 总纲 + 六层分文档 + I1 实施计划）。

***

## 二、Graph Engineering 层的定位

### 2.1 Graph Engineering 层的职责

**属于 Graph Engineering 层**：

* State schema 设计（字段、reducer、不可变性、分层）

* Node 职责划分与单一职责原则

* Edge 路由逻辑（条件边、guard、event 分离）

* HITL 确认门的位置与恢复机制

* 子图分层与组合

* 数据依赖图（DAG）的拓扑与故障传播

* Checkpoint 粒度与恢复策略

**不属于 Graph Engineering 层**（明确划归其他层）：

* Prompt 内容设计 → Prompt Engineering 层（文档 P1）

* 上下文组装（RAG 检索、history 裁剪、tool description 措辞）→ Context Engineering 层（文档 C1）

* 迭代循环设计（终止策略、错误处理、self-healing）→ Loop Engineering 层（文档 L1）

* 工具实现与沙箱隔离 → Harness Engineering 层（文档 H1）

* Trace/Metrics/Logs → Observability Engineering 层（文档 O1）

### 2.2 边界原则

**Graph 层只定义"骨架"**：

* State 是内存布局

* Node 是处理阶段

* Edge 是转移路径

* HITL 门是暂停点

* Checkpoint 是快照边界

**"血液"（context 内容）和"细胞"（prompt 措辞）由其他层定义**：

* Graph 层不规定 plan 节点"用什么 prompt"，只规定"plan 节点存在、输入输出是什么"

* Graph 层不规定 history"如何裁剪"，只规定"messages 字段存在、用什么 reducer"

**设计哲学**：骨架稳定，血液和细胞可独立迭代。Graph 层变更成本高（影响整个控制流），应尽量稳定；Context/Prompt 层可高频迭代优化。

***

## 二、Graph Engineering 设计方法论

### 2.1 Anthropic 五大工作流模式（Graph 层视角）

| 模式                   | 图结构                   | 何时使用            | 本项目应用                                               |
| -------------------- | --------------------- | --------------- | --------------------------------------------------- |
| Prompt Chaining      | 线性 A→B→C              | 子任务可固定分解，每步简化问题 | plan → split → draft\_copy                          |
| Routing              | 分叉树                   | 输入可分类，每类有专门处理   | intake → {plan, chat}                               |
| Parallelization      | fan-out → fan-in      | 子任务独立，可并行       | dispatch\_gen → \[run\_one\_gen × N] → collect\_gen |
| Orchestrator-Workers | 动态 fan-out（LLM 决定子任务） | 子任务不可预测         | （本项目暂未用，预留）                                         |
| Evaluator-Optimizer  | 循环 generate↔evaluate  | 有明确评估标准，迭代改进    | await\_\*门 → revise → 回上游                           |

**Anthropic 核心警告**：简单胜过复杂。最成功的实现用简单、可组合的模式，而非复杂框架。只在"复杂度 genuinely 需要"时才升级模式。

### 2.2 OpenAI orchestration 原则

* **单 agent 优先**，工具逐步增加；多 agent 切换条件：分支复杂到 prompt 难以扩展，或工具过载导致选错

* **两种编排模式**：Manager（agents-as-tools，集中调度）vs Decentralized handoff（peer 转交）

* **Guardrails 分层**：input / output / tool call 三层，乐观执行 + tripwire 并行检查

* **HITL 触发**：失败阈值超限、高风险动作（退款/支付/敏感写）、无法完成时优雅转交

### 2.3 LangGraph 哲学

* **State 是"内存+消息+快照"三合一**：跨节点共享，节点返回 delta，reducer 合并

* **Node 是纯函数**：读 state，返回 delta，不直接修改外部

* **Edge 分 normal/conditional**，原生支持 cycle（区别于传统 DAG）

* **Pregel BSP 模型**：super-step + barrier + reducer，同层节点并行

* **Checkpoint 是 HITL 与恢复的基石**：每个节点边界自动快照，crash 可从最近 checkpoint 恢复

* **interrupt\_before + Command(resume)**：原生 HITL 机制，无需自造 awaiting 标志

### 2.4 Graph Engineering 七大设计原则（综合三家）

| 编号       | 原则                 | 含义                                                         | 违反后果                    |
| -------- | ------------------ | ---------------------------------------------------------- | ----------------------- |
| **G-P1** | 图结构显式化             | 控制流用 State/Node/Edge 声明，不藏在 prompt 或代码 if-else 里           | 路由逻辑不可见，调试困难            |
| **G-P2** | State 原子性          | 一个 phase 枚举驱动路由，避免多字段共决组合爆炸                                | 312 种组合中仅 15 合法，状态机不一致  |
| **G-P3** | Node 单一职责          | 一个节点只做一件事（判定/LLM/副作用/IO）                                   | 难以复用、测试、checkpoint 粒度失控 |
| **G-P4** | Edge 守卫分离          | event（触发）与 guard（条件）分离，guard 只读 state                      | 路由逻辑散落，无法推理合法转移         |
| **G-P5** | HITL 用原生 interrupt | 不造 awaiting\_user 标志，用 interrupt\_before + Command(resume) | 暂停态无法跨进程恢复，状态不一致        |
| **G-P6** | DAG 故障分级传播         | 硬失败级联，软失败暂停可恢复                                             | 单点失败污染全局，或误级联丢失可恢复任务    |
| **G-P7** | Checkpoint 持久化     | 生产用 DB-backed checkpointer，crash 可恢复                       | 进程重启全丢，HITL 暂停态失效       |

***

## 三、本项目 Graph Engineering 层产品规格

### 3.1 双图模型规格

本项目采用**双图模型**，控制流与数据流分离：

| 图          | 类型                                         | 节点                      | 执行引擎                             | 持久化                | 设计依据                         |
| ---------- | ------------------------------------------ | ----------------------- | -------------------------------- | ------------------ | ---------------------------- |
| **控制流图**   | LangGraph StateGraph（支持 cycle + interrupt） | 18 个语义节点（W10 拆分后）       | LangGraph Pregel BSP             | SqliteSaver（W1）    | 需 HITL 门、cycle、checkpoint 恢复 |
| **生成 DAG** | 数据依赖图（DAG，无环）                              | 动态，由 split\_manifest 定义 | gen\_scheduler + Send fan-out（W3，详见六-B） | GenProgress 表（W15） | 需拓扑排序、并行、故障传播                |

**决策依据**：

* 控制流用 LangGraph：原生支持 interrupt\_before / Command(resume) / checkpoint / Send，避免重造 FSM 轮子

* 生成 DAG 用 Send fan-out：每个生成任务是独立 checkpoint 边界，crash 后可单点恢复，不重跑已成功节点

### 3.2 State 规格

#### 3.2.1 分层原则

| 层级       | 存放内容              | 存储                         | 生命周期     |
| -------- | ----------------- | -------------------------- | -------- |
| 主图 state | 跨轮稳定 + 控制流必需字段    | LangGraph checkpoint       | 跨轮       |
| 子图 state | 子图内部 transient 字段 | LangGraph checkpoint（子图独立） | 单子图执行内   |
| 外置 DB    | 大体积/可查询数据         | Prisma 表                   | 永久或按 TTL |

**原则**：主图 state 保持精简（≤18 字段），transient 数据外置，避免 checkpoint 体积膨胀。

#### 3.2.2 主图 State 字段规格（目标态，W15 后）

| 类别       | 字段                                                  | reducer              | 不可变   | 说明                    |
| -------- | --------------------------------------------------- | -------------------- | ----- | --------------------- |
| 对话       | `messages`                                          | `add_messages`       | 否     | 累积；W2 后 DB 为权威源       |
| 控制流      | `phase`                                             | 覆盖                   | 否     | **仅可观测标签，不驱动路由**（W5）  |
| 会话标识     | `thread_id` / `session_id` / `user_id` / `skill_id` | 覆盖                   | 是     | 首轮锁定                  |
| brief 锚定 | `user_brief`                                        | `brief_reducer`（W14） | **是** | 独立 channel，二次写拒绝      |
| 模式       | `mode`                                              | 覆盖                   | 否     | create / modify       |
| 方案       | `plan_summary` / `plan_draft` / `plan_node_id`      | 覆盖                   | 否     | —                     |
| 画布清单     | `split_manifest` / `revised_manifest` / `gen_order` | 覆盖                   | 否     | gen\_order 预排序（W13）   |
| 文案       | `copy_draft` / `copy_node_id`                       | 覆盖                   | 否     | —                     |
| 指针       | `gen_progress_id`                                   | 覆盖                   | 否     | 指向 GenProgress 表（W15） |
| 错误       | `last_error`                                        | 覆盖                   | 否     | 单值，便于诊断               |

**移除字段**（相对当前）：

* `awaiting_user`、`pending_orchestrate`（W5 改用原生 interrupt）

* `brief_locked`（W14 改用独立 channel reducer）

* `gen_queue`、`gen_completed`、`gen_failed`（W3 改由 collect\_gen 查 generation record）

* `progress_lines`、`summary_lines`（W15 外置到 GenProgress 表）

* `user_decision`（保留但仅门内读写，不跨节点传递）

* `topology_mode`、`focus_node_ids`、`copy_revise_only`（评估是否外置或移除）

#### 3.2.3 不可变性规格

| 字段                                     | 不可变机制  | 实现方式                                         |
| -------------------------------------- | ------ | -------------------------------------------- |
| `user_brief`                           | 架构禁止覆盖 | 独立 channel + `brief_reducer`（首次接受，二次拒绝）（W14） |
| `thread_id` / `session_id` / `user_id` | 首轮锁定   | intake 节点仅在值为空时写入                            |
| `skill_id`                             | 首轮锁定   | intake 节点仅在值为空时写入                            |

**原则**：不可变性靠架构保证（reducer / channel），不靠标志位约定。

### 3.3 Node 规格

#### 3.3.1 单一职责矩阵

| 节点                   | 单一职责                          | 类型     | LLM | 副作用 | 所属子图               |
| -------------------- | ----------------------------- | ------ | --- | --- | ------------------ |
| `intake`             | 意图分类 + brief 锁定 + mode 判定     | 判定     | 否   | 否   | 主图                 |
| `chat`               | 闲聊兜底                          | LLM    | 是   | 否   | 主图                 |
| `decide_plan_mode`   | create/modify/node\_revise 判定 | 判定     | 否   | 否   | confirm\_gate（W10） |
| `revise_manifest`    | LLM 增量改 manifest              | LLM    | 是   | 否   | confirm\_gate（W10） |
| `generate_plan`      | LLM 生成/修改方案                   | LLM    | 是   | 否   | confirm\_gate（W10） |
| `compose_confirm`    | 构造确认消息                        | 纯函数    | 否   | 否   | confirm\_gate（W10） |
| `await_confirm`      | 方案门分类器                        | 判定     | 否   | 否   | confirm\_gate      |
| `write_plan_node`    | 方案写入画布                        | 副作用    | 否   | 是   | confirm\_gate      |
| `split`              | 拆解骨架 + 预排序 + 环检测              | 副作用+计算 | 否   | 是   | 主图                 |
| `draft_copy`         | LLM 生成文案                      | LLM    | 是   | 否   | copy\_gate         |
| `await_copy_confirm` | 文案门分类器                        | 判定     | 否   | 否   | copy\_gate         |
| `write_copy_node`    | 文案写入画布                        | 副作用    | 否   | 是   | copy\_gate         |
| `await_topo`         | 拓扑门 4 路分类器                    | 判定     | 否   | 否   | topo\_gate         |
| `topo_revise`        | 启发式删节点                        | 规则引擎   | 否   | 是   | topo\_gate         |
| `start_gen`         | 初始化 W3 生成状态字段                 | 纯函数    | 否   | 否   | topo\_gate（W3）     |
| `gen_scheduler`     | Send fan-out 调度（详见六-B）        | 调度     | 否   | 否   | topo\_gate（W3）     |
| `gen_node`          | 单节点出图/出视频                     | IO     | 否   | 是   | topo\_gate（W3）     |
| `collect_gen`       | 聚合 + 写 GenProgress            | 聚合     | 否   | 是   | topo\_gate（W3）     |
| `done`               | 汇总                            | 纯函数    | 否   | 否   | 主图                 |

#### 3.3.2 节点设计原则

| 原则             | 说明                                     |
| -------------- | -------------------------------------- |
| 判定节点不用 LLM     | 用规则/intent 模块（W9），降低成本与不确定性            |
| LLM 节点不直接产生副作用 | 先返回 delta，由副作用节点提交（便于回滚与 stage/commit） |
| 副作用节点尽量小       | 单一写操作，包事务（W8 stage/commit）             |
| 纯函数节点可独立测试     | compose\_confirm / done 不依赖外部状态        |

### 3.4 Edge 规格

#### 3.4.1 Edge 分类

| 类型               | 数量  | 规则                                       |
| ---------------- | --- | ---------------------------------------- |
| Normal edge      | \~6 | A→B 固定流转（如 write\_plan\_node → split）    |
| Conditional edge | \~8 | guard 函数返回下一节点名                          |
| Send fan-out     | 1   | gen\_scheduler → \[gen\_node × N]（W3，详见六-B） |
| Subgraph 边       | 3   | 主图 → 子图入口                                |

#### 3.4.2 Guard 设计原则

| 原则                           | 说明                             |
| ---------------------------- | ------------------------------ |
| guard 只读 state               | 不产生副作用，纯函数                     |
| guard 返回节点名字符串               | 或 Send 列表，类型明确                 |
| guard 逻辑集中                   | route\_after\_\* 函数，不散落在节点内    |
| 移除 route\_entry 30 行 if-else | W5 后由 interrupt\_before 自动恢复入口 |

#### 3.4.3 HITL 边规格（W5）

```python
graph.compile(
    checkpointer=checkpointer,
    interrupt_before=[
        "await_confirm",      # 方案门
        "await_copy_confirm", # 文案门
        "await_topo",         # 拓扑门
    ]
)
```

用户回复通过 `Command(resume=user_input)` 注入，不再用 `awaiting_user` 标志。

### 3.5 HITL 规格

#### 3.5.1 三个确认门

| 门   | 位置             | 决策选项                                              | 确认后               | 修订后                                   |
| --- | -------------- | ------------------------------------------------- | ----------------- | ------------------------------------- |
| 方案门 | plan 之后        | confirm / revise / none                           | write\_plan\_node | 回 generate\_plan                      |
| 文案门 | draft\_copy 之后 | confirm / revise / none                           | write\_copy\_node | 回 draft\_copy                         |
| 拓扑门 | split 之后       | confirm\_gen / topo\_revise / node\_revise / none | start\_gen→gen\_scheduler | topo\_revise 或回 confirm\_gate(modify) |

#### 3.5.2 恢复规格（W1 + W5）

| 场景               | 恢复机制                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| 用户刷新页面           | 前端调 `graph.get_state(config)` 读当前 interrupt 节点，渲染对应确认 UI                          |
| agent-runtime 重启 | checkpoint.db 持久化，重启后 `graph.aget_state` 恢复 phase + split\_manifest + user\_brief |
| 出图中断             | 每个 gen\_node 是独立 checkpoint 边界，仅重跑失败节点（详见六-B）                                   |
| 前端 SSE 断开        | 心跳超时 30s 判定不可达（W12），重连后从 checkpoint 恢复                                            |

### 3.6 生成 DAG 规格

#### 3.6.1 拓扑与预排序（W13）

* split 阶段调 `topo_sort_gen_keys`，结果存 `gen_order`

* 环检测在 split 阶段完成，有环直接报错，不进 await\_topo

* gen\_scheduler 读 `gen_order`，不再实时算

#### 3.6.2 故障传播策略（W3）

| 上游状态               | 下游处置               | 可恢复 |
| ------------------ | ------------------ | --- |
| `completed`        | 正常执行               | —   |
| `failed`（硬失败）      | 标记 `failed`，级联     | 否   |
| `needs_user`（软失败）  | 标记 `skipped`       | 是   |
| `fallback_pending` | 标记 `skipped`，等用户确认 | 是   |

#### 3.6.3 并发与恢复

* Send fan-out 由 gen\_scheduler 通过 Command goto 派发，并发度受 `gen_max_concurrency` 约束（默认 3，详见六-B）

* 每个 `gen_node` 是独立 checkpoint 边界

* crash 后从 checkpoint 恢复，已成功节点不重跑

### 3.7 子图分层规格（W6）

```
主图（6 高层节点）:
  START → intake → [confirm_gate_subgraph | chat]
                              ↓
                            split
                              ↓
                    [copy_gate_subgraph | topo_gate_subgraph]
                                          ↓
                                        done → END

confirm_gate_subgraph:
  decide_plan_mode → [revise_manifest?] → generate_plan → compose_confirm
                                      ↓ (interrupt_before)
                                await_confirm
                                      ↓
                            [write_plan_node | 回 generate_plan]

copy_gate_subgraph:
  draft_copy → (interrupt_before) await_copy_confirm → [write_copy_node | 回 draft_copy]

topo_gate_subgraph:
  (interrupt_before) await_topo
      ↓
  [topo_revise | start_gen → gen_scheduler ⇄ gen_node(N) → collect_gen | 回 confirm_gate(modify)]
```

**主图简化目标**：边数从 12 降到 ≤6，高层节点 6 个。

### 3.8 持久化与恢复规格

| 数据                   | 存储                        | 生命周期     | 恢复策略                         | 工作项 |
| -------------------- | ------------------------- | -------- | ---------------------------- | --- |
| LangGraph state      | SqliteSaver checkpoint.db | 跨轮       | crash 后从最近 checkpoint 恢复     | W1  |
| conversation history | AgentMessage 表            | 永久       | 每轮拉取最近 N 条注入 state           | W2  |
| 画布 canvasData        | Session.canvasData        | 永久       | 直接读写；modify 模式走 stage/commit | W8  |
| 生成进度                 | GenProgress 表             | 30 天 TTL | collect\_gen 写入，前端查询         | W15 |
| thread 锁             | ThreadLock 表              | lease 超时 | DB-based lease，进程重启自动释放      | W7  |
| gen\_order           | state 字段                  | 跨轮       | split 阶段预排序，checkpoint 持久化   | W13 |

### 3.9 契约规格（Graph 层相关）

Graph 层涉及的跨服务契约（nest 接口）：

| 契约                                                            | 方向                          | Graph 层用途                | 工作项 |
| ------------------------------------------------------------- | --------------------------- | ------------------------ | --- |
| `listAgentMessages` / `appendAgentMessage`                    | agent-runtime → apps/server | conversation history 持久化 | W2  |
| `stageCanvasActions` / `commitStage` / `rollbackStage`        | agent-runtime → apps/server | 画布操作事务                   | W8  |
| `acquireThreadLock` / `renewThreadLock` / `releaseThreadLock` | agent-runtime → apps/server | thread 并发控制              | W7  |
| `getGenProgress`                                              | agent-runtime → apps/server | 进度查询                     | W15 |
| 出图相关（runImageGeneration 等）                                    | agent-runtime → apps/server | 生成 DAG 执行                | 现有  |

**契约规格原则**：所有接口用 zod（TS）+ pydantic（Python）双 schema 镜像，CI 校验一致（W4）。

***

## 四、设计决策记录（Graph 层）

| ID      | 决策                                         | 理由                                  | 对应原则       |
| ------- | ------------------------------------------ | ----------------------------------- | ---------- |
| **G1**  | 双图模型（控制流图 + 生成 DAG）                        | 控制流需 cycle/HITL，生成需 DAG 拓扑，职责不同     | G-P1       |
| **G2**  | 控制流图用 LangGraph 而非自造 FSM                   | 原生 interrupt/checkpoint/Send，避免重造轮子 | G-P5, G-P7 |
| **G3**  | 生成 DAG 用 Send fan-out 而非节点内并发              | 每个生成任务是独立 checkpoint 边界，crash 可单点恢复 | G-P6, G-P7 |
| **G4**  | State 分层（主图/子图/外置）                         | 避免 state 膨胀，checkpoint 体积可控         | G-P2       |
| **G5**  | brief 独立 channel + 自定义 reducer             | 架构禁止覆盖 > 标志位约定                      | G-P2       |
| **G6**  | phase 降级为可观测标签                             | 消除四字段共决组合爆炸                         | G-P2       |
| **G7**  | HITL 用 interrupt\_before 而非 awaiting\_user | 框架自动管理暂停态，业务只声明位置                   | G-P5       |
| **G8**  | 子图封装三个确认门                                  | 主图复杂度降 60%，单门可独立测试                  | G-P1, G-P3 |
| **G9**  | gen\_order 预排序 + 环检测前移                     | 运行时不再算，split 阶段即可报环                 | G-P1       |
| **G10** | 故障分级传播（硬失败/软失败）                            | 软失败可恢复，避免误级联                        | G-P6       |
| **G11** | 判定节点不用 LLM                                 | 降低成本与不确定性，规则可审计                     | G-P3       |
| **G12** | LLM 节点不直接产生副作用                             | 便于 stage/commit 回滚                  | G-P3       |
| **G13** | 契约 zod+pydantic 双 schema                   | 跨服务类型安全，CI 校验                       | G-P1       |

***

## 五、与实施计划的映射

本规格的每个决策在实施计划中都有对应工作项：

| 规格                                   | 工作项 | Sprint |
| ------------------------------------ | --- | ------ |
| Checkpoint 持久化（G-P7, G2）             | W1  | S1     |
| conversation history DB 权威源          | W2  | S1     |
| 出图 Send fan-out（G3, G10）             | W3  | S2     |
| 契约 zod+pydantic（G13）                 | W4  | S3     |
| phase 降级 + interrupt\_before（G6, G7） | W5  | S2     |
| 子图分层（G8）                             | W6  | S4     |
| thread DB 锁                          | W7  | S3     |
| 画布 stage/commit（G12）                 | W8  | S5     |
| 统一 intent 模块（G11）                    | W9  | S1     |
| plan 节点拆分（G-P3）                      | W10 | S4     |
| 双通道信号统一                              | W11 | S5     |
| 前端 crash 感知                          | W12 | S5     |
| gen\_order 预排序（G9）                   | W13 | S5     |
| brief 不可变 channel（G5）                | W14 | S4     |
| State 瘦身外置（G4）                       | W15 | S3     |

***

## 六-A、W10 实施方案：plan 节点拆分（G-P3）

> 本节为 W10 工作项（plan 节点拆分）的实施规格，与 3.3.1 单一职责矩阵和 3.7 子图结构对齐。

### 6A.1 拆分目标

将 `plan.py`（279 行单体节点）拆为 4 个单一职责节点，对齐 3.3.1 矩阵定义：

| 节点                 | 单一职责                          | 类型  | LLM | 与 spec 3.3.1 对齐 |
| ------------------ | ----------------------------- | --- | --- | --------------- |
| `decide_plan_mode` | create/modify/node\_revise 判定 | 判定  | 否   | ✓               |
| `generate_plan`    | LLM 生成/修改方案                   | LLM | 是   | ✓               |
| `revise_manifest`  | LLM 增量改 manifest              | LLM | 是   | ✓               |
| `compose_confirm`  | 构造确认消息 + phase 决策             | 纯函数 | 否   | ✓               |

### 6A.2 图连线（对齐 spec 3.7 confirm\_gate\_subgraph）

```
decide_plan_mode ──→ generate_plan ──→ revise_manifest ──→ compose_confirm
```

* 全部无条件直连（revise\_manifest 在非 node\_revise 时空穿透返回 `{}`，无需条件路由）

* 不使用 LangGraph 子图（子图丢失中间检查点），保持扁平注册与 W3 Send-API 重构一致

* 通过 `plan/__init__.py` 的 `register_plan_nodes()` 辅助函数封装注册逻辑

### 6A.3 节点接口

| 节点                     | 工厂签名                                          | 读 state                                                                         | 写 state                                                                 |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **decide\_plan\_mode** | `make_decide_plan_mode_node(*, skills_dir)`   | skill\_id, mode, user\_brief, messages, plan\_draft, split\_manifest            | mode, is\_node\_revise                                                  |
| **generate\_plan**     | `make_generate_plan_node(*, llm, skills_dir)` | skill\_id, mode, user\_brief, messages, plan\_draft                             | plan\_draft, plan\_summary                                              |
| **revise\_manifest**   | `make_revise_manifest_node(*, llm)`           | is\_node\_revise, split\_manifest, messages                                     | node\_operations                                                        |
| **compose\_confirm**   | `make_compose_confirm_node(*, skills_dir)`    | is\_node\_revise, plan\_draft, plan\_summary, node\_operations, mode, skill\_id | phase, messages, node\_operations, awaiting\_user, user\_decision, mode |

### 6A.4 route\_after\_plan 简化

```python
# 旧：重复 is_node_revise 判断
def route_after_plan(state):
    if state.get("mode") == "modify" and any(isinstance(it, dict) and it.get("node_id") for it in ...):
        return "write_plan_node"
    return "await_confirm"

# 新：单一事实来源（compose_confirm 已设 phase）
def route_after_plan(state):
    if state.get("phase") == "write_plan_node":
        return "write_plan_node"
    return "await_confirm"
```

### 6A.5 主图连线变更（builder.py）

| 变更项                      | 旧                                                 | 新                                                      |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------ |
| import                   | `from app.graph.nodes.plan import make_plan_node` | `from app.graph.nodes.plan import register_plan_nodes` |
| 节点注册                     | `graph.add_node("plan", make_plan_node(...))`     | `register_plan_nodes(graph, nest, llm, skills_dir)`    |
| route\_after\_intake 目标  | `"plan"`                                          | `"decide_plan_mode"`                                   |
| route\_after\_confirm 目标 | `"plan"`                                          | `"decide_plan_mode"`                                   |
| route\_after\_topo 目标    | `"plan"`                                          | `"decide_plan_mode"`                                   |
| route\_after\_plan 起点    | `"plan"`                                          | `"compose_confirm"`                                    |
| route\_after\_plan 逻辑    | `mode=="modify" and canvas_has_nodes`             | `phase == "write_plan_node"`                           |

### 6A.6 state.py 变更

新增字段：`is_node_revise: bool | None`（由 decide\_plan\_mode 计算，供 revise\_manifest/compose\_confirm/route\_after\_plan 使用）

### 6A.7 文件布局

```
app/graph/nodes/plan/
    __init__.py          # 导出 register_plan_nodes, route_after_plan, build_confirm_message
    _shared.py           # 共享常量和辅助函数（从 plan.py 迁移）
    decide_mode.py       # make_decide_plan_mode_node
    generate_plan.py     # make_generate_plan_node
    revise_manifest.py   # make_revise_manifest_node
    compose_confirm.py   # make_compose_confirm_node

app/graph/nodes/plan.py  # 改为存根：重新导出 + DeprecationWarning
```

### 6A.8 测试影响

| 测试                                                           | 影响                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| test\_plan\_summary.py                                       | 无需修改（plan.py 存根重新导出 build\_confirm\_message）                |
| test\_graph\_plan\_split.py（3 测试）                            | 无需修改（全图 ainvoke，内部拆分透明）                                     |
| test\_await\_topo.py::test\_node\_revise\_full\_flow         | 无需修改（全图 ainvoke，透明）                                         |
| test\_await\_topo.py::test\_node\_revise\_sets\_modify\_mode | `route_after_topo(...) == "plan"` → `== "decide_plan_mode"` |

***

## 六-B、W3 实施方案：orchestrate\_gen → Send API 重构（G-P3, G-P6, G-P7）

> 本节为 W3 工作项（出图编排 Send API 重构）的实施规格，与 3.1 双图模型、3.3.1 单一职责矩阵和 3.6 生成 DAG 规格对齐。

### 6B.1 重构目标

将 `orchestrate_gen.py`（asyncio.Semaphore + asyncio.wait 手动编排）替换为 LangGraph Send API fan-out，对齐 3.1 双图模型中「生成 DAG 用 Send fan-out」的规格决策：

| 节点                | 单一职责                     | 类型  | LLM | 与 spec 3.3.1 对齐        |
| ----------------- | ------------------------ | --- | --- | ---------------------- |
| `start_gen`       | 初始化 W3 生成状态字段            | 纯函数 | 否   | ✓（3.3.1 已有）           |
| `gen_scheduler`   | 中心调度：算 ready → 派发/跳转/等待  | 调度  | 否   | ✓（替代 orchestrate\_gen） |
| `gen_node`        | 单节点出图/出视频               | IO  | 否   | ✓（3.3.1 已有）           |
| `collect_gen`     | 聚合结果 + 桥接遗留字段 + 清理       | 聚合  | 否   | ✓（3.3.1 已有）           |

**核心动机**（对齐 Hard Constraint + Lessons Learned）：

* Generation DAG must use LangGraph Send API → 每个生成任务是独立 checkpoint 边界，crash 后可单点恢复
* Manual orchestration loops → 无法细粒度 checkpoint，崩溃后整段重跑
* 单个失败任务无法独立恢复 → 用户需重头再来

### 6B.2 图连线（对齐 spec 3.6 生成 DAG + 3.7 topo\_gate\_subgraph）

```
start_gen → gen_scheduler ⇄ gen_node → collect_gen → done
                ↑______↓
  (Command goto=[Send("gen_node", ...)] 派发；gen_node 完成后回 gen_scheduler)
```

* `start_gen → gen_scheduler`：普通边，初始化后进入调度循环
* `gen_scheduler → gen_node`：**动态边**，通过 `Command(update=, goto=[Send("gen_node", {"key": k}) ...])` fan-out
* `gen_node → gen_scheduler`：普通边，完成后回到调度器触发下一轮派发
* `gen_scheduler → collect_gen`：**动态边**，全处理完后 `Command(goto=["collect_gen"])`
* Pregel BSP 保证：并行 gen\_node 完成后调度器每超级步只跑一次

**不使用静态边**：gen\_scheduler → gen\_node / gen\_scheduler → collect\_gen 通过 Command goto 动态路由，builder.py 不注册静态边。

### 6B.3 gen\_scheduler 调度算法

```
1. 读累积 state（reducer 合并后的全量 completed/failed/needs_user）
2. 前向拓扑遍历：将 dependency_failed / dependency_skipped 显式标记
3. 算 ready 任务（deps 全 completed、未派发、未完成/失败）
4. 尊重并发上限（in_flight < gen_max_concurrency）
5. 有 ready → Command(update={dispatched_keys += ready}, goto=[Send("gen_node", ...) ...])
6. 无 ready + 有 in_flight → 返回 {} 等待（Pregel 下一超级步再触发）
7. 全处理完 → Command(goto=["collect_gen"])
```

**级联传播**（修复原型验证发现的缺陷）：C 依赖失败的 A 时，C 不在 ready 也不在 in\_flight，调度器必须前向遍历显式标记，否则提前终止丢失 C。

### 6B.4 节点接口

| 节点                  | 工厂签名                                        | 读 state                                                                  | 写 state                                                    |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **start\_gen**      | `make_start_gen_node(*, max_concurrency=3)` | split\_manifest, gen\_ordered\_keys, gen\_deps\_of, gen\_by\_key          | gen\_ordered\_keys, gen\_deps\_of, gen\_by\_key, gen\_\*\_keys=[], gen\_max\_concurrency |
| **gen\_scheduler**  | `make_gen_scheduler_node()`                 | gen\_ordered\_keys, gen\_deps\_of, gen\_\*\_keys, gen\_dispatched\_keys, gen\_max\_concurrency | gen\_dispatched\_keys, gen\_completed\_keys, gen\_failed\_keys, gen\_needs\_user\_keys, gen\_fail\_details |
| **gen\_node**       | `make_gen_node(*, nest)`                    | key（来自 Send payload）, gen\_by\_key                                      | gen\_completed\_keys / gen\_failed\_keys / gen\_needs\_user\_keys, gen\_fail\_details |
| **collect\_gen**    | `make_collect\_gen_node(*, nest)`            | gen\_fail\_details, gen\_completed\_keys, gen\_failed\_keys               | gen\_completed, gen\_failed, gen\_dispatched\_keys=None, gen\_fail\_details=None |

### 6B.5 Reducer（state.py，并行 Send 更新必需）

多个 gen\_node 在同一超级步并行写入时，LangGraph 要求 reducer 合并，否则报 `InvalidUpdateError`：

| 字段                      | reducer              | 用途                           |
| ----------------------- | -------------------- | ---------------------------- |
| gen\_completed\_keys    | `reset_or_union`     | 合并去重保序；None 重置（start\_gen/collect\_gen） |
| gen\_failed\_keys       | `reset_or_union`     | 同上                           |
| gen\_needs\_user\_keys  | `reset_or_union`     | 同上                           |
| gen\_dispatched\_keys   | `reset_or_union`     | 同上                           |
| gen\_fail\_details      | `reset_or_merge`     | 浅合并 right 优先；None 重置         |

```python
def reset_or_union(left: list[str] | None, right: list[str] | None) -> list[str] | None:
    """合并去重保序；None 重置（新 run 开始时清除上轮残留）。"""
    if right is None:
        return None
    out, seen = [], set()
    for k in [*(left or []), *(right or [])]:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out

def reset_or_merge(left: dict | None, right: dict | None) -> dict | None:
    """浅合并；None 重置。"""
    if right is None:
        return None
    return {**(left or {}), **(right or {})}
```

### 6B.6 主图连线变更（builder.py）

| 变更项                  | 旧                                             | 新                                                  |
| -------------------- | -------------------------------------------- | -------------------------------------------------- |
| import               | `from app.graph.nodes.orchestrate_gen import ...` | `from app.graph.nodes.gen_scheduler import ...`    |
| 节点注册                 | `graph.add_node("orchestrate_gen", ...)`     | `graph.add_node("gen_scheduler", make_gen_scheduler_node())` |
| start\_gen 下游        | `start_gen → orchestrate_gen`                | `start_gen → gen_scheduler`                        |
| gen\_node 下游         | 无（orchestrate\_gen 内部并发）                     | `gen_node → gen_scheduler`                         |
| orchestrate\_gen 下游  | `orchestrate_gen → done`                     | 删除（gen\_scheduler → collect\_gen 走 Command goto 动态） |
| orchestrate\_gen.py  | 活跃节点                                         | **保留不删**（runs.py 仍 import），仅取消注册 + 弃用注释            |

**gen\_scheduler → gen\_node 和 gen\_scheduler → collect\_gen 无静态边**：通过 Command goto 动态路由。

### 6B.7 state.py 变更

| 字段                     | 类型                        | reducer           | 说明                              |
| ---------------------- | ------------------------- | ----------------- | ------------------------------- |
| gen\_ordered\_keys     | `list[str] \| None`       | 覆盖                | 拓扑序（start\_gen 写，collect\_gen 清） |
| gen\_deps\_of          | `dict[str, list[str]] \| None` | 覆盖                | 依赖图                             |
| gen\_by\_key           | `dict[str, dict] \| None` | 覆盖                | Manifest items by key           |
| gen\_completed\_keys   | `list[str] \| None`       | `reset_or_union`  | 已完成 key 列表                      |
| gen\_failed\_keys      | `list[str] \| None`       | `reset_or_union`  | 已失败 key 列表                      |
| gen\_needs\_user\_keys | `list[str] \| None`       | `reset_or_union`  | 需用户介入 key 列表                    |
| gen\_dispatched\_keys  | `list[str] \| None`       | `reset_or_union`  | 已派发 key 列表（防重复派发）               |
| gen\_fail\_details     | `dict[str, dict] \| None` | `reset_or_merge`  | key→{node\_id, title, reason}   |
| gen\_max\_concurrency  | `int \| None`             | 覆盖                | 并发上限（默认 3）                      |

**遗留字段保留**：`gen_queue` / `gen_completed` / `gen_failed` 仍存于 state（done.py/intake.py 仍读），collect\_gen 负责桥接。

### 6B.8 故障分级传播（对齐 spec 3.6.2）

| 上游状态                | 下游处置                | gen\_fail\_details reason | 可恢复 |
| ------------------- | ------------------- | ------------------------ | --- |
| `completed`         | 正常执行                | —                        | —   |
| `failed`（硬失败）       | 标记 `dependency_failed` | `dependency_failed`       | 否   |
| `needs_user`（软失败）   | 标记 `dependency_skipped` | `dependency_skipped`      | 是   |
| `fallback_pending`  | 标记 `dependency_skipped` | `dependency_skipped`      | 是   |

**级联传播**由 gen\_scheduler 在每轮调度前做前向拓扑遍历，确保不遗漏被上游失败波及的下游节点。

### 6B.9 文件布局

```
app/graph/nodes/
    gen_scheduler.py    # 新建：中心调度器
    gen_node.py         # 改造：纯 dict 返回（移除 list[Send] + 下游 fan-out）
    start_gen.py        # 重写：写 W3 字段
    collect_gen.py      # 改造：读 details + 桥接遗留字段 + 清理
    orchestrate_gen.py  # 保留不删：runs.py 仍 import，仅弃用注释

app/graph/state.py      # 新增 9 个 W3 字段 + 2 个 reducer

app/graph/builder.py    # 切换边 + 注册 gen_scheduler
```

### 6B.10 测试

| 测试文件                                       | 用例数 | 说明                                                  |
| ------------------------------------------ | --- | --------------------------------------------------- |
| test\_gen\_scheduler.py（新建）                | 8   | dispatch\_ready / concurrency / waits\_in\_flight / goto\_collect / cascade\_failed / cascade\_skipped / diamond\_no\_deadlock / transitive\_cascade |
| test\_gen\_node.py（新建）                     | 8   | success / missing\_node\_id / hard\_fail / soft\_error / fallback\_no\_chat / retry / video / chain\_refs |
| test\_orchestrate\_gen.py（迁移）              | 9   | 迁移为子图 ainvoke（start\_gen→gen\_scheduler⇄gen\_node→collect\_gen + MemorySaver），断言改读 final state |
| test\_route\_entry\_copy\_gate.py（修断言）      | 1   | `== "orchestrate_gen"` → `== "start_gen"`           |
| test\_await\_topo.py（修断言）                  | 1   | 断言改 W3 字段                                           |

**递归限制**：ainvoke config 设 `recursion_limit=100`（默认 25 对长链不够）。

### 6B.11 回滚策略

重构隔离在 builder 边切换 + 4 节点文件 + state reducer + 新 gen\_scheduler。回滚 = 还原 builder.py 边（`start_gen→orchestrate_gen→done`）+ 还原文件。orchestrate\_gen.py 保留不删，回滚只需重接线，功能即可恢复。

***

## 六、规格验收标准（Graph 层）

Graph 层规格落地后，应满足以下可验证标准：

| 编号      | 验收标准                                                           | 验证方式                   |
| ------- | -------------------------------------------------------------- | ---------------------- |
| **V1**  | 主图 state 字段数 ≤18                                               | `grep -c ":" state.py` |
| **V2**  | 主图边数 ≤6                                                        | builder.py 高层边计数       |
| **V3**  | `awaiting_user` / `pending_orchestrate` / `brief_locked` 字段不存在 | state.py grep          |
| **V4**  | HITL 暂停后刷新页面，能恢复到原 interrupt 节点                                | 端到端测试                  |
| **V5**  | 出图 crash 后重启，已成功节点不重跑                                          | 端到端测试                  |
| **V6**  | split 阶段 manifest 有环，返回明确错误                                    | 单元测试                   |
| **V7**  | `user_brief` 二次写入被拒绝                                           | 单元测试                   |
| **V8**  | 三个子图能独立 pytest                                                 | 测试运行                   |
| **V9**  | 契约 zod/pydantic CI 校验通过                                        | CI job                 |
| **V10** | 单节点失败不阻断其他节点，故障分类正确                                            | 集成测试                   |

***

## 七、未覆盖的层（明确边界）

本规格**不涉及**以下层的设计，需独立文档定义：

| 层                             | 文档 ID | 示例职责                                      | 本项目现状                                        | 预计设计时机        |
| ----------------------------- | ----- | ----------------------------------------- | -------------------------------------------- | ------------- |
| **Loop Engineering**          | L1    | 迭代循环设计、终止策略、错误处理、self-healing             | 出图编排有部分实现（W3），但无独立设计文档                       | S2 后，与 W3 同步  |
| **Context Engineering**       | C1    | RAG 检索策略、history 裁剪规则、tool description 措辞 | history 裁剪见 W2，RAG 暂未用                       | S3 后，依赖 W2    |
| **Prompt Engineering**        | P1    | plan/split/draft\_copy 节点的 prompt 模板      | 现有 prompt 见各节点文件，需独立审计                       | S4 后，依赖 C1    |
| **Harness Engineering**       | H1    | 沙箱、权限、工具实现、部署架构                           | nest 接口实现属此层，已有部分实现                          | S5 后，依赖 G1+L1 |
| **Observability Engineering** | O1    | Trace、Metrics、Logs、告警、调试                  | 现有 `task_update`/`task_summary` 事件，无完整可观测性设计 | S6 后，依赖 H1    |

### 7.1 各层文档的衔接关系图

```
业务 PRD
    ↓
G1: Graph Engineering 产品规格（本文档）
    ├─→ L1: Loop Engineering 产品规格（设计出图编排迭代策略）
    │      └─ 对接点：G-P6（故障分级传播）、W3（出图编排恢复）
    │
    ├─→ C1: Context Engineering 产品规格（设计 history 裁剪、tool desc 措辞）
    │      └─ 对接点：W2（conversation history 持久化）、G-P3（Node 单一职责）
    │
    ├─→ H1: Harness Engineering 产品规格（设计工具实现、沙箱、权限）
    │      └─ 对接点：W4（nest 接口 schema）、W7（thread DB 锁）、W8（画布事务）
    │
    └─→ O1: Observability Engineering 产品规格（设计 trace/metrics/logs）
           └─ 对接点：W11（双通道信号统一）、W12（前端 crash 感知）

C1 → P1: Prompt Engineering 产品规格（设计各节点 prompt 模板）
      └─ 对接点：G-P3（Node 单一职责）、W10（plan 节点拆分）
```

### 7.2 各层文档的章节模板

为确保可阅读性，各层文档应遵循统一模板：

```markdown
# X Engineering 层产品规格文档

| 字段 | 值 |
|---|---|
| 文档版本 | v1.0 |
| 创建日期 | YYYY-MM-DD |
| 文档定位 | X Engineering 层的设计规格 |
| 关联文档 | G1（Graph Engineering）、I1（实施计划） |
| 方法论来源 | 业界最佳实践引用 |

## 一、层定位与边界
### 1.1 在工程栈中的位置（引用 G1 第一章）
### 1.2 本层职责
### 1.3 与其他层的关系（衔接点）

## 二、设计方法论
### 2.1 业界最佳实践
### 2.2 设计原则（编号：X-P1, X-P2...）

## 三、本项目产品规格
### 3.1 具体设计决策（引用 G1 的工作项）
### 3.2 验收标准

## 四、设计决策记录
| ID | 决策 | 理由 | 对应原则 | 衔接 G1 决策 |

## 五、与实施计划的映射
| 规格 | 工作项 | Sprint |

## 六、验收标准
| 编号 | 验收标准 | 验证方式 |

## 七、未覆盖的层
（链接其他层文档）
```

### 7.3 本项目文档体系演进路线

| 阶段        | 完成文档    | 覆盖层                       | 状态    |
| --------- | ------- | ------------------------- | ----- |
| **S1-S2** | G1 + I1 | Graph Engineering + 实施计划  | ✅ 已完成 |
| **S2**    | L1      | Loop Engineering          | ✅ 已完成 |
| **S3**    | C1      | Context Engineering       | ✅ 已完成 |
| **S4**    | P1      | Prompt Engineering        | ✅ 已完成 |
| **S5**    | H1      | Harness Engineering       | ✅ 已完成 |
| **S6**    | O1      | Observability Engineering | ✅ 已完成 |

**文档体系完成度**：✅ 六层工程栈产品规格文档已全部完成（2026-07-26）。

**新增工作项汇总**（需补充到实施计划）：

| 工作项 | 来源文档 | Sprint | 内容                  |
| --- | ---- | ------ | ------------------- |
| W16 | L1   | S3     | 降级路径实现              |
| W17 | C1   | S3     | History 裁剪策略        |
| W18 | C1   | S4     | Context snapshot 存储 |
| W19 | P1   | S4     | Prompt 版本管理         |
| W20 | P1   | S4     | Few-shot 示例设计       |
| W21 | H1   | S5     | 工具超时与熔断             |
| W22 | H1   | S5     | 错误处理标准化             |
| W23 | O1   | S6     | Trace 集成            |
| W24 | O1   | S6     | Metrics 集成          |
| W25 | O1   | S6     | 告警规则                |
| W26 | O1   | S6     | Dashboard 搭建        |
| W27 | O1   | S6     | 状态回放接口              |

**下一步建议**：

1. 将新增工作项（W16-W27）补充到实施计划
2. 按 Sprint 顺序执行实施计划
3. 每个 Sprint 结束后对照各层文档的验收标准评估

***

## 八、文档维护

* 本规格是 Graph 层的**稳定设计文档**，变更需走 ADR（Architecture Decision Record）流程

* 实施计划（agent-graph-engineering-refactor.md）可随 Sprint 调整，但不得违反本规格的决策

* 每个 Sprint 结束后，对照"六、规格验收标准"评估符合度

