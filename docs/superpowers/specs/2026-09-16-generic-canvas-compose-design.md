# 通用画布构图器

> 日期：2026-09-16  
> 状态：**已批准**（对话锁定 §1–§4 + 2026-09-16 评审补丁）  
> 产品：超创平台（lnkpi）无限画布 / Agent 侧栏  
> 相关：  
> - [2026-09-15-workflow-recipe-planner-design.md](./2026-09-15-workflow-recipe-planner-design.md)（本文 **P0 覆盖**其 §14.5 Agent 认亲路由与确认 instantiate）  
> - [2026-09-16-planner-confirm-instantiate-gate-design.md](./2026-09-16-planner-confirm-instantiate-gate-design.md)（确认 chip 短路机制复用；落盘目标改为 composition dump）  
> - [2026-09-12-agent-import-workflow-design.md](./2026-09-12-agent-import-workflow-design.md)  
> - [2026-09-12-workflow-import-placement-design.md](./2026-09-12-workflow-import-placement-design.md)  
> - [2026-09-12-canvas-workflow-exchange-design.md](./2026-09-12-canvas-workflow-exchange-design.md)  
> - [2026-09-17-composition-land-production-gaps.md](./2026-09-17-composition-land-production-gaps.md)（生产换装 HITL 问题清单；**不**改本文已批准决策）

## 0. 决策摘要

| # | 决策 |
|---|------|
| **G1** | 无名结构意图 → **通用构图**（原语 → 编译器展开 → HITL → `import_workflow`）。**不是**第 5 份配方 JSON，也不是模型手搭边表。 |
| **G2** | 实现路径：构图 IR → `@lnkpi/shared` + Nest 编译成剥媒体的 `lnkpi.workflow` dump → 确认后 **只 import 该 dump**，禁止再 compile。 |
| **G3** | 模型不写拓扑。服务端抽 `primitives`；模型最多填 `copy`（标题/提示词槽/P 槽）。工具入参 **禁止** primitives、dump、边。 |
| **G4** | 抽取序：用户指派 > 规则 > 模型填 copy > 识图（P1）。识图不得改「谁是模特/服装」。 |
| **G5** | 换装特化 **只**在「身份 + ≥1 服装」时插入清晰白底三视图 I0 并按件扇出 A/B。P + 单 V 走通用「要视频」。 |
| **G6** | I0：用户明确「已是清晰白底三/四视图」→ I0≡I1、不建空壳；否则 **一律建 I0**。识图判定 P1。 |
| **G7** | P 为槽位+渲染的可编辑文案，**不进生成队列**。V 生成时读 P **当前**正文。P 空则拒跑 V。 |
| **G8** | Agent P0 **不**靠说模板名加载。平台模板唯一加载入口 = 运营发布页一键（P1）。「我的」仅本人页面一键（P1）。 |
| **G9** | P0 Explore **解绑** `match_workflow_templates` / `preview_workflow_template` / `instantiate_workflow_template` / `promote_workflow_template`。确认 chip **永不** instantiate。 |
| **G10** | 四套内置配方（电商 / 角色三视图 / 分镜成片 / 图生视频）**下线认亲**。已落画布节点当普通图保留。 |
| **G11** | 非空画布默认 **叠加**（现有 import 合并+避障）。确认卡声明保留 N、新增 M。运行组 = 本次生成类新增节点。 |
| **G12** | 确认 SSOT = 会话 `compositionPreview { dump, hash, primitives, ts }`；HITL kwargs 只带 `kind+hash`。同 hash 确认 **幂等**；新 hash 才叠加。 |
| **G13** | L0：`composition_confirm` → `composition_structure` 压过 img2img / product_visual / ref-backed generate / orch_ambiguous。 |
| **G14** | 结构意图本轮 **确定性预览**（不赌模型点工具）。copy 润色超时则骨架仍出 chip。 |
| **G15** | 抽不全：`pending_composition_extract` 续跑，不要求用户再说一遍「设计工作流」。 |
| **G16** | 本文 P0 **覆盖**规划器规格 §14.5 的 Agent 认亲与确认 instantiate。规划 Nest API 可留；Agent 默认路径以本文为准。 |

### 0.1 切片

