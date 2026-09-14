# 工作流配方规划器（衍生 / 嫁接 / 晋升）设计

> 日期：2026-09-15  
> 状态：已批准（对话确认 §1–§6）+ **审核修订 2026-09-15**（见 §0.1）  
> 产品：超创平台（lnkpi）无限画布  
> 相关：  
> - [2026-09-12-canvas-workflow-exchange-design.md](./2026-09-12-canvas-workflow-exchange-design.md)  
> - [2026-09-12-agent-import-workflow-design.md](./2026-09-12-agent-import-workflow-design.md)  
> - [2026-09-13-explore-import-workflow-placement-design.md](./2026-09-13-explore-import-workflow-placement-design.md)  
> - [2026-07-25-agent-consistency-chains-design.md](./2026-07-25-agent-consistency-chains-design.md)  
> - [2026-08-08-agent-canvas-control-surface-design.md](./2026-08-08-agent-canvas-control-surface-design.md)

## 0. 决策摘要

| 项 | 选择 |
|----|------|
| 规划器编译目标 | **配方（Recipe IR）**，不是直接编 `lnkpi.workflow` dump |
| 实例进出 | 已有导出/导入与 `import_workflow`；规划器不新开第二条写画布通道 |
| 衍生 | 相对父模板的结构化 delta：加 / 删 / 改线；**必须保住父配方种子链与一致性规则** |
| 新种子链 | 禁止模型自造 `seed`/`turnaround`。两条合法入口：**嫁接**目录里另一条配方的整条种子链；**晋升**（导出 JSON → 用户确认核心步骤后入库） |
| 嫁接 | 一次衍生最多 1 次；只拷种子链（seed+turnaround 及链内冻结依赖），不自动带走对方下游 |
| 版本 | 衍生钉死 `parentId + parentVersion`；二次衍生的不变量仍跟**目录根配方 ∪ 已嫁接种子链**走 |
| 结构 vs 填槽 | delta 只含结构；标题/prompt/素材在结构确认之后填槽。`full\|trimmed` 只用父配方已声明的裁剪视图，不与 `remove` 抢活 |
| 晋升话术 | 先选按钮，解释放二次确认。A「保存为当前模板的改版」/ B「存成一套新模板」；默认改版 |
| 物化 | 确定性编译器：配方 + 槽位 → 带身份的 `lnkpi.workflow` → `import_workflow`。坐标不让模型编 |
| 出图 | 规划只落骨架；出图走现有出图门。调度**读节点上的配方元数据** |
| 代码生成 | 运行时禁止模型写代码再执行来产 JSON。模型的程序是 delta/graft；解释器是 `apply` + `lint` |
| 目录 | 平台配方（工程维护，自现有 `canvas-manifest` 提升）+ 用户配方（晋升写入，不跨账号） |
| 自动入库 | 导入/导出/`import_workflow` **不**自动晋升 |

### 0.1 审核修订（实现前必须遵守）

1. **lint/apply/compile 只在 `@lnkpi/shared` + Nest 执行。** agent-runtime 不重写配方逻辑，只调 Nest。Python 不能可靠消费 Zod。  
2. **跨链节点**不设 `chain` 数组：`chain` 省略，lint 根据 `depends_on` 里出现的各链 turnaround key 判定涉及哪些链。  
3. **净增 ≤ 8 只计 `add`**，graft 拷入的种子链节点不计入。  
4. **第二份平台配方**用营销 manifest 的 `chain: model` 种子段（`model_portrait` → `model_turnaround`），用户标题「角色三视图」。**不要**用 atomic 单节点 character_turnaround（那不是种子链）。第一份平台配方用产品链（至少含可删下游，便于改版验收）。  
5. **规划确认后默认只实例化到画布**，不写入用户目录；要保留模板必须走晋升。  
6. **第一期不另做填槽向导**：槽位从当前话术 + 侧栏/画布已有素材填入；空槽用 `prompt_hint_template` 落骨架。  
7. **不劫持现有 marketing_intent / campaign 子图。** 规划器走 explore 新工具；话术含「规划工作流 / 模板 / 接到」等才进规划器。  
8. **HITL 复用现有 chip/确认门**，第一期不做模板市场页。  
9. **`build_chain_ref_order` 不得写死仅 `product`/`model`**：任意非空 `chain` + 节点 `data.recipeKey`/`chain`/`role` 均可。

---

## 1. 背景与目标

