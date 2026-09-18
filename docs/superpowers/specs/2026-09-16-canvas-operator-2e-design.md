# Canvas Operator 2e — HITL 闭环 / 操作集常驻 / V1 工作流摆盘

> 日期：2026-09-16  
> 状态：**已批准**（审阅补丁 2：E2 UI 唯一 / D10 评测非 CI / 挂参分工 / E16 只认手搭；2026-09-16）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md)（V1–V4 / §6.1）  
> 前置：Phase 2d.3（#345/#347）、裸生成绑定（#349）、SSE `tool_call`（#352）、侧栏媒体绑定（#353）  
> 实现 plan：2e.1 [2026-09-16-canvas-operator-2e1-hitl.md](../plans/2026-09-16-canvas-operator-2e1-hitl.md)（已交付 #354）。2e.2 [2026-09-16-canvas-operator-2e2-operator-set.md](../plans/2026-09-16-canvas-operator-2e2-operator-set.md)（已交付 #357）。本刀：[2026-09-16-canvas-operator-2e3-v1-skeleton.md](../plans/2026-09-16-canvas-operator-2e3-v1-skeleton.md)（**仅 2e.3**）。禁止一张 PR 做完两刀。

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **2E-D1** | 程序顺序钉死：**2e.1 确认出图 → 2e.2 操作集常驻 → 2e.3 V1 工作流摆盘**。前一刀生产硬表未绿，不得开下一刀。 |
| **2E-D2** | 2e.2 起画布**操作集只加不减**：默认 `canvas_agent` 轮始终可见 §0.1 九件套。导入工具在强锚点上 **叠加**，**禁止**再把操作集藏起来。**#355 例外：** `is_composition_structure_utterance`（规划+工作流 / 连线+写入画布）bind **空写集**，preview/confirm 走 Nest HTTP，不绑 recipe `match/preview/instantiate/promote`。 |
| **2E-D3** | **废止**「图生视频」「工作流」「分镜」作为规划/导入**减工具**谓词。V1 金标含「生图生视频」，现网 `_is_planner_utterance` 会把它送进规划三件套并拿走画布工具——2e.2 必须拆掉。导入/模板确认锚点（§0.2）只负责 **加** 规划/导入工具，永不减 §0.1。 |
| **2E-D4** | 2e.1 的 HITL SSOT 是侧栏确认卡。生产 **E2 唯一路径**：浏览器点 `[data-testid=generation-propose-confirm]`（文案「确认生成」）。该点击必须走到 `handleAgentGenerateNode` → `generateForNode`（与 Dock 同一函数）→ studio。**点了但生成未开始 = E2 失败**（含无 prompt/refs 静默 return、`assertModelSelectable` 挡掉）。`generateForNode` spy **只**用于 2e.1 修 bug 的单测，不得单独当生产绿。允许测试账号 **一次**小图扣费。脚本直打 `POST /studio/image/generate` **只作诊断，不得单独当 V4 生产绿**。取消走已有 `POST /agent/clear-propose` 或点 `[data-testid=generation-propose-cancel]`。**禁止**为本刀新造 `POST /agent/confirm-propose`。 |
| **2E-D5** | V1 按节点确认；侧栏仍只恢复一张最新/选中的 `pending_confirm`（2c 已钉）。**不做**图级「一键跑工作流」。`@I*` 芯片继续 `localRefs`，不是 canvas 边。 |
| **2E-D6** | 常驻九件套，**不是** 19 个 `EXPLORE_WRITE_TOOLS` 全开。上传 / 超分切片 / 资产库等专才保持 deferred + `tool_search`。 |
| **2E-D7** | Agent **永不**可见或调用 `run_*`。不 mandatory 直调生成。不向 `MEDIA_CREATE_HINTS` 扩「工作流/分镜/搭骨架」同义词。 |
| **2E-D8** | 本档是程序规格。每刀单独硬表 + 单独 plan + 单独 PR。2e.1 **不改**窄写集合。 |
| **2E-D9** | 系统提示与可见工具必须同构：提示说到的写工具，该轮 bind 里必须有；不得再出现「规则 5 要 `connect_nodes` 但 cull 掉」的 ACI 撒谎。 |
| **2E-D10** | 有工具 ≠ 必须调用。2e.2 **合入门禁** = E6–E13 可见性 + 无 `run_*` + 无 mandatory propose。负例（谢谢、识图问句、重新生成一张）不得 **mandatory** 直调 propose；提示写清闲聊不得 upsert/propose。负例「不得出现 propose `tool_call`」是 **部署后抽检/评测**，**不当** 2e.2 CI flake 门；失败先看提示，不立刻回滚九件套。 |

### 0.1 常驻操作集（钉死，恰好 9 个）

