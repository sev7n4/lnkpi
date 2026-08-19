# 画布图像精修（Cx-image-edit P1）Design

**Date:** 2026-08-18  
**Status:** Approved, plan in 2026-08-18-cx-image-edit.md  
**代号:** **CX-IMAGE-EDIT**  
**Related:**
- `2026-08-08-image-upstream-capability-design.md` §7 / §13.2（生成 vs 编辑边界；本文件落地其独立规格）
- `2026-07-19-dock-studio-model-adapter-design.md`（C1 生成适配层；精修**不**扩展 `ImageProvider.generate()`）
- `2026-08-15-media-inspector-design.md`（Inspector 只读；版本回看可挂 L1，P1 以精修面板内版本条为准）
- `2026-08-19-cx-image-edit-sidepanel-design.md` — **覆盖本文件入口布局、mask 表面、对照形态**（含重叠滑竿提前到本轮；上下擦除 / 溶解 / 闪光仍为后续）。作业、积分、EditProvider、合成、版本链仍以本文件为准
- 现有入口：`AIImageEditor.vue`、节点「编辑图像」、`open_image_editor`

---

## Goal

用户对**画布上已有图片节点**做局部精修：圈选要改的区域，用一句话说明改什么（去污渍 / 换局部内容），对照确认后写回**同一节点**的新版本。mask 外像素必须保持原图。

P1 交付的是可扩展的**精修工作台**（选区 + 指令 + 对照 + 写回），不是一次性对话框。智能选区、抠图作为后续工具槽，不进本轮。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| P1 作业 | **A+B 同一套 UX**：去污渍瑕疵 **和** 替换局部内容（文字 / 颜色 / 服饰）。都是 mask + 指令；mask 外保真 |
| 写回 | **同节点版本链**。不新建旁路节点。Inspector / 精修面板可回退 |
| 对照 | 面板内 **左右 Before / After** 为默认；按住查看原图；应用后可对比版本 N ↔ N+1。Wipe 滑杆 = P2 |
| 形态 | **可扩展工具链**。P1 = 手动画选区 + 指令 + 对照 + 写回。P2 智能选区、P3 抠图以工具槽接入 |
| 入口布局 | **方案 2：Dock 工作台**。**选中图片节点不得打开精修**；默认仍是底部生成 Studio Dock |
| 打开精修 | 仅显式入口：节点「编辑图像」、右键「编辑图像」、Agent `open_image_editor`、生成 Dock 上的次要按钮「精修这张图」 |
| 关闭精修 | 无进行中任务时：点关闭、切回生成、改选其他节点 → 收起。精修请求进行中禁止切走，只能「取消精修」 |
| 与工作室关系 | **三条产品线**：`/image-studio` 独立出图台；画布 Studio Dock = 节点生成台；精修 = 节点编辑模式。P1 精修**只**挂画布已有图，不进图像工作室首页 |

## Non-goals (P1)

- `/image-studio`（及视频/音频工作室）内的精修入口
- 选中节点自动进入精修
- 智能分割 / 点击选区 / 文本指代选区（P2）
- 抠图、透明底、批量电商修图（P3）
- Wipe 滑杆对照、编辑强度滑杆（P2 / P4）
- 旁路节点、把精修结果另存为新 Image 节点
- 在 `buildImageProviderOptions()` / `ImageParamsSelector` 上挂 mask
- 用现有 `generateImageVariation`（整图变体）冒充局部精修
- Agent 自动跑精修并写回（`run_icon_refine` 仍为 P2+ stub）；P1 Agent 只负责**打开**工作台
- CSS 亮度/对比度滤镜（现 `AIImageEditor` 有；P1 不迁移）
- 等待 C1-image-P2 全部合并后再开工（精修 adapter 独立，可并行）

---

## Product boundary

口语里的「工作室」拆成三件，规划与 UI 不得混用默认入口：

```text
图像工作室 `/image-studio`     画布 Studio Dock（生成）
独立页，弱绑定画布                  选中节点后默认底部栏
        │                                │
        │  可选「放到画布」                    │  出图 / 重生成
        └────────────────┬────────────────┘
                         ▼
                  画布图片节点（有 URL）
                         │
                         │  用户显式点「编辑图像」
                         ▼
                  精修工作台（方案 2 Dock 旁）
                         │
                         │  应用到节点 → 版本 N+1
                         ▼
                  同一图片节点（生成 Dock 仍是默认）
```

