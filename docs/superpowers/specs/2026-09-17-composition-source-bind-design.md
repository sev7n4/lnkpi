# 构图源图绑定 / 近重复替换

> 日期：2026-09-17  
> 状态：**待审阅**（切片规格；父规格决策不变）  
> 产品：超创平台（lnkpi）无限画布 / Agent 侧栏构图  
> 父规格：[2026-09-16-generic-canvas-compose-design.md](./2026-09-16-generic-canvas-compose-design.md)  
> 问题清单：[2026-09-17-composition-land-production-gaps.md](./2026-09-17-composition-land-production-gaps.md) **P0 ×2**  
> 生产对照：[`cmu4kmyy6000fo301p08o6zjn`](http://119.29.173.89:8888/workflow/cmu4kmyy6000fo301p08o6zjn)  
> 本刀 **只**修：源节点必须带上 `@I*` 图；同一换装槽位再次确认不得叠第二套空树。

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **B1** | 换装构图（`identityRef` + `garmentRefs.length≥1`）的每个 `image-src-*` **必须**有可生成的图：`localRefs[].url`（或与 import 后节点等价的媒体 url）。空壳 `imageVersions: [{source:'upload'}]` 且无 url = 失败。 |
| **B2** | 绑定序：① 本轮 `preview-composition` 的 `attachments`（`I1`=第 1 张图附件，与现网 `localRefsByRefFromSidebarAttachments` 一致）；② 若某 `@I*` 仍缺 url，从**本会话已 introduce 到 Agent 的芯片图**补（画布节点带 url、且能对应芯片序）。**禁止**把无芯片的残留生成图（如 H8 蓝天产品）当模特/服装。 |
| **B3** | 任一必填 `I*` 绑不上：**不得**出现「请确认是否把构图落到画布」，**不得**写入可 confirm 的 `dumpHash`。回复说明参考图没挂上（可点侧栏芯片或「加入 Agent 引用」后再说一次）。走 extract_incomplete 同级：可写 `compositionPending` 续跑，不 import。 |
| **B4** | 槽位键 `slotKey` = `identityRef` + 排序后的 `garmentRefs` + `skipI0`。**不含** `wantVideo`、不含 copy、不含 dump 全文。话术从「工作流」改成「工作流方案 / 含一键生图生视频」仍是同一槽。 |
| **B5** | 确认：同 `dumpHash` → 现网 G12 幂等。不同 hash、**同 slotKey**、且已有 `lastAddedNodeIds` → **替换**：删掉上一套新增节点及只属于它们的边，再 import 新 dump。不同 slotKey → 仍 G11 叠加。 |
| **B6** | 本刀 **不出**「替换上一套 / 再叠加」chip。用户要第二套换装必须换 `I*` 指派（换模特或换服装集合）。 |
| **B7** | 路由、空写集、确认前不 `propose` / 不 `run_*` / 不扣点：**不改**。不用 2e.3 手搭。不扩 `MEDIA_CREATE_HINTS`。 |
| **B8** | **不做**本刀：确认后一键运行组、识图 cap/复读、P/look「两套」copy、HITL 人话改写、脏画布自动清空。 |

金标句 1 仍要绿，且源节点必须带上 `@I1/@I2/@I3` 的 url。生产口语（`这个是模特` / `这几个是服装` / 四件衣服）作为本刀表征用例，不改成另一条路由。

---

## 1. 为什么是这一刀

Nest `preview(..., attachments)` **已经会**把 url 打到 `image-src-*`（`composition.service.test.ts`「stamps sidebar image localRefs」）。生产空壳说明 **HTTP 预览没收到附件**，或 confirm import 丢掉了 `localRefs`。同时 G12 只对 **dump 全文 hash** 幂等，空 dump 与「加了 wantVideo 的 dump」hash 不同，于是叠了两棵树。

本刀把「能确认」和「能替换」收到服务端，不赌模型、不改构图代数。

---

## 2. 绑定

### 2.1 必填集

- 换装：`identityRef` + 每一个 `garmentRefs`。
- 金标 2（产品序列、无服装）：`identityRef` + `otherRefs` 里用到的 `I*`。本刀换装优先；金标 2 走同一套「有指派的 I* 必须有 url」，避免只修换装、产品构图继续空壳。

### 2.2 attachments 管道（先修现网）

`explore` 在 `preview_composition` 前已 `nest.sidebar_attachments = state.sidebar_attachments`。本刀要求：

1. `preview_composition` **只要** utterance 含 `@I*` 或 `I1` 指派，就把当前 attachments 放进 body（包括空数组也要显式带上，便于测「空则失败」）。
2. Runtime 的 attachments 与本轮识图 URL **同源**。出现「根据参考图：…」但 attachments 为空 → 按 B3 失败，不得出确认卡。
3. Nest `localRefsByRefFromSidebarAttachments` 继续按附件下标对 `I1…`；`mediaType` / `media_type` 都认。`attachmentToLocalRef` 无 `id` 且无 `url` 则该槽失败。
4. `importWorkflow` 必须保留源节点 `localRefs`（含 `url`）。表征：confirm 后 session canvas 上对应源节点仍有 url / localRefs，前端不是「上传图片」空壳。

### 2.3 芯片补齐（attachments 不足时）

仅当 attachments 对某 `I*` 缺 url：在 **本 session canvas** 找「已作为 Agent 芯片引入」的图（`introduce_nodes` / 加入 Agent 引用产生的附件 id 能对上的节点，或节点 `data` 能对应 `I{n}` 序且有媒体 url）。对不上则该 `I*` 失败，不猜 H8 产品图。

本刀 **不**把「画布上任意 completed 图」按时间排序填进 I*。

### 2.4 失败文案

中文一句，稳定可测，例如：`参考图还没挂到构图上。请确认侧栏 @I1 起仍在本轮，或先把图加入 Agent 引用。`  
**禁止**出现「请确认是否把构图落到画布」。前端 chip 检测依赖该句，去掉即无确认按钮。

---

## 3. 近重复 / 替换

### 3.1 slotKey

```text
slotKey = `${identityRef ?? ''}::${garmentRefs.slice().sort().join(',')}::${skipI0 ? '1' : '0'}`
```

写入 `compositionPreview`（与 dump/hash/primitives 一起）。`lastImportedSlotKey` 与 `lastAddedNodeIds` 一并在成功 import 后更新。

不含 `wantVideo`：用户先落无 P+V 的树、再说「含一键生图生视频」，第二次确认 **替换** 成带 P+V 的同一槽位树，而不是并排第二套 I0+looks。

### 3.2 confirm

| 条件 | 行为 |
|------|------|
| persist 缺失 / hash 对不上当前 preview | 现网 `请先确认构图，再落到画布。` |
| `preview.lastImportedHash === dumpHash` | G12 幂等，不 import |
| `preview.lastImportedSlotKey === slotKey` 且已有 `lastAddedNodeIds` | 删除这些节点 + 两端都在删除集内的边，再 import 新 dump；更新 last* |
| 否则 | G11 叠加 import |

删除必须 **只**动上一套构图新增 id，不动会话里其它节点（H8 产品图、用户原图）。

幂等 / 替换成功后回复仍可用 `已按构图落到画布。` 本刀不改人话。

### 3.3 不做的交互

不出「替换 / 叠加」双 chip。明确「再来一套」且换了服装集合 → 新 slotKey → 叠加（现网 G11）。

---

## 4. 抽取表征（小锁，不另开刀）

生产句 `@I1 这个是模特， @I2 @I3 @I4 @I5 这几个是服装` 必须抽出 `identityRef=I1`、`garmentRefs=[I2,I3,I4,I5]`。若现网已绿，只加单测钉死；若红，本刀修 `findIdentityRef` / `findGarmentRefs`（允许「这个是模特」「这几个是服装」），**不**把单字「换装」变成结构意图。

---

## 5. 硬表

| # | 输入 | 期望 |
|---|------|------|
| **E-B1** | 金标 1 + 3 张图 attachments（I1/I2/I3 有 url） | preview 含确认句；`image-src-I1/I2/I3` 有 url；confirm 后 canvas 源节点非空壳 |
| **E-B2** | 金标 1 + **无** attachments + 画布也无对应芯片图 | **无**确认句；无 dumpHash（或不写入可 confirm persist）；不 import |
| **E-B2b** | 金标 1 + HTTP attachments 空，但本会话已 introduce I1–I3 且节点有 url | 与 E-B1 相同：可确认；源节点有 url |
| **E-B3** | 金标 1 + attachments 后 confirm 两次 **同一 hash** | import **1** 次（现网幂等） |
| **E-B4** | 同槽位两句（「设计…工作流」再「…方案，含一键生图生视频」）两次 preview+confirm，且第二次 attachments 齐全 | canvas 上 **一套** 换装树（可含 P+V）；`lastAddedNodeIds` 被替换，不并排两套 I0 |
| **E-B5** | 生产口语 `@I1 这个是模特…@I5 这几个是服装` + 五张 attachments | identity+四件服装；五源节点都有 url |
| **E-B6** | E-B1 之后再来 **不同** identity（如 I6 模特）构图确认 | 允许叠加；旧树仍在 |
| **E-B7** | 确认前 / 本句 | 无 `run_*`、无 `propose_generation`、无 instantiate |

生产复测（部署后，**新画布**，勿复用 H8 session）：金标口语或生产口语 + 真实侧栏图 → 源节点看得见图；再说一次近重复句并确认 → 仍一套树。

---

## 6. 实现落点（plan 再拆任务）

- `packages/shared`：slotKey 纯函数；可选 lint「换装 src 必须有 localRefs.url」
- `apps/server` `composition.service`：preview 绑失败短路；persist `slotKey` / `lastImportedSlotKey`；confirm 替换删除
- `apps/server` `importWorkflow`：断言 src `localRefs` 进 canvas
- `services/agent-runtime` `nest_client.preview_composition` + explore：attachments 必带；绑失败文案原样出侧栏（无确认句）
- 测试：上表 E-B1–E-B7；金标 1 不回归空写集

编译仍只在 shared + Nest。runtime 不重写展开器。

---

## 7. 明确不做

- Dock 一键运行组 / 按节点 HITL propose（清单 P1，下一刀）
- `MAX_PARSE_IMAGE_URLS`、识图去复读
- 改 `P_SKELETON_PROMPT` 两套常量
- 改 HITL 摘要人话
- 自动清空脏画布
- 19 工具 / `run_*` / 扩词 / 手搭换装边表