画布与 Agent 已能导入/导出 `lnkpi.workflow`。该 schema 是画布 **dump 契约**（任意 `data`、坐标、媒体），不是给模型填的作者契约。Explore 禁止 `add_nodes_batch`；现有电商/营销管线是写死的 Skill + `canvas-manifest`，不能按场景规划各种工作流。

**缺口：** 场景意图 → 一份合法、可落地的配方 → 实例 JSON → 已有 import。

**北极星：** Agent 能认亲现成模板，在保住核心步骤的前提下加删改线或整段接上另一条核心链；用户也可以把跑通过的导出 JSON 确认后收成新模板。落画布后拓扑可认、可再生成，一致性链不断。

---

## 2. 三层产物

| 层 | 是什么 | 谁写 |
|----|--------|------|
| **父配方** | 带不变量的模板：节点角色、依赖、种子链、一致性规则 | 平台目录（人手/工程）或用户晋升 |
| **衍生配方** | `parentId + parentVersion + delta`（可含一次 `graft`），合并后仍是完整配方 | 规划器提议，lint 通过才算数 |
| **工作流实例** | `lnkpi.workflow`（填好槽的具体图，节点带配方身份） | 确认结构并填槽后由编译器产出 |

用户侧用语：**模板** = 配方；**核心步骤** = 种子链（seed + turnaround 及链内冻结依赖）；**改版** = 衍生配方。规格正文用内部词，HITL 用 §7 话术。

主循环：

```text
场景
  → 认亲（主父配方；可选嫁接候选）
  → 规划器产出 delta（add/remove/rewire，可选 graft）
  → apply(parent, delta) → lint
  → HITL：相对父模板的 diff（不是一张陌生新图）
  → 填槽 → 编译器 → lnkpi.workflow（带身份）
  → import_workflow → 画布骨架
  → 现有出图门（可选）
```

晋升是目录增长口，不在每次规划里默认发生。见 §6。

---

## 3. 配方 IR

SSOT 放 `@lnkpi/shared`（与 `validateWorkflow` 同包）。**apply / lint / compile / 反推只在该包与 Nest 执行**；runtime 经 Nest HTTP 调用，禁止在 Python 复制一份 Zod。现有 Skill `canvas-manifest.yaml` 的 `key` / `depends_on` / `chain` / `role` / `gen_mode` / `prompt_hint_template` 提升为本 IR；不变量写在配方上，lint 不靠模型自觉。

### 3.1 顶层

| 字段 | 说明 |
|------|------|
| `id` | 配方稳定 id，如 `ecommerce-product-visual` |
| `version` | semver；衍生钉死所针对的版本 |
| `title` | 用户可见短名 |
| `parentId` / `parentVersion` | 衍生配方必填；晋升得到的新父配方为空 |
| `graftedRecipeIds` | 已并入的其它配方 id（种子链已拷入） |
| `invariants` | 见 §3.3 |
| `topologyViews` | 可选 `full` / `trimmed` 及 trimmed 的 key 子集（依赖闭包）；与 delta `remove` 分离 |
| `nodes` | 见 §3.2 |

### 3.2 节点

| 字段 | 含义 |
|------|------|
| `key` | 稳定槽位名，如 `white_bg`、`hero_main` |
| `type` | 第一期规划器 **add** 只允许 `prompt` / `image` / `video` / `text`。晋升可保留导出里已有的 `group` / `shot` / `sceneComposer`，规划器第一期不得 add 这三类 |
| `chain` | 一致性链 id，如 `product` / `model`；文案类省略 |
| `role` | `seed` \| `turnaround` \| `downstream` |
| `depends_on` | 有向依赖；实例化时成边，同链 i2i 再写成 `localRefs` |
| `gen_mode` | `t2i` / `i2i` / `v_ref`；无链文案可省略 |
| `slots` | 可填提示词/素材槽；`prompt_hint_template` 作为槽默认，不是冻死的一次出图 |
| `auto_generate` | 是否纳入出图门默认勾选。规划器 **add 的下游默认 `false`** |
| `optional` | 仅当父配方 `topologyViews.trimmed` 已声明时可裁；不能用来绕过种子链冻结 |

`role: seed | turnaround` 默认不可删，不可改 `type` / `role` / `chain` / 链内 `depends_on` / `gen_mode`。

### 3.3 不变量（机器可检查）

以电商产品链为例，种子链即现有：`white_bg`(seed) → `product_turnaround`(turnaround)。