`upsert_media_node` · `propose_generation` · `set_node_prompt` · `set_node_content` · `upsert_prompt_node` · `connect_nodes` · `apply_sidebar_attachments` · `attach_refs` · `duplicate_node`

2e.2 废止默认路径的 ≤5 窄写上限。规划/导入叠加后总数可以 >9，仍 **不含** `run_*`。

### 0.2 叠加集（钉死）

| 意图 | 强锚点（仅这些可 **加** 工具） | 叠加工具 |
|------|-------------------------------|----------|
| 导入 | `import_workflow` 字面量、`导入工作流`、`导入`+`工作流`/`workflow`/`lnkpi.workflow` | `import_workflow` |
| 规划 recipe 工具 | — | **#355 P0：永不 bind** `match_workflow_templates` / `preview_workflow_template` / `promote_workflow_template` / `instantiate_workflow_template`。确认芯片走 `confirm_composition` HTTP。 |
| composition 结构口令 | `is_composition_structure_utterance` | **空写集**（不减 CORE 只读；不给九件套，避免手搭抢 HTTP preview） |
| 禁止当独占谓词 | `图生视频`、单独的 `工作流`、`分镜`、`生图生视频` | 不得因此拿走 §0.1（V1 金标不是 composition 结构口令；「做一个图生视频工作流」仍是构图，见构图规格 G17） |

导入弱锚点（无工作流标记的「导入+URL」）保持现网「不抢 upload」行为；**不得**因此清空操作集。

「接到 / 改版」等规划锚点 **不再**叠加 recipe 工具（#355）。默认轮仍 ⊇ 九件套。2e.2 提示必须写：无「确认落到画布」不得 instantiate；口语搭骨架（含 V1 金标）优先 `upsert_media_node` + `connect_nodes`。

`arrange_nodes_along_edges` 现网不在 `EXPLORE_WRITE_TOOLS` cull 里，一般已可见。2e.2 提示同构时列一次即可，**不**塞进九件套。

### 0.3 金标句（钉死）

**2e.1 / V2（沿用，不改字）：**

> 帮我生成一张蓝色天空产品主图

**2e.1 取消轮：** 同上句 propose 成功后点取消（或 `POST /agent/clear-propose`），不出图。

**2e.3 / V1（2a WORKFLOW 原句，不改字）：**

> 我期望的工作流不是全都是提示词节点，我期望通过画布的各类节点骨架连接好直接生图生视频，提示词自动填入到dock

**2e.2 可见性金标：** 上句在 bind 后必须同时含 `upsert_media_node`、`connect_nodes`、`propose_generation`（操作集常驻即可，不靠扩词）。

### 0.4 非目标（本程序）

- 2d.4 删除 `_LEGACY_LANE_SHIM`
- Phase 3（campaign / product_visual 工具化）
- prompt/模型切片（当前 P7/试衣已有 tool_call）
- 同会话「重新生成一张」再 propose（2e.2 负例仍禁止调用；行为切片后置）
- 图级自动按边出图 / 批量确认
- 19 个写工具全开；`run_*` 可见；mandatory 直调
- 新造服务端 confirm API
- 改 H8 脚本；放宽未改的 V2 P7 断言
- 试衣临时候烟入库、↺ 无 `@`、前端复用摘要重复（另开）
- Chat/explore 多模态 `image_url`

---

## 1. 背景

Canvas Operator 已能：路由进 `canvas_agent`；单节点 upsert→propose（裸生成、侧栏试衣）；导入/模板实例化自带边；SSE 能看见工具名。

还缺：

1. **闭环：** 冒烟把 `pending_confirm` 当终点；用户感知的终点是确认后出图。2c 单测有 `generateForNode`，本轮生产未按确认卡复测。
2. **ACI：** `_bind_plan_tools` 对 `EXPLORE_WRITE_TOOLS` 做 ≤5 场景 cull。`connect_nodes` 是写工具，现网所有窄集都不含它，但系统提示规则 5 要求工作流连线。
3. **V1：** 金标「生图生视频」被子串 `图生视频` 送进规划独占集，即便 2e.2 常驻九件套，若仍「命中规划就减画布工具」，V1 永远没有 `connect_nodes`。

侧栏规格 SM-D6 曾写「CORE 常驻未授权」。本程序 **授权** 2e.2 常驻九件套，并 **废止** 规划/导入减工具。不授权 19 全开、不授权 Phase 3。

---

## 2. 钉死规则

### 2.1 2e.1 HITL 闭环

