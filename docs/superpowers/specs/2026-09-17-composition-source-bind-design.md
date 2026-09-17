# 构图源图绑定 / 近重复替换

> 日期：2026-09-17  
> 状态：**待审阅**（切片规格；已吸收 2026-09-17 PM 审阅补丁）  
> 产品：超创平台（lnkpi）无限画布 / Agent 侧栏构图  
> 父规格：[2026-09-16-generic-canvas-compose-design.md](./2026-09-16-generic-canvas-compose-design.md)  
> 问题清单：[2026-09-17-composition-land-production-gaps.md](./2026-09-17-composition-land-production-gaps.md) **P0 ×2**  
> 生产对照：[`cmu4kmyy6000fo301p08o6zjn`](http://119.29.173.89:8888/workflow/cmu4kmyy6000fo301p08o6zjn)  
> 本刀 **只**修：源节点必须带上 `@I*` 图；同一换装槽位再次确认不得叠第二套空树。

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **B1** | 换装构图（`identityRef` + `garmentRefs.length≥1`）的每个 `image-src-*` **必须**有可生成的图：`localRefs[].url`（或 import 后节点上等价的媒体 url）。空壳 `imageVersions: [{source:'upload'}]` 且无 url = 失败。 |
| **B2** | 绑定源 **只有** 两条，禁止扫画布：① 本轮 `preview-composition` 的 `attachments`；② 本线程侧栏快照（与识图/parse **同一份** URL 列表，含 `↺ 复用本轮`）。**禁止**按 completed 节点时间序或「I{n} 对画布第 n 张图」补齐（会把 H8 产品图认成模特）。有 `label` / `refKey` / 芯片 key 时按 `I2`→`I2`；没有再回退下标。 |
| **B3** | 任一必填 `I*` 绑不上：**不得**出现「请确认是否把构图落到画布」；**不得**写入可 confirm 的 `dumpHash`；**必须作废**会话里上一份可 confirm 的 `compositionPreview`（null 或去掉 hash）；explore **不得**再带上一轮 `composition_dump_hash`。历史气泡再点确认 → 现网 `请先确认构图，再落到画布。` 不 import。可写 `compositionPending` 续跑。 |
| **B4** | 槽位键 `slotKey` = `identityRef` + 排序后的 `garmentRefs` + `skipI0`。**不含** `wantVideo`、不含 copy、不含 dump 全文。 |
| **B5** | 确认：同 `dumpHash` → G12 幂等。不同 hash、**同 slotKey**、且已有 `lastAddedNodeIds` → **替换**（删上一套新增节点及只属于它们的边，再 import）。不同 slotKey → G11 叠加。替换会丢掉用户在上一套空壳上的手改，本刀接受。 |
| **B6** | 不出「替换上一套 / 再叠加」chip。第二套换装必须换 `I*` 指派。 |
| **B7** | 路由、空写集、确认前不 `propose` / 不 `run_*` / 不扣点：**不改**。不手搭、不扩词。 |
| **B8** | **不做**：确认后一键运行组、识图 cap/复读、P/look「两套」copy、HITL 人话改写、脏画布自动清空、扫画布绑图。 |
| **B9** | 金标 1 **补全** G4（`localRefs=@I1`），不是改金标句。现网「preview 无 attachments 仍出确认句」测例 **废止**；金标 1 的 preview/confirm **必须**带 I1–I3 有 url 的附件才算绿。无附件那条改走 E-B2。 |

金标句 1 仍要绿（有附件）。生产口语（`这个是模特` / `这几个是服装` / 四件衣服）作表征用例，不改路由。

---

## 1. 为什么是这一刀

Nest `preview(..., attachments)` **已经会**把 url 打到 `image-src-*`。生产空壳是 **预览没收到与芯片同源的附件**（`↺ 复用本轮` 易只复用摘要），或 import 丢掉 `localRefs`。G12 只对 dump 全文 hash 幂等，空树与加了 `wantVideo` 的树 hash 不同，于是叠了两棵。

本刀把「能确认」和「能替换」收到服务端。不扫画布、不赌模型、不改构图代数。

---

## 2. 绑定

### 2.1 必填集

- 换装：`identityRef` + 每一个 `garmentRefs`。
- 金标 2：`identityRef` + `otherRefs` 里用到的 `I*`（同一套「有指派的 I* 必须有 url」）。

### 2.2 管道（侧栏芯片，不扫画布）

1. utterance 含 `@I*` 或 `I1` 指派时，`preview_composition` **显式**带 `attachments`（空数组也要带，便于测失败）。
2. **同源：** parse 用过的 URL 必须出现在这份列表里。`↺ 复用本轮` 必须复用 **附件列表**，不能只复用「根据参考图：…」摘要。只有摘要没有 url → B3。
3. 对齐：先芯片 key（`I2` 对 label/refKey/`@I2`），否则下标。`mediaType` / `media_type` 都认。无 `id` 且无 `url` 的槽失败。
4. Body 为空但 **runtime 线程状态**里仍有芯片 url（与 parse 同源）→ 预览必须带上并绑定（E-B2b）。这不是读 canvas 节点。
5. `importWorkflow` 保留源节点 `localRefs`（含 `url`）。confirm 后前端源节点不是「上传图片」空壳。

### 2.3 失败文案与识图前缀

稳定可测，例如：`参考图还没挂到构图上。请确认侧栏 @I1 起仍在本轮，或先把图加入 Agent 引用。`  
**禁止**出现「请确认是否把构图落到画布」。

本刀 **不**改 `prefix_assistant_reply`。绑失败时用户仍可能先看到「根据参考图：…」再看到失败句；只要全文不含确认句即可。不要把识图摘要当成绑定成功。

### 2.4 作废旧 persist

B3 时：

- `compositionPreview` 去掉可 confirm 的 `hash`/`dump`（整段 null，或保留 pending 但不含可 import dump）。
- 本轮 assistant kwargs **不得**带 `composition_dump_hash`。
- 历史「确认落到画布」chip 再点 → `请先确认构图，再落到画布。`，`importWorkflow` 次数不增加。

---

## 3. 近重复 / 替换

### 3.1 slotKey

```text
slotKey = `${identityRef ?? ''}::${garmentRefs.slice().sort().join(',')}::${skipI0 ? '1' : '0'}`
```

与 dump/hash/primitives 一起写入 `compositionPreview`。成功 import 后更新 `lastImportedSlotKey`、`lastAddedNodeIds`、`lastImportedHash`。

不含 `wantVideo`：先落无 P+V、再说「含一键生图生视频」→ 替换成带 P+V 的同一槽位树。

### 3.2 confirm

| 条件 | 行为 |
|------|------|
| persist 缺失 / hash 对不上当前 preview | `请先确认构图，再落到画布。` |
| `preview.lastImportedHash === dumpHash` | G12 幂等，不 import |
| `preview.lastImportedSlotKey === slotKey` 且已有 `lastAddedNodeIds` | 删除这些节点 + 两端都在删除集内的边，再 import；更新 last*。上一套上的手改一并丢掉。 |
| 否则 | G11 叠加 import |

只删上一套构图新增 id，不动 H8 产品图、用户原图。成功回复仍可用 `已按构图落到画布。`

### 3.3 不做的交互

不出「替换 / 叠加」双 chip。换了服装集合 → 新 slotKey → 叠加。

---

## 4. 抽取表征（小锁）

`@I1 这个是模特， @I2 @I3 @I4 @I5 这几个是服装` → `identityRef=I1`，`garmentRefs=[I2,I3,I4,I5]`。已绿则只加测；红了再修正则。**不**把单字「换装」变成结构意图。

---

## 5. 硬表

| # | 输入 | 期望 |
|---|------|------|
| **E-B1** | 金标 1 + I1/I2/I3 有 url 的 attachments | 有确认句；三源节点有 url；confirm 后非空壳 |
| **E-B2** | 金标 1 + 无 attachments + 线程状态也无芯片 url | **无**确认句；persist **不可** confirm；不 import |
| **E-B2b** | 金标 1 + HTTP body attachments 空，**runtime 状态**有 I1–I3 芯片 url | 与 E-B1 相同（预览必须把状态里的附件送进 Nest） |
| **E-B3** | E-B1 后同一 hash confirm 两次 | import **1** 次 |
| **E-B4** | 同槽位两句两次 preview+confirm，第二次附件齐全 | **一套**换装树（可含 P+V）；不并排两套 I0 |
| **E-B5** | 生产口语 + 五张 attachments（按芯片 key） | I1+I2–I5 五源节点都有 url |
| **E-B6** | E-B1 后再确认 **不同** identity（如 I6 模特） | 允许叠加；旧树仍在 |
| **E-B7** | 确认前 / 本句 | 无 `run_*`、无 `propose_generation`、无 instantiate |
| **E-B8** | 先留下一份可 confirm persist，再走绑失败 | 回复无确认句；点历史「确认落到画布」→ persist_missing；不 import |
| **金标 1 测例** | preview/confirm **必须**带 I1–I3 附件 | 无附件不得再断言确认句 |

生产复测：**新画布**（勿复用 H8 session）+ 侧栏真实图 → 源节点看得见；近重复再确认 → 仍一套树。`↺ 复用本轮` 后再说结构口令：有芯片 url 才能出确认卡。

---

## 6. 实现落点（plan 再拆）

- `packages/shared`：slotKey；按芯片 key 映射 attachments；lint「换装 src 必须有 localRefs.url」
- `apps/server` `composition.service`：绑失败短路 + **作废 persist**；`lastImportedSlotKey`；confirm 替换删除
- `apps/server` `importWorkflow`：src `localRefs` 进 canvas
- `services/agent-runtime`：preview **总是**带附件（空也带）；复用本轮带 URL 列表；绑失败清 dump hash kwargs
- 测试：E-B1–E-B8；**改写**无附件的金标 1 preview 测例

编译仍只在 shared + Nest。

---

## 7. 明确不做

- Dock 一键运行组 / 按节点 HITL propose
- `MAX_PARSE_IMAGE_URLS`、去掉识图复读、改 `prefix_assistant_reply`
- 改 `P_SKELETON_PROMPT`；改 HITL 摘要人话
- 自动清空脏画布；按画布 completed 图猜 I*
- 19 工具 / `run_*` / 扩词 / 手搭换装边表