| 切片 | 做 | 不做 |
|------|----|------|
| **P0（本文实现）** | 构图 E2E、L0+Explore 路由、确认门、运行组、下线四套认亲、金标 eval | 运营 CMS、模板市场页、Agent 点名加载、审核队列、Nest 独立 preview 缓存服务 |
| **P1** | 运营页一键、我的模板页、提交审核、状态机落地 | 社区分成、跨账号市场 |

第一份换装模板：金标在预发/生产跑通后由 **运营发布** 构图展开的同构结果。禁止 CI 静默写平台库，禁止手写与编译器分叉的 `try-on.json`。

---

## 1. 目标与金标

**目标：** 用户说清角色、步骤和先后顺序后，Agent 交出可确认的节点图（连线 + 提示词），用户确认再一键生成。目录里的模板是运营验证过的快捷加载，不是默认脑。

### 1.1 金标句 1（首发硬门，原文钉死）

> @I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，写入画布，待我确认后再做生图生视频

必须同时成立：

1. L0 `precedence_rule_id` 为 `composition_structure`（不得为 `sidebar_img2img` / `product_visual_intent` / `ref_backed_generate` / `orch_ambiguous`）。  
2. **不**套「图生视频 / 角色三视图 / 电商套图 / 分镜成片」，**不** `instantiate`，**不** `propose_generation` / `upsert_media_node`。  
3. 规则抽槽：`identityRef=I1`，`garmentRefs=[I2,I3]`，`wantVideo=true`；识图不得改写。  
4. 确认后拓扑：I1 源图可见不生成；I0 清晰白底三视图（I1→I0）；I2/I3 可见不生成；换装图 A=`I0+I2`、B=`I0+I3`；P 分镜文案节点；V 成片（读 I0+A+B+P）。  
5. 全部 `autoGenerate: false`。确认前 **0 次**生成、不扣出图积分。  
6. 先出由 **dump 生成**的构图摘要 + chip「确认落到画布 / 先不改」；点确认后 import **同一 hash** 的 dump；找不到 persist 不得装懂落盘。

「待我确认后再做生图生视频」= 时机不生成 + 模态含图和视频。**不是**套 i2v 模板，也不是现在就生。

### 1.2 金标句 2（紧接着，可生成骨架，不承诺文案质量）

> @I1 是产品，@I2 是使用场景，先出一张白底再出一张场景图，连好线写到画布，先不要生成

- 构图，不套换装管线（无模特 I0、无 P、无 V）。  
- I1 产品源图（不生成）→ 白底图（产品白底，不是三视图）→ 场景图（白底+I2）。  
- `sequence = [white_bg, scene]`，`wantVideo=false`。  
- 不自动出图；提示词可用骨架，不能空到无法生成。

### 1.3 对照（防误伤）

| 话术 | 行为 |
|------|------|
| 金标句 1 / 「做一个图生视频工作流」 | 结构意图 → 构图（后者 `wantVideo=true`，**不**套内置 i2v） |
| 「生图生视频」单独出现、无结构意图 | 不是路由开关；走现有二创/出图，**不**构图、**不**认亲 |
| 「改画布上那个节点的提示词」 | 二创窄写 |
| 「请用 import_workflow 导入」 | 仅 `import_workflow`（压过结构意图） |
| 短句「换装」 | 不进构图、不套模板 |

---

## 2. 展开代数

编译器读 IR，**模型不输出边**。禁止场景枚举字段（如 `try_on`）。是否换装由 `identityRef + garmentRefs` 推出。

### 2.1 通用规则（金标 2 也走）

| 抽到的原语 | 编译器做什么 |
|------------|----------------|
| 身份 | 一个源图节点（不生成）；下游生成锁它 |
| 多张条件参考 | 按张扇出或按 `sequence` 串 |
| `sequence` | 仅封闭词：`white_bg` \| `scene` |
| `wantVideo` | **一条** V 吃全部成图，并加可编辑 P |

没有「身份 + 服装」时，**不**长出模特白底三视图 I0，也 **不**长出换装分镜。

### 2.2 换装特化（仅 identity + ≥1 件服装 + 要出图）

触发（封闭）：用户指派身份（「作为模特」等）且服装（「服装图」「换装/试衣」或把非身份图指为衣服）。**禁止**「侧栏 ≥3 张图就换装」。

