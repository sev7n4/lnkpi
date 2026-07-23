# 画布任务面板 / Undo / 视频交互 / 时长滑轨 — 设计说明

> 日期：2026-07-23  
> 状态：已批准（2026-07-23）  
> 范围：任务历史 UX、状态同步、撤销重做、视频节点拖拽/播放、视频时长参数

## 背景与问题

1. 任务详情无法直接拿到任务 ID，运维定位困难。
2. 画布无 Undo/Redo 快捷键。
3. 视频节点有内容后整块 `<video controls class="nodrag">`，点击变播/暂停，难以拖移节点。
4. 左侧【任务】与节点角标状态不同步（两套数据源 + poll 写入门闩）。
5. 「重试 / dock 生成」每次新建 GenerationRecord（合理），但列表无按节点聚合，且失败 UI 与重试入口不完整；诊断 `!` 弹层塞在小卡片内导致溢出遮挡。
6. 视频时长仅 5/10/15 三档按钮，需要 5–15 整数秒滑轨。

## 目标

| # | 目标 |
|---|------|
| 1 | 详情可复制任务 ID |
| 2 | Cmd/Ctrl+Z / Shift+Z 撤销图操作与节点参数/提示词 |
| 3 | 视频节点默认拖拽；双击或 ▶ 进入播放态 |
| 4 | 节点与任务面板状态以当前 `generationRecordId` 对齐 |
| 5 | 重试继续新建任务；列表一节点一行；详情按新→旧浏览该节点全部尝试 |
| 6 | 失败诊断弹层不溢出；列表/详情可重试 |
| 7 | 视频时长 5–15 整数秒滑轨，默认 5；10/15 高亮；计费跟档 |

## 非目标

- 不为生成任务本身提供 Undo（不回滚远端任务 / 计费）。
- 不引入 WebSocket；继续 HTTP 轮询。
- 不新增服务端 `/retry` API；重试仍走现有 `generate*`。
- 视频合成（composition）轨时长控件不在本期强制改造（仅标准视频生成 dock 参数）。

---

## 1. 任务 ID

**位置：** 节点任务详情页中，**每一次尝试**的摘要行 / 展开区。

**行为：**
- 展示字段「任务 ID」，值为该次 `record.id`，等宽字体。
- 「复制」按钮：写入剪贴板，短暂反馈「已复制」。
- 与节点 ID（`nodeId`）分开展示，避免混淆。

---

## 2. Undo / Redo

### 可撤销

- 节点：新增、删除、移动（含多选移动结束）
- 边：新增、删除
- 节点 data 中的：**提示词**、**视频/图片等生成参数**（含 duration、aspectRatio、resolution、crop、model 等 settings 字段）

### 不可撤销

- 生成启停、成功/失败、`generationRecordId` / `url` / `status` / `errorMessage` 等任务结果字段的远端驱动变更
- 积分余额变化

### 交互

- `Cmd/Ctrl+Z` → undo；`Cmd/Ctrl+Shift+Z` 或 `Ctrl+Y`（Windows）→ redo
- 焦点在输入框 / contenteditable / dock 文本区时：**不拦截**系统默认文本撤销（仅当焦点在画布空白或节点壳层时启用图撤销）
- 历史深度约 **50** 步；超出丢弃最旧

### 实现要点

- 新增画布历史 composable（如 `useCanvasUndoStack`），在 `CanvasPage` 挂载快捷键。
- 以「用户操作提交点」入栈：拖拽在 `onNodeDragStop` 入栈；参数/提示词用 debounce（约 400–600ms）或 blur 入栈，避免每个按键一步。
- patch 任务结果时标记 `skipHistory`，不入栈。
- 与现有自动保存：undo/redo 后触发与平常一致的 persist 路径。

---

## 3. 视频节点双模式

### 状态机

```
[drag] --双击画面 / 点 ▶--> [play]
[play] --Esc / 点节点壳空白 / 点「退出播放」--> [drag]
```

### drag 态（默认）

- 画面区域**可拖节点**（去掉覆盖全画面的 `nodrag` 视频控件占用）。
- 展示静帧或 muted poster + 轻量 ▶ 按钮（`nodrag`，仅按钮拦截拖拽）。
- 不展示原生 `controls`（避免误触播放）。

### play 态

- `<video controls class="nodrag nowheel">`，可用原生播/暂停/进度。
- 节点本身不可从视频区拖走；壳层仍可选中。
- 切换节点选中或框选开始时，建议自动退回 drag 态（避免多节点同时播）。

### 其他

- 无 `url` 时保持现有上传占位，不适用双模式。
- 框选、连线逻辑不变。

---

## 4. 状态同步

### 原则

- **节点权威字段：** `data.generationRecordId`（当前跟踪的任务）。
- **左栏列表行：** 按 `nodeId` 聚合后，展示该节点**最新一次**尝试的状态（按 `createdAt`）。
- **详情内各次尝试：** 各自 `record.status`，进行中轮询刷新。

### 写入规则调整

- `useGenerationPolling` / `applyStudioRecord`：当 `record.id === node.data.generationRecordId` 时，**终态（completed / failed / error / fallback_pending）必须写回节点**，不再被 `acceptsPollWrite` 拦死。
- 仅当 record id 与节点当前 id 不一致时忽略（旧任务迟到结果）。
- 取消生成：继续清节点 poll；左栏保留历史记录为取消/失败终态。

### 定位