| | 图像工作室 | 画布 Studio Dock | 精修工作台 |
|--|--|--|--|
| 路由 / 位置 | `/image-studio` | 画布底部，选中可编辑节点即出现 | 画布底部，**显式打开**才出现 |
| 心智 | 单独出几张图 | 按提示词/参考生成或重生成该节点 | 改这张已有图的某一块 |
| 输入 | prompt + 模型 | prompt + I* + 比例/分辨率 | **底图 + mask + 编辑指令** |
| 输出 | 生成记录列表 | 写回当前节点 URL / 新 `generationRecord` | 同节点 **版本 N+1** |
| Provider | `ImageProvider.generate()` | 同左 | **`EditProvider.edit()`**（新） |

**原则：**

1. 生成归生成，精修归精修；禁止把 mask 塞进生成参数卡。
2. 精修挂在「已有图」上。P1 只服务画布 `image` / 有 URL 的 `mediaInput` 图片节点。
3. 选中节点永远先出生成 Dock；精修必须用户（或 Agent 工具）主动进入。
4. 以后工作室若要精修：复用同一套 Edit 工具链，入口是某张「最近生成」上的「精修」，不是选中即弹。那是 P2+。

---

## Problem baseline

| 层 | 现状 | 问题 |
|----|------|------|
| 入口 | 右键 / 节点按钮「编辑图像」、Agent `open_image_editor` | 打开的是 `AIImageEditor` **整图变体** + CSS 滤镜，不是局部精修 |
| API | `POST /studio/image/variation` | 把变体 prompt 拼进文生图，**不传底图、不传 mask** |
| 写回 | `handleImageEditorApply` 直接改 `node.data.url` | 无版本链，无法回退；覆盖即丢上一张 |
| Dock | 选中图片节点 → `ImageDockPanel` | 正确的生成默认路径；精修不得抢这条 |
| Agent | `get_image_edit_capabilities` 声称 `crop/inpaint/outpaint/remove_bg` | **能力撒谎**：画布并未实现这些模式 |
| 数据 | `GenerationRecord` / `Material` 无 `parentVersionId` | 版本链只能先落在节点 `data` + record `metadata` |

---

## UX

### 入口（显式，P1 四处）

1. **节点按钮**「编辑图像」（现有 `CanvasNodeImage.openEdit`）
2. **右键菜单**「编辑图像」（仅 `nodeType === 'image'`，或有图片 URL 的 `mediaInput`）
3. **Agent** `open_image_editor`（`ui_command`，打开工作台，不改像素）
4. **生成 Dock 次要按钮**「精修这张图」：仅当当前节点已有 `url` 且未在生成中。不是 Tab，不默认选中

无 URL 或正在生成 / 上传：所有入口禁用，tooltip「先生成或上传图片」。

### 默认 vs 精修模式

| 用户动作 | 底部栏 |
|----------|--------|
| 选中图片节点 | **只**显示生成 Studio Dock |
| 点上述任一精修入口 | 收起生成 Dock，打开精修工作台（同一底部 Dock 区域） |
| 精修内点「返回生成」或关闭 | 精修卸载，生成 Dock 回来 |
| 改选其他节点 | 精修卸载（未应用的预览丢弃，不写节点） |
| 点画布空白取消选中 | 精修卸载，与现有 Dock 消失行为一致 |

精修进行中（请求未返回）：**禁止改选其他节点、禁止切回生成**；关闭按钮改为「取消精修」，取消进行中的请求并走现有 Studio 退款路径。任务结束后才允许切走。打开精修时**选中该节点**（Agent 指定 `nodeId` 时同样先选中再打开工作台）。

### 工作台布局（方案 2）

底部一张工作台，从左到右：

1. **画布区（对照）**  
   - 默认：**左 Before（当前版本）｜右 After（预览或当前）**  
   - 未跑编辑时 After 与 Before 相同，提示「圈选区域并描述修改」  
   - **按住「原图」**（按钮或空格）：After 暂时显示 Before；松开恢复  
   - 画布上叠 mask 描边（半透明红/白），只画在编辑目标上