1. **种子链冻结**：`invariants.seed_chains[].keys` 必须都在；链内 `depends_on` 与声明完全一致。  
2. **下游挂回 turnaround**：标了 `chain` 的 `downstream`，`depends_on` 必须包含该链 turnaround（无 turnaround 则挂 seed）。跨链节点 **省略 `chain`**，`depends_on` 必须包含所涉及**每条**链的 turnaround key。  
3. **出图同链 ref**：与一致性链规格一致；同链生成前刷 seed/turnaround 资产。  
4. **文案不进视觉依赖**：`text` / `prompt` 不得出现在 `image` / `video` 的 `depends_on` 里。旁白只进 prompt 槽。  
5. **DAG**；`depends_on` 只指向存在的 `key`。  
6. **类型/边白名单（第一期 add）**：  
   - `image` 只依赖 `image`  
   - `video` 只依赖 `image`  
   - `text` / `prompt` 不作为视觉依赖目标  

`invariants.seed_chains` 形如 `{ id: "product", keys: ["white_bg", "product_turnaround"] }`，`keys` 顺序即链序。`graft` 成功后，把对方的 seed_chains **并入**结果配方的 `invariants`（不得改写已并入链的 `keys`）。

没有写进 `invariants` 的东西，规划器不能猜一条新种子链。新家族只能来自嫁接或晋升。

目录内**可互相嫁接**的配方，`chain` id 与节点 `key` 必须不冲突：平台配方由工程保证；用户晋升冲突则拒绝并请改名；graft 冲突则整段撤回（不改对方 key）。

---

## 4. 认亲、delta、嫁接、lint

### 4.1 认亲

- 检索平台目录 + 当前用户目录，prompt **只喂 top 1–3 份摘要**，禁止整表塞进上下文。  
- 选出 **主父配方**。话术明显跨家族时再标一个 **嫁接候选**（必须是目录里另一条配方，且 `chain`/`key` 与主父不冲突）。  
- 低置信：先问用哪套模板，不改画布。挂错父模板时，后面所有「合法 diff」都会是错图。  
- 评测：黄金集断言「这句话 → 期望父配方 id（及可选 graft id）」。

### 4.2 Delta（结构 only）

相对主父，钉死 `parentId + parentVersion`。禁止整份 IR 重写。

| 操作 | 允许 | 禁止 |
|------|------|------|
| `graft` | 拷入另一条目录配方的种子链 | 自造 seed/turnaround；带走对方下游；同一次衍生超过 1 次 graft |
| `add` | 新节点仅为 `downstream` 或无链（`text`/`prompt`） | 新增 `seed`/`turnaround`；add `group`/`shot`/`sceneComposer` |
| `remove` | 删不在任一种子链 `keys` 上的节点 | 删核心步骤 |
| `rewire` | 改下游 `depends_on` | 改种子链内部连线；让下游脱离其 chain 的 turnaround |

标题、prompt、素材不进入 delta，放到结构确认之后的填槽。禁止另设 `patch` 与结构确认混在一次 diff 里。种子链节点的 `gen_mode` 不可改。

加节点若标了某 `chain`，必须立刻满足「挂回该链 turnaround」。一次衍生 **`add` 净增 ≤ 8**（graft 拷入的种子链节点不计入该上限）。

嫁接过来的链立即同样冻结。二次衍生（「再加一张包装图」）仍对**根配方 ∪ 已嫁接种子链**做 lint，不沿中间变体放宽。

`trimmed`：只开启父配方已声明的裁剪视图，语义是依赖闭包后的子集，不是任意 `remove`。

### 4.3 Lint 与失败（内部）

合并后检查 §3.3 全项 + 无重复 `chain`/`key` + 净增上限 + 本轮默认 `auto_generate` 预算（add 下游默认 false，不另做数字预算也能过第一期验收）。

| 失败 | 行为 |
|------|------|
| 第一次部分非法 | **剥掉非法刀，留下合法子集**，说明原因 |
| 嫁接冲突（配方不存在、key/`chain` 撞车） | **整段 graft 撤回**，不留半条核心链 |
| 第二次仍失败 | 放弃本轮 delta，可按原模板实例化（或只提示用户改需求），不写非法图 |

错误码给日志与评测；用户文案见 §8。结构确认前不写画布、不入库。

---

## 5. 实例化与出图

### 5.1 单路径

```text
配方 + 槽位
  → 编译器（@lnkpi/shared）→ lnkpi.workflow（format/version 与现有交换契约一致）
  → Nest import-workflow（validate → remap → placement → persist）
  → 画布骨架
```

坐标：按 `depends_on` 拓扑分层网格赋值，再走现有 `computeImportTranslation`，**禁止模型编坐标**。边来自 `depends_on`；同链 i2i 的 `localRefs` / `mentionedKeys` 由编译器按画布原生语法写。