```text
I1 模特源图（可见，不生成，localRefs=@I1）
  └─ I0 清晰白底三视图（image，I1→I0）     // 用户声明已是合格三视图则跳过本节点，A/B 挂 I1
        ├─ I2 服装（可见，不生成）→ 换装图 A（I0+I2）
        └─ I3 服装（可见，不生成）→ 换装图 B（I0+I3）
              └─ P 换装分镜（text/prompt，落盘即有正文）
                    └─ V 成片（video，mentionedKeys=I0+A+B，文案=P 当前正文）
全部 autoGenerate: false
```

- A/B **只挂 I0**（或沿用的 I1），不挂未处理日常照当身份锚。  
- 服装 >4 件：追问，不 preview。两件是金标不是上限。  
- I0 默认提示词：白底、多视图、锁脸锁体、**禁止换装/禁止时尚大片**。可抄旧三视图句当 **编译器常量**，禁止 `parentId=model-turnaround`。  
- 有 `wantVideo` 才加 P+V；金标 1 有「生图生视频」故必须含 P+V。只说换装不要视频 → 停在 A/B。

### 2.3 金标 2 展开

| 节点 | 行为 |
|------|------|
| I1 产品源图 | 可见、不生成 |
| 白底图 | image，I1→白底（产品白底，非模特三视图） |
| 场景图 | image，白底+I2 |
| — | 无 P、无 V |

### 2.4 文案：槽位 + 渲染

P / I0 / A / B 同一套：

- 编译器声明必含条款（P：两套造型顺序、同一人、lookbook 非剧情片；I0：白底多视图锁身份）。  
- 模型只填槽（造型称呼等）。缺槽、缺条款、超时、失败 → **骨架渲染**，不拦 preview。  
- 润色只发生在 **preview**；stamp 的 dump 已是最终文案。确认阶段不再改写。  
- 生成 V 时 **服务端读 P 节点当前正文**，禁止在确认时把 P 拷进 `V.prompt` 后两份分叉。  
- 改 P 不自动重跑 V；再生成 V 才用新文案。

### 2.5 出图字段（与现有编译器同构）

与 `compileRecipeToWorkflow` 同一约定：

- 源图：`data.localRefs`（侧栏附件，不二次上传）。  
- 下游：`data.mentionedKeys` = 上游画布 id。A/B 含 I0（或 I1）+ 对应服装节点；V 含 I0+A+B。  
- import 现有 remap **必须**改写 `mentionedKeys` / `localRefs`（已有 `workflowExchange` 回归，构图不得绕过）。  
- 坐标：编译器可给相对网格；最终避障走现有 import placement。模型不写 x/y。

视频编排器按 `mentionedKeys` 顺序透传 I0、A、B。若上游 API 张数上限为 N：截断时 **I0 优先，再 A、B**，并打观测 `video_refs_truncated`。**禁止**静默只传 A 且不记录。P 全文作为视频 prompt/条件文案。

### 2.6 二创（无结构意图）

- 改现有节点提示词、引用、连线、单点生成、运行组生成。  
- 可给 **选中或用户点名** 的节点加一条下游 video（不跑整段 I0→V）。未选中则追问，禁止随机挂边。  
- 后加手动节点 **不**自动并入运行组。P0 不做「接到现有旧节点当换装上游」（非目标）。

结构意图在非空布上仍可构图叠加（运行组=新节点）。画布是否来自模板一键 **不影响** 分流。

---

## 3. IR 与 persist

IR 只存在于 preview → 编译之间，**不入库当模板**。

```text
CompositionIR.version: "1"
primitives     ← 仅服务端
  identityRef?: string
  skipI0?: boolean          // 仅用户明确已是清晰白底三/四视图
  garmentRefs: string[]
  otherRefs: { ref, role: product|scene|other }[]
  wantVideo: boolean
  sequence: ("white_bg"|"scene")[]
copy           ← 模型可空；失败用骨架
  titles, promptSlots, pSlots
```

不认识的 `version` → compile 失败，不胡编。禁止 IR 含 `nodes`/`edges`/`parentId`/场景枚举。`skipI0` 不得出现在 copy。

### 3.1 抽取 SSOT

与规划器 `pick_planner_slot_utterance` 同类：跳过「确认落到画布 / 先不改」，用最近一条非 chip 的结构意图用户话（或 pending 原话）+ **当时** 侧栏 `@`。确认回合不重抽。侧栏后来变化不改已冻 dump。

