# 构图落盘生产缺口（换装 HITL）

> 日期：2026-09-17  
> 状态：**问题清单**（记录生产复现；**不是**下一刀已批准设计）  
> 产品：超创平台（lnkpi）无限画布 / Agent 侧栏构图  
> 父规格：[2026-09-16-generic-canvas-compose-design.md](./2026-09-16-generic-canvas-compose-design.md)  
> 对照：[2026-09-16-canvas-operator-2e-design.md](./2026-09-16-canvas-operator-2e-design.md)（2e.3 口语搭骨架 ≠ 本清单；构图口令仍走 #355 HTTP）  
> 生产会话：[`cmu4kmyy6000fo301p08o6zjn`](http://119.29.173.89:8888/workflow/cmu4kmyy6000fo301p08o6zjn)（画布标题 `h8-2d3-bare-3e4767`）

本文只钉「看见了什么、哪条规格仍成立、下一刀不该碰什么」。P0 切片规格：[2026-09-17-composition-source-bind-design.md](./2026-09-17-composition-source-bind-design.md)（待审阅）。

---

## 0. 结论（先读）

用户句：

> @I1 这个是模特， @I2 @I3 @I4 @I5 这几个是服装，请帮我设计一套模特换装工作流方案，含一键生图生视频

**构图路由是对的**：`设计` + `工作流` → `is_composition_structure_utterance` → Nest preview/confirm、空写集、确认前不 `propose` / 不 `run_*` / 不扣点。不要改回 2e.3 `upsert`+`connect` 手搭，也不要把「换装」扩进 `MEDIA_CREATE_HINTS`。

**产品失败在交卷**：侧栏图没写进构图源节点；确认三次叠出两套空骨架；确认后没有一键运行组；识图 4 次复读且丢掉第 5 张；P/look copy 仍按「两套」写死。

---

## 1. 复现与证据

| 项 | 值 |
|----|-----|
| 会话 | `cmu4kmyy6000fo301p08o6zjn` |
| 画布标题 | `h8-2d3-bare-3e4767`（H8 复测会话被接着用） |
| 侧栏轨迹 | 同一指派说过 **3** 遍（「工作流」/「工作流方案」/「含一键生图生视频」），确认 **3** 次 |
| 落盘 | **30** 节点 / **24** 边（2026-09-17 读取） |
| 构图批次 | `1789607481352`（I0+4 look，无 P+V）；`1789607656247`（I0+4 look+P+V） |
| 源节点 | 如 `image-1789607656247-39`（模特源图）、`-41`（服装图）：`prompt=""`，`imageVersions: [{source:'upload'}]`，**无 `url` / `localRefs`** |
| 造型 | `mentionedKeys` 指向上述空壳；`status=draft`；look prompt 全是同一句商业换装骨架 |
| P | `同一人按两套造型顺序切换的 lookbook，非剧情片。`（四套服装仍写两套） |
| V | `prompt=""`，`genMode=v_ref`，refs = I0 + 4 looks |
| 左侧孤儿 | H8 蓝天产品图 + 用户 5 张参考图（有像素），**未连进**右侧构图 |

首轮 HITL 摘要形态（与编译器 `summarizeCompositionDump` 同构）：

```
请确认是否把构图落到画布
新建白底三视图
服装扇出 4
P+V
保留 18
新增 7
生成请用 Dock 生成工作流
```

确认后回复常量：`已按构图落到画布。`（`COMPOSITION_LANDED_REPLY`）

识图前缀（四段相同，`;` 拼接）：「一位长发女模特的全身照，另加**三套**白底平铺服装…」（I1–I5 五张，解析 cap=4，丢掉 I5）。

---

## 2. 不是问题（保持）

| 现象 | 规格 | 不要做 |
|------|------|--------|
| 进构图、不出 `run_*`、确认前不扣点 | 构图 G1 / G13 / 金标 1.1 条 5 | 不要改回手搭九件套 |
| 短句「换装」不构图；「设计+工作流」才构图 | 构图 §1.3 | 不要扩词进 `MEDIA_CREATE_HINTS` |
| 确认前不 `propose_generation` | 金标 1.1 条 2；2e 构图口令空写集 | 不要 mandatory propose |
| 服装 ≤4 扇出 | `MAX_GARMENTS=4` | 4 套扇出本身正确 |
| `@I*` 不是 canvas 边 | 2e 挂参分工 | 不要 `connect_nodes` 连芯片 |

「待我确认后再做生图生视频」= 时机不生成 + 模态含图和视频。用户本句的「含一键生图生视频」是**确认后的一键**，不是确认前出图。

---

## 3. 问题清单

### P0 — 参考图没有进构图源节点

**现象：** 用户已 `@I1–I5`，左侧也有带像素的参考图；右侧构图源节点是「上传图片」空壳。I0 / look / V 的 i2i 锚在空图上，Dock 无法换装。

**规格缺口：** G4 用户指派应落到源节点 `localRefs`。`expandComposition(..., localRefsByRefFromSidebarAttachments)` 在生产 dump 上未写出绑定（preview 未带上 attachments，或 import 丢掉 `localRefs`）。G6「建 I0」不是「再建一套没图的 I1 空壳」。

**验收（修复后）：** 模特源图 / 各服装源图带本轮 `@I*` 的 url（或明确复用画布已有原图 id）；没有 `localRefs` **不得**出「确认落到画布」。

### P0 — 近重复确认叠加第二套空工作流

**现象：** 三句几乎同一指派、三次确认；画布上两套平行骨架。G12 同 hash 才幂等；改了「方案 / 含一键生图生视频」即新 hash → G11 叠加。

**规格缺口：** 未定义「同一会话、槽位未变（identity / garments / wantVideo）再次确认」是替换、拒绝，还是询问。脏画布「保留 18」放大了失败。

**验收：** 槽位未变的再次确认不新增第二套 I0+looks；HITL 能区分替换 / 叠加。

### P1 — 「一键生图生视频」被实现成「请用 Dock」

**现象：** 确认后只有「已按构图落到画布。」摘要常量「生成请用 Dock 生成工作流」。无运行组提示、无生成顺序、无 HITL 出图卡。G11「运行组 = 本次生成类新增节点」和金标「确认再一键生成」未交付到对话。

**约束：** 仍禁止 `run_*`、禁止静默扣点、禁止确认前 `propose`。一键 = 选中本次运行组走 Dock（或按节点 HITL），P 不进队列（G7）。

### P1 — 识图 cap=4 且四次复读

**现象：** `MAX_PARSE_IMAGE_URLS = 4` 丢掉 `@I5`；四段相同「模特+三套服装」。识图未按张描述，对用户是噪音，也没写入各 look prompt。

**约束：** 识图不得改谁是模特/服装（G4）。失败时保留指派，不要把同一段 holistc 文案粘 n 遍。

### P1 — Copy 按金标两套写死

**现象：** `P_SKELETON_PROMPT` / `P_CLAUSES` 钉「两套造型」。四件衣服扇出 4 look，P 仍说两套；look 全是 `LOOK_SKELETON_PROMPT`；V `prompt` 空（生成时读 P，而 P 件数错）。

**验收：** P/look 随 `garmentRefs.length` 渲染；禁止 4 套时仍写「两套」。

### P2 — HITL 是机读 dump 摘要

**现象：** 「新建白底三视图 / 服装扇出 4 / P+V / 保留 18 / 新增 7」+ 370ms「执行过程 5 步」。没有「I1→I0→四套造型→P→V」人话，也没解释为何不马上生。

### P2 — 脏会话 / 评测卫生

**现象：** 构图金标跑在 H8 蓝天产品画布上。产品应新画布或询问清空；评测不得复用 H8/V2 harness session。

---

## 4. 建议切片顺序（未批准）

只作 backlog。刀 1 规格已写，待审阅后再 plan。

| 顺序 | 刀 | 做 | 不做 |
|------|----|----|------|
| **1** | 源图绑定 + 同槽位替换 | 见 [source-bind 规格](./2026-09-17-composition-source-bind-design.md)：无绑定不出确认卡；同 slotKey 替换上一套 | 不改路由；不手搭；不扩词；本刀不问「替换/叠加」chip |
| **2** | 确认后一键运行组 | 本次新增可生成节点排队（I0→looks→V，P 排除）；Dock 或按节点 HITL | 不 `run_*`；不确认前 propose；不静默扣点 |
| **3** | 识图与 copy | 按 `@I*` 逐张，cap 与 `MAX_GARMENTS` 对齐；P/look 随件数 | 识图改指派；holistic 复读当成功 |

---

## 5. 硬禁止（沿用父规格）

- 不把「穿上 / 换装 / 工作流 / 分镜 / 搭骨架」扩进 `MEDIA_CREATE_HINTS`
- 不用 2e.3 `upsert_media_node`×n + `connect_nodes` 顶替换装展开代数
- 不把 `import_workflow` / `instantiate_workflow_template` 当本句绿
- 不 mandatory `propose`；Agent 不可见 `run_*`
- 不把本清单当已批准设计；无切片规格不得开工（刀 1 见 source-bind 规格）