- 优先用 `record.nodeId` 聚焦节点；fallback 再用 `generationRecordId` / `materialId` 匹配。

---

## 5. 重试语义与任务列表面板

### 重试 = 新建任务（已确认 A）

- 节点角标重试、dock「生成」、详情「重试」→ **同一** `retryNodeGeneration` / `generateForNode`。
- 服务端继续 `generationRecord.create`；旧失败记录保留。
- UI 文案可用「再试一次」，避免暗示同一任务 ID。

### 列表（默认）

- **每个 `nodeId` 一行**（无 nodeId 的记入「未关联」组，各自独立行）。
- 展示：类型图标、nodeId（或截断）、**最新状态徽章**、角标 **「第 N 次」**（N = 该节点尝试总数）、时间（最新一次）。
- 失败：保留 `!` 诊断 + 小「重试」按钮。
- 点击行 → 进入该节点的**详情页**（不是列表内联展开）。

### 详情页（按节点）

- 顶部：返回、标题「任务详情」、**当前最新状态**；失败时右上角失败态 +「重试」。
- 主体可滚动，按 **新 → 旧** 列出该节点全部尝试：
  - 每条摘要：第 k 次、状态、任务 ID（可复制）、时间、模型/渠道摘要、媒体缩略/失败原因。
  - **交互锁定：** 点击某次 → **手风琴展开**该次完整字段（提示词、参数等）；同时仅允许一条展开。默认展开最新一次。
- **进行中**：详情保持轮询（与列表面板同一 `listGenerations`），状态与媒体刷新。
- 「定位到画布节点」保留（定位到该 `nodeId`）。

### 生命周期 Tab

- 排队 / 进行中 / 已完成：按**最新一次**状态分桶；展开详情后仍可见该节点全部历史尝试。

---

## 6. 失败 UI 与诊断溢出

### 列表 `!`

- 点击打开诊断：**Teleport 到面板根或 body**，按 `!` 按钮 `getBoundingClientRect` 锚定定位。
- 不得 `absolute` 塞进 `overflow-y-auto` 的小卡片内部。
- 内容：`NodeDiagnosticPopover`（用户文案、hint、复制诊断）；旁路小「重试」。

### 详情

- 右上角失败态 +「重试」。
- 失败原因文本块保留。
- 任务 ID 可复制（见 §1）。

---

## 7. 视频时长滑轨

### UI（`VideoSettingsSelector` / 视频 dock 参数区）

- 替换 5/10/15 三按钮为 **滑轨**：min=5，max=15，**step=1**，默认 **5**。
- 当前值旁显示 `Ns`。
- 刻度标记：5、10、15；其中 **10、15 视觉更高亮**（字重/强调色），点击刻度可跳转。
- 拖动过程实时更新 `modelValue.duration`（整数）；计入 Undo 的 debounce 规则见 §2。

### 类型与校验

- `VideoSettings.duration` / shared 类型从字面量 `5|10|15` 放宽为 `number`（约束 5–15 整数）。
- 写入节点与请求前 `clamp(Math.round(duration), 5, 15)`。
- 服务端已有档位计费：`>=15 → 70`，`>=10 → 50`，否则 `30`；前端 `estimateVideoCredits` 改为同逻辑，去掉仅精确匹配 5/10/15 的 map。

### 兼容

- 历史节点已是 5/10/15 不受影响；若出现越界值，UI 打开时 clamp。

---

## 关键文件（预期）

| 区域 | 文件 |
|------|------|
| 任务面板 | `apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue` |
| 诊断弹层 | `NodeDiagnosticPopover.vue` + 面板 Teleport 定位 |
| 生成/轮询 | `useNodeGeneration.ts`、`CanvasPage.vue`（`acceptsPollWrite`） |
| 视频节点 | `CanvasNodeVideo.vue` |
| Undo | 新 composable + `CanvasPage.vue` 快捷键 |
| 时长 | `VideoSettingsSelector.vue`、`packages/shared` 类型、`credits.ts` |

---

## 验收标准

1. 详情可复制任务 ID，运维可拿 ID 查库/日志。
2. 移动节点、改提示词/时长后 Cmd+Z 可回退；生成失败状态不会被 Z 清掉。
3. 有视频内容时默认拖得动节点；双击/▶ 可播放；Esc 退出播放态。
4. 节点失败时左栏最新状态同步为失败；再生成成功后两边均为成功且指向新 record。
5. 同一节点多次失败再试：列表仍一行「第 N 次」；详情可见第 1…N 次，新在上。
6. 点 `!` 诊断完整可见、不被裁切；可复制诊断与重试。
7. 时长可滑到 7、12 等整数秒；积分预估与 5/10/15 档位一致（如 7→30，12→50，15→70）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Undo 栈与自动保存打架 | 统一走现有 patch + persist；跳过任务结果字段 |
| 输入框抢 Z | 焦点检测，文本区不绑图画布 undo |
| 视频 play 态误拖 | play 时 video `nodrag`；选中变化退出 play |
| 中间秒数模型不支持 | 若某模型仅支持离散档，生成前按模型能力 snap（若现有 adapter 已有约束则复用；否则本期仅 UI+计费，模型侧保持传 duration 整数） |

## 实现顺序建议

1. 任务 ID + 诊断 Teleport + 详情重试（小、可独立）
2. 状态同步门闩修复
3. 任务列表按节点聚合 + 详情历史
4. 视频双模式
5. 时长滑轨 + 计费
6. Undo/Redo 栈（最大块，最后或平行）