2. **工具条**  
   - 画笔 / 橡皮 / 矩形  
   - 笔刷大小  
   - 清除选区  
   - 快捷指令芯片：「去除污渍瑕疵」「替换选区内容」（后者只聚焦输入框，不代替用户打字）
3. **指令 + 执行**  
   - 单行/多行：「改这里：……」  
   - 「去除污渍瑕疵」芯片写入默认指令：`去除选区内的污渍、瑕疵、多余物体，其余像素保持不变`  
   - 按钮「精修」；积分徽章与生成 Dock 同风格  
   - 「应用到节点」仅在有 After 且 After ≠ Before 时可用
4. **版本条**  
   - 当前节点已有版本的缩略图（最多展示最近 8 个，更早收入「更多」）  
   - 点某一版：Before 切到该版，不立刻写回节点；「恢复此版本」才写回 `url`  
   - 应用精修成功后自动追加 N+1，对照切到 N｜N+1

### Mask 规则

- 白/不透明 = 可编辑；黑/透明 = 必须保留  
- 导出 PNG，**像素宽高与底图显示用图一致**（以节点当前 `url` probe 的 width/height 为准；没有 mediaInfo 则先 probe）  
- 选区为空或覆盖面积 &lt; 0.3%：拦截，「请先圈选要改的区域」  
- 全图 mask：允许，但文案提示「这会改整张图，更像重新生成；可用底部生成栏」

### 应用与取消

- **应用到节点**：`url` ← After（服务端已按 mask 合成）；追加版本；`persistUserEdit`；关闭不是必须，保留工作台便于再改  
- **取消 / 关闭 / 切走**（无进行中任务）：丢弃未应用预览与未上传 mask，节点不变  
- 不改节点 `prompt`（生成提示词）。编辑指令只进版本条目和 `generationRecord.prompt`

### 文案

| 位置 | 文案 |
|------|------|
| 工作台标题 | 精修 |
| 已有入口 | 保持「编辑图像」（不改用户已熟悉的菜单） |
| Dock 次入口 | 精修这张图 |
| 主按钮 | 精修 |
| 写回 | 应用到节点 |
| 返回 | 返回生成 |

---

## Architecture

### 隔离原则（硬约束）

- **禁止**给 `ImageProvider.generate()` / `buildImageProviderOptions()` 增加 `maskUrl`  
- **禁止**在 `ImageDockPanel` / `ImageParamsSelector` 出现 mask 控件  
- 精修走新链路：`StudioController.editImage` → `StudioService.editImage` → `buildImageEditRequest` → `EditProvider.edit()`  
- 共享：鉴权、积分 consume/refund、async 任务轮询、`inlineUpstreamReferenceImages`、media 上传、`sessionId`/`nodeId` scope

### 模块边界

```text
显式入口
  → canvasEditor.openRefine({ nodeId, url })     // 替换 openImageEditor 语义
  → RefineDockPanel（底部，替换当次 ImageDockPanel）
       ├─ MaskEditor（画笔/橡皮/矩形 → PNG）
       ├─ CompareView（左右 Before/After + 按住原图）
       └─ VersionStrip（node.data.imageVersions）
  → persistMediaUrl(mask.png)
  → POST /studio/image/edit
       → StudioService.editImage
            ├─ 校验底图 / mask 尺寸
            ├─ buildImageEditRequest + EditProvider.edit()
            ├─ compositeUnmaskedPixels(base, result, mask)   // sharp
            ├─ 持久化合成后 URL
            └─ GenerationRecord type: 'image_edit'
  → 前端追加 imageVersions，写回 node.data.url
```

P1 用精修工作台**替换**现有 `AIImageEditor` 对话框。「编辑图像」不再打开整图变体弹窗。整图变体需求由生成 Dock 承担。`POST /studio/image/variation` 本轮保留（避免暗改其他调用方），画布入口不再走它。

### 前端

