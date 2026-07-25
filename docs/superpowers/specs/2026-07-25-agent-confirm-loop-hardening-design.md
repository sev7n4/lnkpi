# Agent 确认后闭环加固 + 主文案 HITL（设计）

> 状态：**已确认**（2026-07-25）  
> 日期：2026-07-25  
> 前置：  
> - `2026-07-23-agent-runtime-langgraph-design.md`（Runtime / 轻量 HITL / 画布 SoT）  
> - `2026-07-24-agent-chat-ux-phase1-design.md`（对话 UX / Vercel SSE ~120s）  
> - `2026-07-25-agent-task-progress-card-design.md`（任务卡 / `task_*` / 自动出视频）  
> 依据：生产干净画布复测（PR #58 + Runtime rebuild）后问题清单 1–6；产品确认主文案 **先草稿交互确认再写入节点**，出图不等文案  
> 范围：主文案 HITL 编排、任务卡断流关账、画布 url/content 同步、方案节点开场白清洗、**LangGraph 节点与边可持续演进专篇**  
> 非范围：`task_summary` 落库（方案 B，复测仍丢再加）、卡内一键重试/确认平台、生产级 durable `interrupt()` 跨天恢复、改 Vercel SSE 硬超时本身、Agent dock 模型/技能计费

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 总体策略 | **方案 A**：编排补齐 + 断流对账；摘要落库留作复测后加码 |
| 主文案 | **不**在「确认拆图」后静默写入；`draft_copy` → 对话确认/修改 → `write_copy_node` |
| 出图 vs 文案 | **并行**：`split` 后出图/出视频照常；文案 HITL **不阻塞**出图 |
| 任务卡主文案行 | 草稿待确认期间 = `needs_user`；写入成功 = `done` |
| 任务清单 | split **一次**发全量项；orchestrate **禁止整表替换**冲掉文案项 |
| 断流关账 | SSE 优先；断流后用 Session 节点态（+ Record）reconcile，合成终局 `task_summary` 态 |
| 画布有图 | 确认拆图→关账期间周期性 `loadSession`（服务端 url/content 优先）；禁过期全量 `saveCanvas` 抹结果 |
| 方案节点 | 写入前剥开场白；**不**改为「先聊后写方案节点」（与既有确认拆图习惯对齐） |
| Graph 演进 | **专篇 §7**：控制流边 vs 数据流边、门控相位、并行扇出、可插槽 `interrupt()` |

---

## 1. 问题与目标

### 1.1 生产复测问题（1–6）

| # | 现象 | 根因摘要 |
| --- | --- | --- |
| 1 | 主文案无正文、卡上无该项 | `auto_generate:false` + orchestrate 二次 `task_list` 整表覆盖 |
| 2 | 左侧任务 vs Agent 卡不同步 | 左栏轮询 Record；卡只吃 SSE，断流后不对账 |
| 3 | 详情有图、多数节点无预览 | 断流后不续拉 Session；本地 `saveCanvas` 可盖掉 Nest 已写 url |
| 4 | 方案节点含「好的，我将…」 | `plan` 原样 upsert LLM 全文 |
| 5 | 任务卡一直卡住 | 未收到 `task_summary`，`finished` 永不 true |
| 6 | 无终局摘要与下一步建议 | `task_summary` 仅 SSE、断流丢失 |

### 1.2 成功标准

1. 确认拆图后任务卡含 **9 项**（含主文案）；出图并行推进。  
2. 对话出现主文案**草稿** +「写入主文案 / 要修改」；用户确认后节点 `content` 才有正文。  
3. SSE 断流后任务卡仍能关账，出现「本轮执行结果」+ 建议行（合成亦可）。  
4. 左侧任务成功且详情有 url 时，对应 image 节点可见预览。  
5. 「营销方案」节点正文从 Markdown `#` 标题起，无寒暄开场白。  
6. Graph 节点/边约定见 §7，后续加审批门 / durable HITL 不推翻拓扑语义。

---

## 2. 主文案 HITL（修订后的产品流）

### 2.1 用户旅程

```text
用户要方案
  → plan：对话摘要 + 营销方案节点（已清洗）
  → await_confirm：「确认拆图 / 要修改」
用户确认拆图
  → split：9 骨架（主文案仅 prompt，content 空）
  → 并行：
       A. orchestrate_gen（image/video）→ 任务卡更新 →（终局摘要，可断流后合成）
       B. draft_copy：对话展示主文案草稿 → END 本 turn
           phase=await_copy_confirm，主文案任务行=needs_user
用户下一轮：确认写入 / 说明修改
  → await_copy_confirm
       confirm → write_copy_node → 主文案 done
       revise  → draft_copy → 再 await
       none    → 提示，保持 await
```

交互对标：与「确认后再写设计文档供审阅」相同——**成果落库前必须有一轮可调节的确认**。