指令层级：用户指派 > 规则 > copy 润色 > 识图。Vision JSON **不得**进入会改 primitives 的上下文。P0 确定性预览可以不调聊天模型。

### 3.2 数据流

```text
结构意图（非 chip）
  → 服务端抽 primitives
  → 抽不全 → pending + 固定追问，不 compile、不 stamp
  → 可选 copy 填充（超时/失败 → 空 copy）
  → Nest compile → lint → dump + hash
  → 写入 session.compositionPreview
  → HITL 摘要由 dump 确定性生成；kwargs 仅 kind=composition + hash
  → 确认短路：校验 hash → import dump → 写运行组
```

给模型看的内容（若本轮有 LLM）只有摘要。**dump 不进模型上下文。**

### 3.3 会话 preview SSOT

```text
session.compositionPreview = {
  dump,          // 剥媒体 workflow，无 dataURL
  hash,
  primitives,
  ts
}
```

HITL `additional_kwargs`：`{ kind: "composition", dump_hash }`。确认 **先读会话**；hash 不一致或会话无记录 → 当无 persist。kwargs 不能当唯一真相（压缩/重连会丢）。

dump 卫生：无内嵌媒体；节点数上限 24（与晋升框选同阶）；超限 preview 失败。

stamp 前 lint（共享层）：DAG 无环、类型边合法、全部 `autoGenerate:false`、源图节点不进运行组、无 dataURL。失败 → `compile_failed`，不 stamp、不出确认 chip。

### 3.4 确认幂等

| 情况 | 行为 |
|------|------|
| 同一 `dump_hash` 再次确认 | **幂等**：不二次 import；返回已导入节点 + 「已按构图落到画布。」 |
| 新 hash（再预览）后确认 | 叠加新节点；运行组换成最新一组 |
| 「先不改」 | 不写画布；**不**作废 `compositionPreview` |

---

## 4. 路由

### 4.1 L0（`PRECEDENCE_RULES`，必须写在 Explore 之前）

插入并压过 `sidebar_img2img` / `product_visual_*` / `ref_backed_generate` / `orch_ambiguous`：

1. **`composition_confirm`**：整句「确认落到画布」或「先不改」→ `canvas_agent`。  
2. **`composition_structure`**：结构意图 → `canvas_agent`，reason `composition_structure`。  
3. 然后才是现有规则。

金标句 1 验收：`flow_mode=canvas_agent` 且 `precedence_rule_id=composition_structure`。

### 4.2 结构意图（可单测）

满足任一：

- （设计 / 规划 / 编排 / 做一段 / 做一套 / 做一个 / 搭一套）**且**（工作流 / 流水线）  
- （连线）**且**（写入画布 / 落到画布）

「图生视频」「分镜」「换装」「生图生视频」**不是**路由开关。

### 4.3 Explore 优先级（互斥）

| 序 | 条件 | 行为 |
|----|------|------|
| 0 | chip 确认 / 先不改 | **短路、不调 LLM**。读会话 compositionPreview；P0 **永不** instantiate。仅有旧 `planner_preview_args` → 当无 persist。 |
| 1 | 强导入锚点 | 仅 `import_workflow` |
| 2 | 结构意图，或 `pending_composition_extract` 续跑 | 确定性构图预览；写工具集 **空**（预览已完成） |
| 3 | 有未确认 preview 且话术改 copy/分镜 | 只改 copy、重 compile、换 stamp |
| 4 | 确认后「开始生图/生视频」 | 跑 **当前运行组**，不 propose 新节点、不再 compile |
| 5 | 其余 | 现有二创 / 媒体 propose |

P0 **不得**绑定：`match_workflow_templates`、`preview_workflow_template`、`instantiate_workflow_template`、`promote_workflow_template`。

系统提示（构图支）：禁止 `connect_nodes` / `import_workflow` / `add_nodes_batch` 手搭规划。仍禁止 explore 绑 `run_*_generation` 作为构图手段。

「存成模板 / 改版」P0：固定句导向「我的 / 运营页」，不调 promote。

### 4.4 pending 抽取

字段：原话、已抽 primitives、ts。TTL **15 min**。新的结构意图句替换 pending；用户明确改题（与抽取无关的出图/闲聊且无 @ 角色指派）则作废。

下一句非 chip、非「先不改」→ 合并抽取并 compile，**不**要求再次结构意图。L0 须把 pending 续跑标成构图支，避免「I1 是模特」走 img2img。