| 单元 | 职责 |
|------|------|
| `useCanvasEditorStore` | `imageTarget` 表示精修目标，**只**由显式入口写入。选中节点不得 `openImageEditor` |
| `RefineDockPanel.vue` | 工作台壳：工具、指令、对照、版本、应用/返回 |
| `MaskEditor`（组件或 composable） | 与底图同尺寸的 overlay canvas；导出 Alpha/白黑 PNG |
| `CompareView` | 左右分栏；按住原图 |
| `imageVersions.ts` | 纯函数：append / revert / current；可单测 |
| `DockStudioToolbar` / `CanvasPage` | 精修打开时渲染 `RefineDockPanel` 而非 `ImageDockPanel`；生成 Dock 次入口 emit `refine` |
| `CanvasPage.handleImageEditorApply` | 改为写版本链，而不是只改 `url` |

选中节点**不得**调用 `openImageEditor` / `openRefine`。

### 后端 / adapter

路径建议（实施计划可微调文件名，不得并进 generate adapter）：

- `packages/shared/src/imageEditProfiles.ts` — `ImageEditModelProfile`  
- `packages/agent/src/studio/edit-adapter.ts` — `buildImageEditRequest`  
- `packages/agent/src/tools/image-edit-provider.ts` — `EditProvider`  
- `apps/server/src/studio/studio.service.ts` — `editImage`  
- `apps/server/src/media/composite-unmasked.ts` — sharp 合成

P1 上游：**APIMart `gpt-image-2-official`（Image2）** `image_urls[0]` + `mask_url` + `prompt`，JSON async，复用现有 task 轮询。  
模型选择 P1 **不**做用户可选：固定走平台 Image2 编辑档。BYOK / 其他模型编辑 wire = P2。

编辑 prompt 策略（与生成一致性块不同，**禁止**复用 `buildImageRefConsistencyBlock`）：

```text
仅修改蒙版区域。蒙版以外的所有像素必须与原图完全一致。
用户指令：{userPrompt}
```

### mask 外保真（P1 强制）

上游 inpaint 不能保证 100% 不漏改。P1 **服务端合成**为 SSOT：

1. 下载底图、结果图、mask  
2. mask 外（黑/透明）像素 **强制来自底图**  
3. 上传合成图，record.url 只存合成结果  

前端 After 预览用接口返回的合成 URL，不展示未合成的上游原图。

### 数据：版本链（P1 不改 Prisma schema）

节点 `data`：

```ts
interface ImageVersionEntry {
  id: string                 // cuid
  url: string
  createdAt: string          // ISO
  source: 'generate' | 'upload' | 'edit'
  generationRecordId?: string
  parentVersionId?: string
  editPrompt?: string        // 仅 source=edit
}

// node.data 增量
url: string                  // 当前展示 = 当前版本 url
currentVersionId?: string
imageVersions?: ImageVersionEntry[]
generationRecordId?: string  // 指向产生当前 url 的 record（生成或精修）
```

**首次打开精修**时，若 `imageVersions` 为空且已有 `url`：插入一条 `source: 'generate' | 'upload'` 的版本 1（用现有 `generationRecordId` 若有），再进入工作台。不在每次选中节点时做。

**应用精修：** append `source:'edit'`，`parentVersionId` = 当时 `currentVersionId`，更新 `url` / `currentVersionId` / `generationRecordId`。

**恢复某版本：** 只改 `url` + `currentVersionId`（及对应 `generationRecordId`）。不删除后续版本条目，便于再切回来。

`GenerationRecord`：

| 字段 | P1 值 |
|------|--------|
| `type` | `image_edit`（生成仍为 `image`） |
| `prompt` | 用户编辑指令 |
| `url` | 合成后的图 |
| `sessionId` / `nodeId` | 画布 scope |
| `metadata` JSON | `editMode: 'inpaint'`，`parentRecordId`，`baseImageUrl`，`maskUrl`，`parentVersionId`，`composited: true` |

Material 表本轮不扩列。画布节点不依赖 `Material` 版本。

### 积分

与现有 `generateImageVariation` 同档：**10 积分 / 次**，失败与取消走现有 consume → refund。metadata 记 `chargeReason: '图像精修'`。

### Agent（P1）

| 工具 | P1 行为 |
|------|---------|
| `open_image_editor` | 仍发 `canvasCommands: [{ type, nodeId }]`；前端打开**精修工作台**而非旧对话框 |
| `get_image_edit_capabilities` | `canEdit` 当且仅当 image-like 且有 url；`supportedModes: ['inpaint']`。删除对未实现的 crop/outpaint/remove_bg 的声称 |
| `run_icon_refine` | **不改**，仍为后续 stub |