规划器产出的落画布 **只走这条路径**。既有 ecommerce/campaign 的 LangGraph `split` 第一期可保留，但出图必须能消费导入节点上的配方元数据（§5.2）。将 `split` 迁到同一编译器不阻塞规划器上线，作为后续切片。

本步 **不出图**。

### 5.2 节点身份（写入 `data`，随导出往返）

| 字段 | 用途 |
|------|------|
| `recipeId` / `recipeVersion` | 来自哪份模板 |
| `recipeKey` | 稳定槽位 |
| `chain` / `role` | 同链 ref、不变量 |
| `gen_mode` | t2i / i2i / v_ref |
| `parentRecipeId` | 若来自改版，指向根/父模板（可选，便于追溯） |

`validateWorkflow` 继续把 `data` 当开放记录；身份字段是约定键，编译器必写，晋升反推必读。

出图调度（`orchestrate_gen` 或其后继）：**优先读节点 `data` 的 `chain`/`role`/`recipeKey`**，按一致性链规格刷 ref；不得只认进程内 split manifest，否则衍生/晋升导入后链会断。

### 5.3 工具落点

认亲、提 delta/graft、晋升提议：对话/explore（只读目录 + 提议，不直接批量组拓扑）。  
改画布：编译器 + 已有 `import_workflow`。  
出图、destructive、`add_nodes_batch`：仍 graph-only，符合 Hybrid 控制面。

---

## 6. 导出 JSON 晋升为模板

晋升是**显式用户动作**，不是导入副作用。导出、导入、`import_workflow` 都不自动入库。

### 6.1 入口

对一份通过 `validateWorkflow` 的 JSON（当前画布导出、子图导出、或文件）。推荐子图；节点数 > 24 则请先框选，拒绝整张过大乱布默默晋升。

### 6.2 反推

确定性代码：边 → `depends_on`；去掉坐标与媒体文件；节点 prompt 降为槽默认值，不把某次出图冻进配方。

规划器只提议 **角色标注**，不发明额外节点：`seed` / `turnaround` / `downstream` / 无链。已有 `recipeKey`/`chain`/`role` 时作为默认标注，仍须用户确认。手搭布不得静默猜测核心步骤。

`key` 优先已有 `recipeKey`，否则按稳定规则从标题生成。与平台目录或该用户已有配方 `key`/`chain` 冲突则拒绝，直到改名。

### 6.3 两条保存路径（用户话术见 §7）

- 能认到已有父模板：第一步同时给出「改版」与「新模板」。**改版不要求用户标核心步骤**（相对父模板算 delta）。选新模板时，用反推结果作为默认勾选，在二次确认里列出并点头。  
- 认不到父模板：第一步 **只给「存成一套新模板」**，不出现改版（没有「当前模板」）。必须确认核心步骤（反推仅作默认，不得静默入库）。

含义：

- **改版**：`parentId + parentVersion + delta`；种子链仍跟根走；不声明新核心链。  
- **新模板**：用户确认的核心步骤写成该配方自己的 `invariants.seed_chains`；之后可被认亲、可被嫁接。

新种子链 **只** 走「新模板」且必须经过核心步骤确认。没有至少一个 `seed` → 拒绝晋升。lint 不过 → 不入库。

通过后写入 **用户配方目录**（按 `userId` 隔离，第一期不进平台总目录、不跨账号）。平台配方仍由工程维护。认亲/嫁接的目录 = 平台 ∪ 该用户。

来源元数据：`sourceSessionId`、workflow 内容 hash、创建时间。新模板 `version` 为 `1.0.0`，无 `parentId`。

---

## 7. HITL 话术

内部禁止把 parentId、delta、种子链、嫁接、lint 直接展示给用户。用户词：**模板、核心步骤、改版、接到另一套模板**。

### 7.1 规划结构确认

展示相对主模板的变化列表，例如：

- 接上「角色三视图」的核心步骤（内部：graft）  
- 增加「包装细节」  
- 去掉 Banner  

确认后自动填槽（话术 + 已有素材，无单独向导）并 `import_workflow`。默认**不**把衍生配方写入用户目录。

### 7.2 晋升：先选后解释

**第一步（按钮 only）：** 「这份工作流更像哪一种？」（认不到父模板时只显示第二项）

- 保存为当前模板的改版  
- 存成一套新模板  

**第二步（解释 + 确认）：**

- 改版：还是原来那套核心步骤，只记住这次的增减和连线；核心步骤不能拆掉。  
- 新模板：把你确认过的核心步骤锁进新模板；以后可以当起点，也可以整段接到别的模板上。**列出将锁定的核心步骤**，点头才入库。