抽不全固定追问（禁止 1/2/3 Skill 菜单）：

> 请指明哪张是模特、哪张是服装。

### 4.5 进度与预算

预览占用本轮 Agent HTTP 预算（与 D-BUDGET 同一套剩余时间）。copy 润色不得把预算吃光：超时丢弃，骨架仍出 chip。预览中短进度：「正在编排工作流」。禁止因无进度导致用户重发造成双 preview（后一次覆盖会话 preview）。

---

## 5. 确认门

复用侧栏 chip 整句匹配（trim 全等），不匹配「确认落到画布吧」。

| 情况 | 助手文案 | 禁止 |
|------|----------|------|
| 无 composition persist / hash 不符 | `请先确认构图，再落到画布。` | `未能更新节点` / 请先规划并确认**模板**改动 |
| import 成功（含幂等） | `已按构图落到画布。` | `已按模板落到画布。` |
| 先不改 | `已取消落到画布。` | 写画布 |
| Nest/lint 失败 | 服务端 `userMessage`（否则 §8） | 节点 id 追问 |

HITL 固定句：**请确认是否把构图落到画布**（替换规划器「请确认是否把改动落到画布」）。摘要由 dump 生成，必含：I0 新建或沿用 I1；服装扇出；有视频则 P+V；非空则保留 N、新增 M。

chip 回合豁免 `node_write` 空工具闸门。成功必须转发 `canvas_commands`（focus 新增节点），同规划器 C11。

---

## 6. 运行组与出图

import 成功后，把本次 **生成类** `addedNodeIds`（排除 I1/I2/I3 等不生成源图）写入画布文档根级：

```text
compositionRunGroup: { nodeIds: string[], dumpHash: string, createdAt: string }
```

Dock「生成工作流」与 Agent「开始生图」读 **同一份**。新 hash 确认成功则整份替换。

| 规则 | 说明 |
|------|------|
| 换装+视频队列 | **I0 → A/B（可并行）→ V**。P 不进队列。上游失败不往下冲。 |
| 金标 2 | 白底 → 场景 |
| 单节点生成 | 始终保留（新旧节点均可单独点） |
| 再构图确认 | 默认生成指向 **最新**运行组 |
| 积分 | 只扣队列里实际开跑的节点；确认预览不扣 |

确认后用户说「开始生图/生视频」：跑运行组，禁止 `upsert_media_node` 另起炉灶。

---

## 7. 模板库（P0 只锁产品，不实现后台）

| 层 | 谁写 | 谁看见 | Agent P0 |
|----|------|--------|----------|
| 画布实例 | 构图确认 / 页面一键 | 该会话 | 二创 |
| 我的模板 | 用户保存 | 仅本人 | **不**点名加载 |
| 投稿 | 用户「提交到平台」 | 本人+运营 | 否 |
| 平台库 | 运营发布 | 全站 | **不**点名加载；P1 运营页一键 |

- 我的：只有标题，无别名；规范化标题账号内唯一（占用则覆盖或改名）。  
- 封闭别名仅已发布平台模板、运营配置。  
- `pending` 时覆盖「我的」= 更新同一待审稿并打回待重审；通过钉死快照哈希。  
- `published` 是冻结快照；覆盖「我的」不改全站版。  
- 删除/下架：已落画布当普通图；不能再被一键。  
- 页面一键：填槽后 import，`autoGenerate:false`；非空叠加并声明新增。槽不齐不能落。P1 实现。

P0 产品目录、match、Explore **不再列出**四套内置配方。仓库 JSON 标 deprecated，测例退役，不物理删用户画布。

---

## 8. 错误分类

| code | 用户文案（可微调用词，语义钉死） |
|------|----------------------------------|
| `extract_incomplete` | 请指明哪张是模特、哪张是服装。 |
| `compile_failed` | 这版构图还不能放到画布，请稍后再试或简化步骤。 |
| `persist_missing` | 请先确认构图，再落到画布。 |
| `hash_mismatch` | 请先确认构图，再落到画布。 |
| `import_failed` | 服务端 `userMessage`，否则「放到画布失败，请重试。」 |
| `empty_p_block_v` | 分镜还是空的，写好后再生成视频。 |

任何一类都 **禁止**「未能更新节点，请提供节点 id」。

