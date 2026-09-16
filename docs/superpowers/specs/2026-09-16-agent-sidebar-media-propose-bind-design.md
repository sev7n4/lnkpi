# Explore 侧栏参考图绑定 `propose_generation` — 结构门（非扩词）

> 日期：2026-09-16  
> 状态：**已批准**（审阅补丁 SM-D7；2026-09-16）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md)（V2 / §6.0.2 B9）  
> 前置：[2026-09-16-agent-bare-gen-propose-bind-design.md](./2026-09-16-agent-bare-gen-propose-bind-design.md)（#349）、[2026-09-16-sse-tool-call-emit-design.md](./2026-09-16-sse-tool-call-emit-design.md)（#352）、[2026-09-15-agent-sidebar-media-parse-design.md](./2026-09-15-agent-sidebar-media-parse-design.md)  
> 实现 plan：[../plans/2026-09-16-agent-sidebar-media-propose-bind.md](../plans/2026-09-16-agent-sidebar-media-propose-bind.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **SM-D1** | 根因三层叠：① explore 窄写 cull 使试衣句走默认五件套（无 `upsert_media_node` / `propose_generation` / `apply_sidebar_attachments`）；② `@I1/@I2` 是侧栏芯片 key，可见的 `attach_refs` 却要画布节点 id，模型把芯片投影到已有 `image-*`；③ `format_parse_context_block` 要求对未知价格/平台/资质**向用户确认**，识图成功后仍拦 propose。不是视觉失败，不是「穿上」没进词表。 |
| **SM-D2** | **禁止**向 `MEDIA_CREATE_HINTS` / `utterance_binds_media_propose` 加「穿上/换装」等同义词；**禁止**把 `l0_action.TRANSFORM_VERBS` 当本档绑定谓词。身份用侧栏结构；意图用已有负类 + 是否把芯片当生成输入。 |
| **SM-D3** | 规划 / 导入窄集 **一字不改、仍优先**。其后插入 **侧栏媒体窄集**（恰好 4、≤5）：`upsert_media_node` · `apply_sidebar_attachments` · `set_node_prompt` · `propose_generation`。本集 **不含** `attach_refs`、`connect_nodes`。无侧栏图时的裸生成四件套（含 `attach_refs`）**不变**。 |
| **SM-D4** | `apply_sidebar_attachments` 的 `attachments` **可省略**；省略则用 `nest.sidebar_attachments`。模型只传 `node_ids`、`mode=localRefs`（默认）、`mentioned_keys`。不填附件 JSON。 |
| **SM-D5** | 有侧栏参考图且走生成摆盘时：解析块只接地、**不追问**未知商务字段、**不因此推迟 propose**。上架/投放/营销方案/全链路仍可追问（修订 parse 档 D-6 的生成路径，不废 AC-02）。 |
| **SM-D6** | 绑定必要非充分（对齐 BG-D6）：单测锁 bind 集合 + 身份提示；不 mandatory 直调；不改 H8 / V2 P7 脚本；确认前无 `run_*`、无扣费。2d.4 / Phase 3 / CORE 常驻写工具 **未授权**。 |
| **SM-D7** | **隐式全挂只认本轮新上传的图**（解析缓存未命中的 image URL → 对应 `I*`）。侧栏里残留/↺ 复用的图，无 `@` 则 **不**绑侧栏集。禁止用「有 1–2 张附件且非问句」覆盖整段对话——前端每轮重传附件，否则「谢谢」也会 upsert。↺ 无 `@` 的试衣 **不在本 PR**（用户 `@` 即可，金标句已覆盖）。 |

### 金标句（钉死）

评测集 `skills/atomic-create/eval-route-set.yaml` **rt-img2img-01** 原句（两张 image 芯片 + mentioned_keys `I1,I2`）：

> @I1 模特 @I2 产品，让模特穿上，保持构图不变

本句 **不得**靠把「穿上」写入 `MEDIA_CREATE_HINTS` 才为 True。身份信号是 `@I1/@I2` + 两张图。

### 侧栏媒体窄集（钉死，恰好 4 个，≤5）

`upsert_media_node` · `apply_sidebar_attachments` · `set_node_prompt` · `propose_generation`

与裸生成集的唯一差：`apply_sidebar_attachments` **替换** `attach_refs`。

### 非目标

- 向 hint 表 / `TRANSFORM_VERBS` 扩试衣同义词  
- 真出图 / 确认卡 ≡ dock 执行 / 扣费  
- 同会话「重新生成一张」再 propose  
- 2d.4 删 `LEGACY_LANE_SHIM`、Phase 3、扩大默认窄集、mandatory 直调  
- 改 CORE/deferred；把 CORE 写工具塞进 `tool_search`  
- 改 H8、改 V2 裸生成 P7 脚本  
- Chat/explore 多模态 `image_url`（仍遵守 Chat D-7）  
- 前端「复用本轮」摘要重复（另开）  
- ↺ 复用旧图且用户未 `@` 的试衣口语（SM-D7；请 `@I1/@I2`）  
- 本轮生产冒烟新脚本（可后续另开；不阻塞合入单测硬表）

---

## 1. 背景

生产：用户侧栏挂模特图 `@I1`、衣服图 `@I2`，要求试衣且保持一致性。识图摘要正确，explore 只调 `get_canvas_summary` / `get_node`，把 I1/I2 问成画布哪张图，并追问品牌/平台/售价/资质。画布无新 `pending_confirm`。

`utterance_binds_media_propose` 对该句为 False（无「生成一张」类 hint）。默认窄集无媒体写工具。`apply_sidebar_attachments` 虽 CORE，同样被 cull。系统提示规则 4 只写「生成一张 + connect_nodes」；规则 7 只禁「声称只能看到文件名」。

#349 用口语门补了裸生成；本档补的是 **同一 cull 税下的侧栏参考图缺口**，不是新造工具，也不是换装 skill。

`select_narrow_write_tools` 现序：import 锚点 → planner 确认 → planner 口语 → import 弱锚点 → 裸生成媒体集 → 默认。侧栏分支插在 **规划/导入全部之后、裸生成媒体集之前**（有芯片时优先侧栏集，避免仍露出 `attach_refs`）。

---

## 2. 钉死规则

### 2.1 身份：`resolve_sidebar_image_ref_keys`

纯函数，放 `explore_dispatch.py`（或紧邻的 sidebar helper；**不要**把 bind 政策塞进 `atomic_intent.py`）。

输入：

- `image_keys: sequence[str]` — 请求体附件里 `mediaType=image`、url 非空，经 `assign_sidebar_ref_keys` 得到的 `I*`（含 ↺ 复用，只要还在请求体）  
- `this_turn_new_image_keys: sequence[str]` — 上述附件中 **本轮解析缓存未命中** 的 URL 对应 `I*`（与 `uncached_urls` / parse 前置同一口径）。↺ 全命中缓存 → 空。  
- `mentioned_keys: sequence[str]` — **本轮 user_text 的 `@I1` 解析优先**；文本无 `@` 时才用请求体 `sidebar_mentioned_keys`。禁止用上一轮缓存、本轮既无 `@` 也未随请求带上的 keys。explore 传入时不要直接 `resolve_sidebar_mentioned_keys`（那是 state 优先，会把过期提及当成身份）。

输出：`list[str] | None`

| 条件 | 返回 |
|------|------|
| `mentioned` 中的 `I*`（保序、去重）与 `image_keys` 求交后非空 | 该交集（提及了但不在会话里的 key 丢掉） |
| 无 `I*` 提及，且 `set(image_keys) == set(this_turn_new_image_keys)`，且长度为 1 或 2 | `list(image_keys)`（仅「本轮新上传的就这些」才隐式全挂） |
| 无 `I*` 提及，且（混有旧图、或新图 ≥3、或新图为空） | `None`（先问 / 不绑；残留芯片必须 `@`） |
| `image_keys` 空 | `None` |

门槛是 **≥1 张图**，不是 ≥2。一张本轮新图「用这张做主图」与两张新图试衣同一条能力。

**不接受**「侧栏里一直挂着 1–2 张图 + 非问句 ⇒ 每轮 propose」。那不是结构门，是会话污染。

### 2.2 意图：`utterance_binds_sidebar_media_propose(text, ref_keys) -> bool`

`ref_keys` 为空或 `None` → False。

否则 False 当：

- `regen_intent` 或 `regenerate_phrase_intent`  
- 任一 `CAMPAIGN_OVERRIDE_PHRASES` 子串（与 BG-D3 相同，不 import 私有函数）  
- `suspected_vision_qa(text)` 或 `media_directed_question(text)`  
- 非 `suspected_media_create(text)` 且文本含「是什么」或「是啥」（覆盖 `@I1 是什么衣服` / `I1是什么衣服`；**禁止**为此加「衣服/模特」）  

否则 True。

**不**调用 `TRANSFORM_VERBS`。金标句因 `@I1/@I2` 得到 `ref_keys` 且不是识图问句 → True。

识图负例必须 False（可测）：

- `@I1 是什么衣服` / `I1是什么衣服`  
- `看看这张图`（已有 `suspected_vision_qa`）

### 2.3 `select_narrow_write_tools`

签名向后兼容：既有单测仍只传 `utterance`。新增仅关键字参数：

```
select_narrow_write_tools(
    utterance: str,
    *,
    sidebar_image_keys: sequence[str] = (),
    this_turn_new_image_keys: sequence[str] = (),
    mentioned_keys: sequence[str] = (),
) -> frozenset[str]
```

顺序（规划/导入分支 **一字不改**）：

1. import 强锚 / planner 确认 / planner 口语 / import 弱锚 — 现逻辑  
2. `ref_keys = resolve_sidebar_image_ref_keys(...)`；若 `utterance_binds_sidebar_media_propose(text, ref_keys)` → **侧栏媒体窄集**  
3. 若 `utterance_binds_media_propose(text)` → 现有裸生成四件套（含 `attach_refs`）  
4. `_DEFAULT_NARROW_WRITE`

「生成一张」**且**侧栏门为 True → 走步骤 2（侧栏集），不走步骤 3。

### 2.4 `_bind_plan_tools`

explore 在已有 `nest.sidebar_attachments = attachments` 之后，传入本轮 `I*`、`this_turn_new_image_keys`（与 parse 的 `uncached_urls` 对齐）、以及 §2.1 的本轮 `mentioned_keys`。裁剪逻辑本身不改，只因窄集变化而露出侧栏四工具。

**explore.py 内所有 `_bind_plan_tools` 调用点**（首次绑定 ~254、`node_write` 重试 ~290、`tool_search` 加载 deferred 后 ~373）必须传入同一组侧栏 kwargs；否则重试或 rebind 会把侧栏四件套 cull 回默认窄集。

既有 `_bind_plan_tools(llm, tools, loaded, GOLD_BARE_GEN)` 不传侧栏参数必须仍绑裸生成集（P5 回归）。

### 2.5 工具契约：`apply_sidebar_attachments`

`ApplySidebarAttachmentsInput`：

- `attachments: list[dict] \| None = None`（可省略）  
- `mode: str = "localRefs"`（默认；仍允许显式 `attach_edges`，本场景提示只用 localRefs）  
- `mentioned_keys` / `ref_order` 仍可选  

实现（runtime 工具函数 + `NestCanvasClient.apply_sidebar_attachments`）：

1. `atts = attachments if attachments else list(self.sidebar_attachments or [])`  
2. `atts` 空 → 返回错误 dict（不抛到无 SSE），提示没有侧栏附件  
3. POST body 的 `attachments` 用填充后的 `atts`（Nest HTTP 仍收列表，不改 Nest 路由也可）  

工具 description 必须写明：`mentioned_keys` 是 `I1` 这种芯片 key，**不是**画布 `image-*`；`attachments` 可省略。

### 2.6 系统提示

在现有 `_EXPLORE_SYSTEM` 上增量，不另开 skill：

1. **规则 4** 补：有侧栏参考图要出结果图时：`upsert_media_node` **新建**一张图节点（除非用户点名改某 `image-*`）→ `apply_sidebar_attachments`（`mode=localRefs`，`mentioned_keys` 用芯片序）→ 必要时 `set_node_prompt` → `propose_generation`。此路径 **不要** `connect_nodes`，**不要** `attach_refs`。  
2. **规则 6** 补：侧栏参考图生成摆盘时上述 CORE 应已绑定，不要 `tool_search` 找 CORE。  
3. **规则 7** 改为：`@I1/@I2` 是侧栏芯片，**不是**画布节点 id；禁止问「I1 对应画布哪张图」；禁止把芯片映射到已有节点（除非用户明确说改该节点）。不得声称只能看到文件名。  
4. 一致性 = 提示词 + ref 顺序（先身份后衣服/产品），不是再搭工作流。  
5. 侧栏图 ≥3 且用户未 @、或侧栏只有旧图且用户未 @：先问用哪几张（或请 `@I1`），再摆盘。不要对闲聊新建节点。

规划系统提示块仍只在规划窄集时追加，本档不改 `_PLANNER_SYSTEM`。

### 2.7 解析块：生成路径不追问

`format_parse_context_block(parse, *, ask_unknown: bool = False)`：

- `ask_unknown=False`（默认）：保留摘要/品类接地；**删除或改写**「图中未出现的价格/平台/资质不要编，改为向用户确认」。改为：未知商务字段勿编造，**不要向用户追问，不要因此推迟 propose / 摆盘**。`unknown` 非空也 **不得**拼 `待确认项` 行。既有 `test_context_block_forbids_filename_copout` 随默认值更新，另测 `ask_unknown=True` 仍含追问。  
- `ask_unknown=True`：保持今日文案（上架 AC-02）。  

explore 注入时：`ask_unknown=True` 当且仅当 utterance 含子串 `上架` / `投放` / `营销方案` / `全链路` / `详情页`（闭集，不扩 `MEDIA_CREATE_HINTS`）。金标试衣句必须 False。

识图失败仍走既有 `_PARSE_FAIL_NO_EMPTY_LISTING`（禁止空上架框架）。

修订关系：本档收窄 parse 规格 **D-6** 的生成路径；**不**废止上架方案追问。

### 2.8 测试

主要文件 `tests/test_explore_narrow_bind.py`（追加，既有 P1–P5 / planner / import **必须仍绿**）。

| 测 | 断言 |
|----|------|
| 金标句 + `sidebar_image_keys=("I1","I2")` + `mentioned_keys=("I1","I2")` | 集合 = 侧栏四件套；含 `apply_sidebar_attachments`；**不含** `attach_refs` / `connect_nodes`（即使 `this_turn_new` 为空，@ 仍绑） |
| 金标句 **不**传侧栏参数 | 仍 **不是**侧栏集（无芯片则不得靠「穿上」误绑）；与今日 `utterance_binds_media_propose` 一致（False → 默认五件套） |
| 两张 **本轮新图**、无 @、口语「让模特穿上这件衣服」 | `this_turn_new_image_keys==image_keys==("I1","I2")` → 侧栏四件套 |
| 两张 **旧图/↺**、无 @、同一口语 | **不是**侧栏集（SM-D7） |
| 三张图、无 @ | **不是**侧栏集；无 propose |
| 「谢谢」+ 两张旧图、无 @ | **不是**侧栏集 |
| `@I1 是什么衣服` + 图 | **无** propose / upsert_media_node |
| `看看这张海报` / `重新生成一张` / 金标 +「营销方案」 | 回归：无媒体 propose 集 |
| planner 口语 + 两张图 | 仍规划三件套 |
| 裸生成金标、无芯片 | 仍裸生成四件套（P1） |
| `_bind_plan_tools` 传入金标试衣 + keys | visible 含 upsert / apply_sidebar / propose；不含 attach_refs |

另：`tests/test_explore_tools.py` 或新小测：省略 `attachments` 时工具走 `nest.sidebar_attachments`；空附件返回错误且不抛。  
`tests/test_sidebar_media_parse_ac.py`（或 parse helper 单测）：试衣句 `ask_unknown=False` 的块 **不含**「向用户确认」/「待确认项」；上架句 True 仍含追问。

**禁止修改：** `deploy/prod-phase-2d3-h8-verify.py`、`deploy/prod-phase-v2-bare-gen-verify.py`。

---

## 3. 验收硬表

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **S1** | 金标句 + I1/I2 芯片 | `select_narrow_write_tools` = 侧栏四件套 |
| **S2** | 金标句无芯片参数 | 不因「穿上」绑媒体集 |
| **S3** | 隐式两张**新**图、无 @、非问句 | 侧栏四件套 |
| **S3b** | 两张旧图/↺、无 @ | 不绑侧栏集 |
| **S4** | 三张图无 @ | 不绑侧栏集 |
| **S5** | `@I1 是什么衣服` | 无 upsert/propose |
| **S6** | planner + 芯片 | 规划窄集不变 |
| **S7** | 裸生成 P1–P5 / import | 全绿 |
| **S8** | 省略 attachments | 使用 nest 侧栏列表 |
| **S9** | 试衣解析块 | 不追问商务未知项 |
| **S10** | `build_tool_plan` | 仍无 `run_*` visible |
| **P7** | 生产 V2 裸生成脚本 | **一字不改**仍绿 |

生产试衣复测（**不**做合入门禁）：金标句 → `canvas_agent`；SSE 含 upsert → apply_sidebar_attachments → propose；新节点 `pending_confirm`；不改已有 `image-*`；无 `run_*`。失败则按 BG-D6：bind 绿而无 tool_call 再开 prompt/模型，本 PR 不 mandatory。

---

## 4. 回滚

去掉侧栏分支与 `attachments` 可选即可回到 #349 行为（裸生成仍通、试衣仍确认舞）。不恢复 `run_*` visible。H8 / V2 脚本不受影响。

---

## 5. 后续（未授权）

- CORE 写工具对 `canvas_agent` 常驻，窄绑只留规划/导入互斥（终局还债，消灭下一场场景门）  
- 试衣生产冒烟脚本  
- regen 同会话 propose；确认后真出图  
- 前端复用摘要重复  

---

## 6. 自检（写档时）

- [x] 无 TBD 阻塞合入门禁；plan 预留、本档不实施  
- [x] 未把「穿上/换装」写入 `MEDIA_CREATE_HINTS`；未把 `TRANSFORM_VERBS` 当 bind 谓词  
- [x] 两层门、侧栏四件套替换 `attach_refs`、attachments 服务端填充、解析块不拦 propose、隐式全挂仅本轮新图（SM-D7）均已钉死  
- [x] 原档「旧图+闲聊可误绑」已否决，不再列为可接受残差  
- [x] 规划/导入优先；裸生成四件套与 H8/V2 不变  
- [x] 未滑入 2d.4 / Phase 3 / mandatory / 默认窄集扩大  
- [x] 金标句唯一，且与 eval rt-img2img-01 对齐  