### 2.2 与旧「自动生成正文」的差异

| 旧设想（已否决） | 本规格 |
| --- | --- |
| 确认拆图后 `run_text_generation` 静默写 `content` | 先草稿进对话，确认后再写 |
| 文案与出图同一 `orchestrate_gen` 队列 | 文案走独立门控相位；出图队列不含强制写文案 |
| 卡上主文案 `running→done` | 卡上主文案 `needs_user→done`（或 revise 循环） |

### 2.3 Nest / Runtime 职责

| 能力 | 负责方 | 说明 |
| --- | --- | --- |
| 草稿生成 | Runtime `draft_copy` | 用规划 LLM + plan/skill 上下文；结果进 State `copy_draft` + `text_delta` / 芯片 |
| 写入节点 | Nest `run-text-generation` **或** 轻量 `set-node-content` | 仅在用户确认后调用；写 `data.content` + `status=completed` |
| 修改轮 | Runtime `draft_copy` | 用户修改意见进 HumanMessage，覆盖 `copy_draft` |

一期可用「确认后直接把 `copy_draft` 写入节点」的 internal API，不必强行走 Studio 计费文生若产品未要求；若需与左栏文本模型/积分一致，则走 `studio.generateText` 路径（实现计划阶段二选一，默认：**确认写入 = 落已审草稿**，避免二次计费）。

**默认决策（本规格）：** `write_copy_node` = 将已确认的 `copy_draft` 持久化到节点；**不**在确认瞬间再调一次生成 API。用户点「要修改」才重新 `draft_copy`。

### 2.4 任务卡与确认芯片

- `task_list` 含 `copy_main`（kind=text）。  
- `draft_copy` 结束：`task_update(copy_main, needs_user, errorHint=请确认主文案后写入)`。  
- 芯片：「写入主文案」「要修改」（可复用现有 confirm/revise 芯片样式，文案区分于「确认拆图」）。  
- `write_copy_node` 成功：`task_update(copy_main, done)`。

---

## 3. 任务清单稳定

1. `split` 成功后 **emit 一次**全量 `task_list`（manifest 全项，含 text）。  
2. `orchestrate_gen` **不得**再发整表 `task_list`；只用 `task_update`。  
3. 若实现失误需重发：必须 **按 id merge**，禁止删除已有项、禁止无故重置 `done/needs_user`。

修正既有任务卡规格中「text 可 skipped 或不入卡」：主文案 **入卡**，待确认 = `needs_user`，不是 `skipped`。

---

## 4. 断流关账 + 终局摘要（修 2/5/6）

### 4.1 原则

- 运行中仍以 SSE `task_*` 为准。  
- Vercel ~120s 断流后 Runtime 可继续；前端必须 **对账关账**，不能永久「进行中」。  
- 本轮 **不**要求 `task_summary` 落库；合成摘要可接受。落库列为复测加码（方案 B）。

### 4.2 对账输入与映射

| 节点观察 | 任务项状态 |
| --- | --- |
| image/video `completed` + url | `done` |
| `generating` | `running` |
| `fallback_pending` / 积分类错误 | `needs_user` + 既有 hint 表 |
| `error` / failed | `failed` |
| text：`content` 非空且已确认写入 | `done` |
| text：仍有 `copy_draft` 待确认 / content 空且 phase 文案门 | `needs_user` |
| 无结果且非 generating | `pending` 或保持上次 |

### 4.3 关账条件（满足其一）

1. 收到 SSE `task_summary`；或  
2. Agent 流结束且卡内无 `running|pending|retrying`（`needs_user` **不阻塞**出图关账，见下）；或  
3. 流结束后轮询（建议 4s，最多 ~15 次）无 `generating` 节点，则按 §4.2 合成 summary 并 `finished=true`。

**关账与文案 HITL：** 出图/出视频子集可先关账展示「本轮执行结果（生成）」；若主文案仍 `needs_user`，底栏保留「主文案待你确认写入」一行，**不**把整卡打回「进行中」。标题策略：

- 仍有 image/video `running` →「正在按方案拆解并出图」  
- 生成侧已终局、文案仍待确认 →「本轮执行结果」+ 文案待处理提示  
- 全部终局（含文案 done/failed）→ 完整合计

### 4.4 与左侧任务栏

左侧继续轮询 GenerationRecord；Agent 卡对账后语义对齐「成功/需处理」，允许短暂延迟（≤一轮 poll）。

---

## 5. 画布图 / 正文同步（修 3）