同时给出两项时，不确定则默认改版。认不到父模板时无改版可默认。返回可回到第一步。

---

## 8. 失败时的用户文案

| 情况 | 用户看到 |
|------|----------|
| 认亲没把握 | 先问用哪套模板，不直接改画布 |
| 部分改动不合法 | 能留下的改动已保留（例如去掉了 Banner）。主图仍需跟着四视图，那一步没改。 |
| 嫁接冲突 | 没法把「角色三视图」整段接上来，和当前模板的步骤冲突。 |
| 晋升未确认核心 | 还没确认核心步骤，没法存成新模板。 |
| JSON 不合法 | 这份工作流文件无法识别。 |
| 新下游不出图 | 这次先搭好骨架，新增的图默认先不出，避免一次生成过多。 |

---

## 9. 非目标（第一期）

- 运行时模型写代码再执行来生成 JSON  
- 导入/导出自动入库；无确认的新核心步骤  
- 公开模板市场、跨账号共用用户模板  
- 规划器直接出图  
- 把 `lnkpi.workflow` 的整包 `data` dump 当成配方 schema 来「学习」  
- 向外部 Agent 公开 Recipe IR / delta（W2 仍只教实例 JSON 与 `docs/workflow/README.md`）  
- 每条 Skill 手写特例衍生逻辑作为主路径  

离线作者（仓库内新增平台 `canvas-manifest` / Recipe YAML）允许；那不是会话 exec。

---

## 10. 验收

1. **认亲 + 改版**：在电商套图上 add 下游、remove 非核心、rewire 下游 → HITL 只显示相对原模板的变化 → 确认后 import，节点带 `recipeId` / `recipeKey` / `chain` / `role`。拆核心步骤被拒绝；第一次非法刀被剥离并说明。  
2. **嫁接**：套图 + 角色三视图 → 画布出现对方完整核心步骤；对方下游不自动带来；可再 add 跨链下游（须同时挂两条核心）。key/`chain` 冲突则整段不接。一次衍生不能 graft 两次。  
3. **晋升**：合法导出 JSON → 「存成一套新模板」→ 二次确认列出核心步骤 → 写入用户目录；之后可被认亲、可被嫁接。选「改版」则种子仍跟原模板。导入本身不入库。超过 24 节点未框选则拒绝晋升。  
4. **物化一条路**：编译器 → `lnkpi.workflow` → `import_workflow`；placement 避开已有节点；本步不出图；add 下游 `auto_generate=false`。  
5. **往返**：导出再导入，配方身份还在；出图调度能按 `chain`/`role` 刷同链 ref。  
6. **评测黄金集**（规则可测）：认亲期望父配方；合法/非法 delta；嫁接成功与冲突；晋升缺 seed 拒绝；二次衍生不能放宽根不变量。  
7. **Hybrid**：explore 仍不 bind `add_nodes_batch` / `run_*_generation`；规划落盘只经 `import_workflow`。

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 认亲错误 | top-1–3、低置信澄清、黄金集 |
| 链式衍生掏空核心 | 不变量永远相对根 ∪ graft 种子链 |
| 双写画布 | 规划器只走编译器 + import；split 迁移单列切片 |
| 用户模板 key 撞车 | 晋升与 graft 时硬冲突失败 |
| 一次加过多下游打爆费用 | add 默认不出图 |
| dump JSON 噪声当配方 | 晋升剥媒体/坐标；角色必须确认 |

---

## 12. 实现切片（供 writing-plans，非本文件任务清单）

1. Shared Recipe IR Zod + `applyDelta` + `lintRecipe` + 单测（含冻结链、graft、非法剥离）  
2. 平台配方：产品链（含可删下游）+ 模特种子链 `model_portrait`→`model_turnaround`（标题「角色三视图」）  
3. 编译器：Recipe + 槽 → `lnkpi.workflow` 身份字段 + 网格坐标；接 Nest `import-workflow`  
4. 出图调度读节点 `data.chain`/`role`/`recipeKey`  
5. Runtime/Nest：认亲检索、derive 提议、HITL diff  
6. 用户配方存储 + 晋升两步确认 + 反推标注  
7. 黄金评测集与 `docs/workflow` 交叉引用（规划器内部契约，不把 delta 教给外部 Agent）

---

## 13. 文档

- 本文件：设计规格  
- 交换契约仍以 `docs/workflow/README.md` 为准（实例 JSON）  
- 实现计划：规格审阅通过后 writing-plans 另文