1. 先跑未改语义的 V2 裸生成，得到 `pending_confirm` 节点。  
2. **确认（生产 E2 唯一）：** 打开该会话画布 `/workflow/:sessionId`，侧栏出现确认卡后，浏览器点 `[data-testid=generation-propose-confirm]`。节点必须进入 `generating` 或出现 `generationRecordId`（studio 已启动）。仅离开 `pending_confirm` 但未开始生成 = 失败。禁止 `sendPreset('确认生成')`。禁止用脚本直调 `generateForNode` 或 studio 判 E2 绿。  
3. **取消（另开会话或另开节点）：** `POST /agent/clear-propose` 或点 `[data-testid=generation-propose-cancel]` 后该节点 `draft`，无 studio generate、无扣费。  
4. 直打 `/studio/image/generate` 若与确认卡结果不一致，以确认卡为准，记录诊断，**不得**把直打结果写成 V4 绿。  
5. 2e.1 **零** runtime bind 变更。若确认卡失败，本刀修 2c 接线（`CanvasPage.handleAgentGenerateNode` / `useNodeGeneration.generateForNode` / pending 未清 / 缺 `imageModel` 被 `assertModelSelectable` 挡掉），修完再绿，不跳 2e.2。  
6. Agent 新建节点可能没有 `imageModel`。`resolveGenerationModel` 必须落到平台默认；`assertModelSelectable` 不得因缺字段静默 return。E2 验收的是「生成已开始」，不是「按钮可点」。

### 2.2 2e.2 只加不减

1. `_bind_plan_tools`：写工具默认可见集 = §0.1。导入命中时 `visible |= import_workflow`，**禁止** `return` 一个不含操作集的小集合。**#355 例外：** composition 结构口令返回空写集。  
2. 删除 `_is_planner_utterance` 里 `图生视频` / `分镜` 导致的独占；`生图生视频` 不得把可见集收成 planner 三件套。recipe planner 工具按 #355 P0 不叠加。  
3. `tool_search` 仍只搜 deferred；**禁止**把 CORE 写工具塞进 `tool_search`。  
4. 系统提示：规则 4/5/8/9 与可见工具对齐；规划叠加轮可另附「不要用手搭替代已确认的 instantiate」，但不删 `connect_nodes`。  
5. 负例调用：`utterance_binds_media_propose` / `utterance_binds_sidebar_media_propose` / regen / 识图问句保持 False 时，**不** mandatory propose。提示写明闲聊、谢谢、纯问答不得 upsert/propose。合入只锁可见性（E10）；「谢谢不得出现 propose `tool_call`」见 2E-D10，不当 CI flake 门。  
6. **挂参分工（2e.2 提示与工具描述必须写死，防 #353 身份串）：**

| 用户指的东西 | 只用 | 禁止 |
|--------------|------|------|
| 侧栏芯片 `@I*` / `I1` | `apply_sidebar_attachments`（`mode=localRefs`） | `attach_refs` 吃芯片 key；`connect_nodes` 连芯片 |
| 画布已有 `image-*` / `video-*` | `attach_refs` 和/或 `connect_nodes` 边 | 把 canvas id 当芯片 key 喂给 `apply_sidebar_attachments` |

### 2.3 2e.3 V1 摆盘

1. 金标句走 `canvas_agent`，不进 atomic 子图。  
2. ≥2 个媒体节点（至少覆盖「生图」与「生视频」两种类型，或图→视频一条链）+ ≥1 条 canvas **边**。对本金标，边必须来自 `connect_nodes` 的 `canvas_action`；**不得**用 import/instantiate 的落点边混绿。  
3. 可生成节点 dock prompt 非空。  
4. 每个新建的可生成媒体节点都 `propose_generation`；确认前无 `run_*`、无 billed complete。  
5. 不把 `@I*` 连成边。  
6. 成功标准容忍拓扑多样，不锁死唯一 DAG。  
7. HITL 沿用 2c：多 pending 时侧栏一张卡，其余 Dock。本刀 **不** 自动确认、**不** 扣费出图（2e.1 已证确认通道；2e.3 停在 propose）。

### 2.4 切片门禁

| 刀 | 可开条件 |
|----|----------|
| 2e.1 | 本档批准 |
| 2e.2 | 2e.1 硬表生产绿（确认卡 + 取消） |
| 2e.3 | 2e.2 单测硬表绿且 runtime 已部署 |

---

## 3. 验收硬表

### 3.1 2e.1（V4 生产）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **E1** | V2 金标前置 | 与现网 P7 相同：`canvas_agent`、upsert→propose、`pending_confirm`、无 `run_*` |
| **E2** | 生产：点 `[data-testid=generation-propose-confirm]` | 生成已开始：`generating` 或已有 `generationRecordId`；**不是** `sendPreset('确认生成')`；点了但未启动 = 失败 |
| **E3** | 扣费 | 确认轮有 studio 生成记录（一次小图）；取消轮无 |
| **E4** | 取消 | `clear-propose` 后节点 `draft` |
| **E5** | 诊断直打 studio | 可选；**不得**在缺 E2 时单独判绿 |