---

## 9. 非目标（P0）

- Agent 点名 / 关键词 / 规则加载模板  
- 运营审核 CMS、模板市场视觉、新开画布次要入口  
- 模型输出边表；确认后再 compile  
- dump 或 Recipe IR 喂回模型  
- 识图决定谁是模特；侧栏三图默认换装  
- 自动出图；构图预览扣积分  
- 接到画布上已有旧节点当换装上游  
- Chat 多模态；`product_visual` Skill 当换装引擎  
- 新确认 chip 文案以外的按钮（仍用「确认落到画布」「先不改」）  
- 为构图再开子 Agent / campaign / `await_topo`  
- `parentId=model-turnaround` 或第五份 `try-on.json`

---

## 10. 验收

测试用金标 **原文**。拓扑/路由测试 **禁止**调用真实生图/生视频模型。

1. 金标句 1：L0=`composition_structure` → 会话有 preview hash → 摘要含 I0/A/B/P/V → 确认 import 同 hash → 画布节点符合 §1.1 → `autoGenerate` 全 false → 零次生成。窄写工具不含 match/instantiate/propose。  
2. 确认路径 explore **不**为落盘 `ainvoke` LLM。  
3. 无 persist 点确认 → 不写画布；§5 无 persist 句。  
4. 「先不改」→ 不 import。  
5. 同 hash 二次确认 → 不新增第二套换装节点。  
6. 金标 2：2 个生成 image 节点；无时装 I0/P/V。  
7. 「做一个图生视频工作流」→ 构图且 `wantVideo`，不 instantiate `image-to-video`。  
8. 金标句不得被 `sidebar_img2img` / `product_visual_intent` / `ref_backed_generate` / `orch_ambiguous` 抢走。  
9. 抽不全追问后用户仅答「I1 模特 I2 I3 服装」→ 续跑 compile，不是 img2img。  
10. 旧测例退役：`match`「图生视频/分镜」、`select_narrow_write_tools` 规划锚点绑配方三件套、「规划一个角色三视图工作流」绑 planner 工具。改为构图或删除。

---

## 11. 实现落点（计划阶段再拆任务）

- `@lnkpi/shared`：CompositionIR zod、展开器、P/I0 骨架渲染、dump lint  
- `apps/server`：compile 端点、session.compositionPreview、确认 import、运行组写入、V 生成读 P  
- `services/agent-runtime`：L0 两条规则；explore 确定性预览与确认短路；解绑配方工具；pending extract；文案常量；进度摘要  
- `apps/web`：HITL 句与 chip；Dock 读运行组排队  
- 测试：§10 金标轨迹 + L0 + 退役表

编译 **只**在 shared + Nest。runtime 不重写展开器。

---

## 12. 观测

每次预览/确认至少：`precedence_rule_id`、`dump_hash`、`garment_count`、`wantVideo`、`skipI0`、narrow 工具名列表（构图支应为空）、`video_refs_truncated`（若有）。

负向：成功路径 **不得**出现 `parent_id=image-to-video`、`instantiate_workflow_template`、`propose_generation`（确认前）。

---

## 13. 与规划器规格

| 规划器条款 | P0 起 |
|------------|--------|
| §14.5 规划话术 → match/preview/promote；确认 → instantiate | **停止作为 Agent 默认路径** |
| 「图生视频」「分镜」进规划器 | **删除** |
| 确认文案「已按模板落到画布」 | 构图路径改用本文 §5 |
| C9 同 preview 再确认再落一份 | 构图路径改为 **同 hash 幂等**（G12） |
| 平台四套认亲 | Agent 下线；页面 P1 只展示运营已发布库 |
| 晋升 / 用户配方 Nest API | 可保留，Agent P0 不绑定 |

规划器确认短路代码可复用（chip 整句、闸门豁免、转发 canvas_commands），但查找目标从 `planner_preview_args` 改为会话 `compositionPreview`。

---

## 14. 生产开放缺口（2026-09-17）

已批准决策（G1–G16 / 金标 1–2）不变。生产换装会话暴露的绑定、叠加、确认后一键、识图 cap、copy 件数问题记在 [2026-09-17-composition-land-production-gaps.md](./2026-09-17-composition-land-production-gaps.md)。修复须另开切片规格，不得用 2e.3 手搭或扩词顶替构图代数。