---

## Error handling

| 情况 | 行为 |
|------|------|
| 无 url / 非图片节点 | 入口禁用；Agent capabilities `canEdit: false` |
| 未画 mask / 选区过小 | 前端拦截，不扣积分 |
| mask 与底图像素尺寸不一致 | 服务端 400，明确错误；不扣成功态积分（若已扣则 refund） |
| mask 上传失败 | 工作台内错误条，可重试 |
| 上游失败 / 超时 | record `failed` + 现有 diagnostic；refund；After 保持失败前预览 |
| 精修进行中切节点 / 返回生成 | 忽略该操作；只能点「取消精修」 |
| 合成失败 | 视为整次失败，不写节点；不把未合成上游图当成功 |

---

## Testing

| 层 | 必须覆盖 |
|----|----------|
| `imageVersions` 纯函数 | 空链种子、append edit、revert 不删后续、current url 对齐 |
| mask 导出 | 输出宽高 = 底图；空选区判定 |
| `compositeUnmasked` | mask 外像素等于底图；mask 内允许不同 |
| `buildImageEditRequest` | body 含 `image_urls[0]` + `mask_url` + 编辑 prompt；**不含**生成一致性块 |
| `editImage` 服务 | 尺寸校验失败；成功写 `type: 'image_edit'` + `composited` |
| capabilities | 有 url → `['inpaint']`；无 url → `[]` |
| 入口 | 选中节点不打开精修（组件/store 测）；`openRefine` 才打开 |

不强制 Playwright 全链路。生产可用手动清单验收（见下）。

---

## 验收标准

1. 选中已有图的图片节点 → **只有**生成 Dock，不出现精修工作台。  
2. 点「编辑图像」或「精修这张图」或 Agent `open_image_editor` → 底部精修工作台打开，生成 Dock 隐藏。  
3. 手画 mask +「去除污渍瑕疵」或自定义替换指令 → After 仅选区变化；用像素抽样或合成单测证明 mask 外与 Before 一致。  
4. 「应用到节点」后同一节点 `url` 更新，画布不新增节点；版本条出现 N+1；可恢复到 N。  
5. 关闭 / 返回生成 / 换节点（无进行中任务）→ 精修消失；未点应用则 `url` 不变。  
6. `get_image_edit_capabilities` 不再返回未实现的 crop/outpaint/remove_bg。  
7. 相关 vitest 绿；`pnpm build` 绿。

---

## 分阶段

| Phase | 本规格 | 内容 |
|-------|--------|------|
| **P1** | **本文件** | 手动画 mask + 指令 + 左右对照 + 同节点版本链 + EditProvider Image2 + 服务端合成 + 替换旧编辑弹窗 + 修正 capabilities |
| P2 | 后续 spec | 智能选区；Wipe 滑杆；工作室「最近生成」上的精修入口；编辑模型可选 |
| P3 | 后续 spec | 抠图 / 透明底工具槽 |
| P4 | 后续 spec | 强度、Agent 自动 apply、局部超分 |

P1 实施可再拆任务（mask 编辑器、API、Dock 接入、版本链、合成、Agent 文案），但不拆成多个产品规格。

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| Image2 mask 泄漏改到区外 | 服务端合成兜底 |
| mask 与底图尺寸不一致被上游拒 | 前端按 probe 尺寸导出；服务端二次校验 |
| 用户把精修当整图重绘 | 全图 mask 提示；生成 Dock 仍是默认 |
| 旧「编辑图像」用户找变体 | 变体 = 生成 Dock 改 prompt 再生成；弹窗退役 |
| 回滚 | feature flag `cxImageEdit`：关则「编辑图像」暂时隐藏（不恢复整图变体弹窗，除非显式要） |

---

## 附录：P1 请求体目标态

```json
{
  "model": "gpt-image-2-official",
  "prompt": "仅修改蒙版区域。蒙版以外的所有像素必须与原图完全一致。\n用户指令：去除选区内的污渍",
  "image_urls": ["https://cdn/base.png"],
  "mask_url": "https://cdn/mask.png"
}
```

`size` / `resolution`：跟随底图，能 `auto` 则 `auto`，避免把局部精修拉到无关比例。