1. 自确认拆图起至任务卡 `finished`（生成侧）：`CanvasPage` **周期性 `loadSession`**，合并规则：**服务端 `url` / `content` / `status` / `generationRecordId` 优先于本地空值或过期 generating**。  
2. Agent `canvas_action` 应用路径避免用陈旧本地图 **全量 `saveCanvas`** 覆盖 Nest；必要保存时做字段级 merge（已有 url 不被空覆盖）。  
3. 对已有 `generationRecordId` 且本地无 url 的节点：允许 generation poll 回填（放宽「draft 不应用 poll」门禁中的这一支）。

---

## 6. 方案节点清洗（修 4）

`plan` → `upsert_prompt_node` 前：

1. Prompt 约束：只输出方案 Markdown，禁止寒暄。  
2. 后处理：去掉开场白；优先从第一个 `#` 标题截取正文。  
3. 对话确认摘要仍用 `build_confirm_message`，**不**进节点。

**不在本期**把「营销方案」改为先对话确认再写入节点（避免与确认拆图双重门叠床架屋）。若未来要做，走 §7.5 插槽「资产写入门」，与主文案门同型。

---

## 7. LangGraph 节点与边专篇（可持续迭代）

> 本章是后续演进的契约：改实现可以，但**不要破坏**「控制流边 vs 数据流边」「门控必须 END 本 turn」「扇出不阻塞」三条。

### 7.1 两条边，不要混

| 种类 | 存在位置 | 含义 | 禁止 |
| --- | --- | --- | --- |
| **控制流边** | LangGraph `add_edge` / 条件路由 | 阶段迁移：规划 → 确认 → 拆解 → 生成 / 文案门 | 用控制流边表达「主图依赖白底」 |
| **数据流边** | Nest `canvasData.edges` + RefChip | 资产依赖、出图拓扑、用户可见连线 | 把完整 nodes/edges 镜像进 Graph State |

LangGraph State **只**持：phase、门控标志、plan 摘要、manifest 轻量项、`copy_draft`、gen 进度 id 列表等。画布真相源永远是 Nest。

### 7.2 相位（phase）与入口路由

现行与本期新增：

| phase | 含义 | `route_entry` |
| --- | --- | --- |
| `intake` | 意图/技能门控 | 默认入口 |
| `plan` | 写方案 | intake → plan |
| `await_confirm` | 等确认拆图/修改方案 | `awaiting_user && phase==await_confirm` |
| `split` | 拆骨架 | confirm → split |
| `orchestrate_gen` | 自动出图/出视频 | split 后 |
| `draft_copy` | 生成主文案草稿（可短时） | split 扇出 |
| `await_copy_confirm` | 等确认写入/修改文案 | **新增**入口优先于 intake |
| `write_copy_node` | 落库主文案 | copy confirm → |
| `done` / `error` | 收尾 | → END |

**入口路由优先级（建议）：**

```text
if awaiting_user and phase == await_copy_confirm → await_copy_confirm
elif awaiting_user and phase == await_confirm → await_confirm
else → intake
```

新增门控时：**只加 phase + route_entry 分支 + 对称节点**，不要把等待逻辑塞进 `orchestrate_gen` 长循环。

### 7.3 目标拓扑（本期选定）

**入口与门控：**

```text
START → route_entry
          ├─ await_copy_confirm → confirm → write_copy_node → END
          │                    → revise  → draft_copy → (重新置 await_copy_confirm) → END
          │                    → none    → END（保持门）
          ├─ await_confirm      → confirm → split → …
          │                    → revise  → plan → await_confirm
          │                    → none    → END
          └─ intake → chat → END
                   → plan → await_confirm → …
```

**确认拆图后主链（本期落地边，线性但语义并行）：**

```text
split → draft_copy → orchestrate_gen → done → END
```

| 节点 | 同 run 内必须完成 | 留给下一 turn |
| --- | --- | --- |
| `split` | 骨架 + 一次 `task_list` | — |
| `draft_copy` | 出草稿、`text_delta`/芯片、`task_update(needs_user)`；置 `phase=await_copy_confirm` 且 `awaiting_user=true` | 用户确认/修改 |
| `orchestrate_gen` | 出图/出视频 + `task_update` + 尽量发 `task_summary` | 断流后由前端对账 |
| `done` | 收尾；**不得清除**文案门的 `awaiting_user` / `phase=await_copy_confirm` | 下一消息进 `await_copy_confirm` |

**「并行」含义（产品）：** 用户在出图进行中或结束后，随时可用下一轮消息确认/修改主文案；出图不因文案未写入而暂停。  
**「并行」含义（实现本期）：** 不要求 LangGraph Send 扇出；`draft_copy` 必须排在长时间 `orchestrate_gen` **之前**，保证草稿先达用户。真正的图级扇出列为 §7.5 性能插槽，不得改变 phase 契约。

**硬约束：**