### 3.2 2e.2（单测；部署后抽检负例冒烟）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **E6** | `_bind_plan_tools(V1 金标)` 可见名 | 含九件套中的 `upsert_media_node`、`connect_nodes`、`propose_generation` |
| **E7** | `_bind_plan_tools("帮我生成一张蓝色天空产品主图")` | 含 upsert + propose（回归 P5） |
| **E8** | `_bind_plan_tools("导入工作流")` | 含 `import_workflow` **且** 含 §0.1 操作集 |
| **E9** | `_bind_plan_tools("确认落到画布")` | 含 §0.1 操作集；**不含** `instantiate_workflow_template`（确认走 #355 `confirm_composition`） |
| **E10** | `_bind_plan_tools("谢谢")` / `"@I1 是什么衣服"` / `"重新生成一张"` | **可见性**：操作集仍可见；**不含** `run_*`。本行 **不**断言「不得出现 propose `tool_call`」（那是部署后评测，见 2E-D10） |
| **E11** | `build_tool_plan().visible_names` | 仍不含 `run_image_generation` / `run_video_generation` |
| **E12** | 规划独占谓词 | `"…生图生视频…"`（无规划强锚点）**不得**把可见集收成仅 planner 三件套 |
| **E13** | 既有 planner/import/sidebar/裸生成单测 | 行为改为叠加后更新期望：不再断言「仅 N 个写工具」若该断言依赖减工具 |

### 3.3 2e.3（生产 V1）

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **E14** | `flow_mode` | `canvas_agent` |
| **E15** | 结构 | ≥2 媒体节点 + ≥1 canvas 边 + 非空 prompt |
| **E16** | 工具序（对本金标） | 必须同时有 `upsert_media_node`（或等价新建媒体节点）+ `connect_nodes` + `propose_generation`；无 `run_*`。**`import_workflow` / `instantiate_workflow_template` 不得作为本句通过条件**（本句是口语搭骨架，不是导入；instantiate 只有用户说了「确认落到画布」才算） |
| **E17** | 确认前 | 可生成节点 `pending_confirm` 或等价待确认；无 billed complete |
| **E18** | 负 | 无原子「基于引用内容…」卡；芯片未当边 |

---

## 4. 回滚

- 2e.1：删 V4 冒烟脚本；不回退 2c。  
- 2e.2：恢复 `select_narrow_write_tools` 减工具语义即回到场景门（试衣/裸生成仍可走旧窄集）。不恢复 `run_*` visible。  
- 2e.3：无独立数据迁移；停用即可。  
- **永不**用恢复 `run_*` 可见或静默扣费作为回滚。

---

## 5. 后续（未授权）

- **2d.4：** 删除 `_LEGACY_LANE_SHIM`（生产日志无旧 lane 之后）  
- regen 同会话再 propose  
- 试衣冒烟脚本入库  
- ↺ 无 `@`（SM-D7）  
- Phase 3；图级运行工作流  
- 19 写工具全开  

---

## 6. 与既有规格关系

| 档 | 本文件 |
|----|--------|
| 父规格 V2/V3/V5/V6 | 已交付；本档补 V4 生产（2e.1）与 V1（2e.3） |
| 侧栏 SM-D6「CORE 常驻未授权」 | 2e.2 **授权九件套常驻**；不授权 19 全开 |
| 侧栏「规划/导入一字不改、仍优先」 | 2e.2 **改为叠加**；不再减操作集 |
| H8 / V2 P7 脚本 | 不改语义；2e.1 另写 V4 脚本 |
| 2d.3 垫片 | 不动；2d.4 后置 |
| 2c 确认 ≡ Dock | 2e.1 的生产门禁，不重做 2c 设计 |

---

## 7. 自检（写档时）

- [x] 无 TBD 阻塞合入门禁；2e.2/2e.3 plan 预留、本档不实施那两刀  
- [x] V1 金标与 `图生视频` 独占冲突已写进 2E-D3 / E12  
- [x] 确认卡 SSOT；生产 E2 只认侧栏 `generation-propose-confirm` 点击；studio 直打不得单独判绿  
- [x] 2E-D10：负例 tool_call 是评测不是 CI flake 门  
- [x] 挂参分工表：`@I*` → apply_sidebar；canvas id → attach_refs/边  
- [x] E16 对本金标只认手搭，import/instantiate 不得混绿  
- [x] 只加不减；九件套钉死；禁止 19 全开与 `run_*`  
- [x] 未滑入 Phase 3 / 2d.4 / 模型切片 / 新 confirm API / 图级自动跑  
- [x] 每刀硬表可测、金标句唯一且不改字  