1. **禁止**在 `orchestrate_gen` 内同步等待用户。  
2. `done` / checkpoint 持久化后，文案门相位必须仍可被 `route_entry` 命中（单测必覆盖）。  
3. 若发现 `done` 误清 `awaiting_user`：改为在 thread 元数据备份 `phase`，或 `draft_copy` 后先 END、出图改 Nest 后台作业——属实现修复，不改本章语义。
### 7.4 门控节点模式（可复制）

所有人机门遵循同一模式（已有 `await_confirm`，文案门照抄）：

```text
GateNode(state):
  分类用户决策 → confirm | revise | none
  confirm → 下游写副作用节点 / 下一阶段
  revise  → 回到生产节点（plan 或 draft_copy）
  none    → 提示 + 保持 awaiting + END
```

**硬约束：** Gate 不得假设 HTTP SSE 仍连接；副作用写 Nest 必须可在**新 turn**执行。

### 7.5 演进插槽（二期+，本规格只占位）

| 插槽 | 用法 | 与本期关系 |
| --- | --- | --- |
| `await_asset_write` 通用门 | 任意「草稿 → 确认 → 写入节点」 | 主文案是第一个实例 |
| `interrupt()` + 持久 checkpointer | 跨进程/跨天恢复 | 不替换轻量 Gate 语义，只换持久层 |
| 审批门 `await_approval` | 企业角色审批方案 | 插在 `plan` 与 `await_confirm` 之间 |
| 并行 Send 扇出 | 多资产独立子图 | 不改变数据流在 Nest 的事实 |
| `task_summary` 落库 | 断流必达摘要 | 方案 B，复测加码 |

演进时优先 **加节点加 phase**，避免在 `orchestrate_gen` 增加隐藏状态机。

### 7.6 反模式清单

1. 在长耗时生成循环里同步等用户输入。  
2. 用第二次 `task_list` 整表覆盖丢掉 HITL 项。  
3. 把 canvas 全量 nodes 塞进 LangGraph State。  
4. 用控制流边表达 Ref/依赖（依赖只在 Nest edges + manifest `depends_on`）。  
5. 门控成功却不清理或错误清理 `awaiting_user`，导致下一轮误路由。  
6. 本地 `saveCanvas` 用空 url 覆盖 Nest 已完成结果。

---

## 8. 事件与前端

### 8.1 SSE（沿用 + 约定）

| 事件 | 本期约定 |
| --- | --- |
| `task_list` | 仅 split 后一次全量 |
| `task_update` | 出图进度 + 文案 needs_user/done |
| `task_summary` | orchestrate 结束时发；前端断流则合成 |
| `text_delta` | 草稿正文 + 进度短句；确认芯片不依赖 Markdown |

### 8.2 前端

- `applyTaskEvent`：禁止无 merge 的整表重置误用。  
- `AgentSideRail`：流结束 / 定时 reconcile（§4）。  
- `CanvasPage`：loadSession 合并（§5）。  
- 文案芯片发送「确认写入主文案」/「要修改：…」类消息，供 `await_copy_confirm` 分类（可复用 classify，扩展关键词）。

---

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 同 run 出图导致 120s 内看不到终局 | §4 对账合成摘要 |
| checkpoint 在 done 后丢失文案门 | 单测 + thread 元数据备份 phase |
| 用户从未确认文案 | 卡上长期 needs_user；不阻塞出图关账 |
| 草稿与节点 prompt 不一致 | 写入时同时可选刷新 prompt 摘要字段（实现计划定） |

---

## 10. 修订关系

| 文档 | 修订点 |
| --- | --- |
| `2026-07-25-agent-task-progress-card-design.md` | 主文案入卡且待确认为 `needs_user`；生命周期含文案门；禁止 orchestrate 整表 task_list |
| `2026-07-23-agent-runtime-langgraph-design.md` | 增补 phase / 文案 HITL 指针 → 本文 §7 |
| 本文 | 确认后闭环加固的主规格 |

---

## 11. 验收清单（干净画布）

- [ ] 确认拆图后卡上 9 项含主文案（needs_user）  
- [ ] 对话有主文案草稿与写入/修改芯片  
- [ ] 确认写入后节点 content 有正文；修改可重出草稿  
- [ ] 出图不因文案未确认而停  
- [ ] 断流后卡可关账并有摘要/建议（合成可）  
- [ ] 成功出图节点可见预览（与详情一致）  
- [ ] 营销方案节点无寒暄开场白  
- [ ] 左栏任务与 Agent 卡终态大体一致  

---

## 12. 开放实现细节（计划阶段拍板，不阻塞本规格审阅）

1. `write_copy_node`：纯落库草稿 vs 再走 Studio 文本生成（**规格默认：纯落库**）。  
2. `draft_copy` 与 `orchestrate_gen` 同 run 顺序（**规格默认：draft_copy 先，再 orchestrate_gen**）。  
3. 文案门 classify 关键词表与方案确认门是否共用函数（建议共用 + 场景参数）。
