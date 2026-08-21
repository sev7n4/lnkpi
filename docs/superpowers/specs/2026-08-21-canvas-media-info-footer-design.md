# 画布媒体信息外置底栏 Design

**Date:** 2026-08-21  
**Status:** Approved, plan in `docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`  
**代号:** **CX-MEDIA-INFO-FOOTER**  
**Related:**
- `2026-08-15-media-inspector-design.md` — L0 摘要与 `mediaInfo` / `probeMedia`；本文件修正画布节点 L0 放置与覆盖范围
- 现有：`NeoBaseNode` 外置标题（`neo-node-external-title`）、`MediaInfoSummary`、`useMediaInspector`

---

## Goal

去掉画布媒体节点上「贴在像素底部的黑条」观感，改为与**外置标题对称**的**卡片外底栏**；图 / 视频 / 音频 / `mediaInput` 在有 URL 且能拼出至少一项时**始终**展示 L0 摘要；上传与复制等非生成路径通过 probe（及音频前端时长）补齐 `node.data.mediaInfo`。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 实现路径 | **A**：`NeoBaseNode` 统一 `#footer` 槽 + 外置底栏 CSS |
| 放置 | 卡片外，`bottom: -32px`，镜像 `neo-node-external-title` 的 `top: -32px`；**不**盖住媒体像素 |
| 节点范围 | `image` / `video` / `audio` / `mediaInput` |
| 图字段 | 宽×高 · 比例 · 大小 |
| 视频字段 | 分辨率 · 比例 · 大小（**不含时长**） |
| 音频字段 | **时长 · 格式 · 大小** |
| 可见性 | 有可用 URL 且至少一项可展示 → 始终显示（**不再**要求 `status === completed`） |
| 缺 info | 有 URL → `probeMedia`，结果写入 `node.data.mediaInfo` |
| 音频时长 | 前端 `<audio>` `loadedmetadata` → `durationSec`（服务端 probe 本轮不补时长） |
| 资产面板等 | **本轮不动**（仍可保留 hover overlay） |

## Non-goals（本轮）

- SAM / 抠图 / 文本指代 / 放大 / strength
- 服务端 probe 计算音视频 `durationSec`
- 底栏点击打开 Media Inspector
- 改资产面板 / 任务历史的 overlay 样式
- 改 `MediaProbeService` API 契约（仅消费现有 probe）

---

## Problem baseline

| 层 | 现状 | 问题 |
|----|------|------|
| 样式 | `MediaInfoSummary` + `neo-media-info-summary--overlay` 叠在预览底部 | 像创可贴黑条，盖住内容 |
| 可见性 | `status === completed && mediaInfo` | 上传 / 复制 / 无 generation 回填的节点常无条 |
| 音频 | `CanvasNodeAudio` 无摘要 | 与图/视频不一致 |
| mediaInput | 仅预览 + 文件名 | 无 L0 媒体属性 |

---

## 1. 布局与壳

- `NeoBaseNode` 增加 `neo-node-external-footer`：`position: absolute; bottom: -32px; left: 0; right: 0;`，与标题栏对称；`pointer-events: auto`；`overflow: visible` 已由 wrapper 保证。
- Named slot `#footer`：有内容才渲染底栏容器；空 slot 不占位、不留空条。
- `CanvasNodeImage` / `Video` / `Audio` / `MediaInput` 将 `MediaInfoSummary` 放入 `#footer`。
- 移除上述画布节点上的 `neo-media-info-summary--overlay`（及节点内 absolute bottom 叠层）。
- `NeoBaseNode` **不**读取 `mediaInfo`、**不**发起 probe。

---

## 2. 字段与数据流

### 2.1 展示

`MediaInfoSummary` 扩展：

- `kind: 'image' | 'video' | 'audio'`
- 音频：`durationSec`、格式（短扩展名或 mime 子类型，如 `MP3`）、`bytes`
- 拼接规则：有则加入，用 ` · ` 连接；`parts.length === 0` 且无 ref 警告 → 不渲染组件

视频**不**展示时长（即便将来有 `durationSec` 也不在本 L0 行显示）。

### 2.2 写入 `node.data.mediaInfo`

1. **生成完成**：保留现有 `buildNodeMediaInfoSummary` / `CanvasPage` / `useNodeGeneration` 回填。
2. **有 URL、无（或不完整）mediaInfo**：composable `ensure` → `probeMedia(url)` → `patchNodeData`（mime/bytes；图宽高/比例；视频分辨率/比例若 probe 可得）。
3. **音频时长**：节点内 `<audio>`（或隐藏 audio 元素）`loadedmetadata` → 合并 patch `durationSec`；可与 probe 结果合并，后到的字段不擦掉已有更完整字段。
4. **URL 变更**：按新 URL 重新 ensure；以 url 为 key 去重，避免重复 probe。

### 2.3 与现有回填共存

`CanvasPage` 等对 completed 的 backfill **保留**。Composables 与回填并存时：**不重复请求**；**不覆盖**已有更完整字段（例如已有 width/height 时 probe 空值不抹掉）。

---

## 3. 组件边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `NeoBaseNode` | `#footer` 槽 + 外置底栏 CSS | 无 media API |
| `useNodeMediaInfoFooter`（名称可微调） | ensure：缺则 probe / 音频 duration / `patchNodeData`；幂等 | `studioApi.probeMedia`、canvas patch |
| 各媒体节点 | 调 composable；把 summary 塞进 `#footer` | `MediaInfoSummary` |
| `MediaInfoSummary` | 纯展示；支持 audio 行 | `mediaInfoFormat` 工具 |
| `NodeMediaInfoSummary` / builders | `kind` 含 `audio`；音频字段类型 | 现有 inspector 类型 |

---

## 4. 错误与降级

- probe 失败：静默；无法拼出任何字段 → 不渲染底栏。
- `loadedmetadata` 失败：仍可显示格式/大小；仅缺时长。
- 无 URL：不 ensure、不渲染底栏。

---

## 5. 测试

- `MediaInfoSummary`：audio 行拼接；video 行仍无时长。
- ensure / builder：有 url 无 mediaInfo → 触发 probe 写入；已有完整 info → 不重复请求。
- 可选：`NeoBaseNode` 有/无 footer 内容时的挂载断言。

手动验收：画布上生成图/视频、上传图/视频/音频、`mediaInput` 三类素材；底栏在卡片外；无像素遮挡。

---

## Success criteria

1. 图/视频节点 L0 不再使用 overlay 盖住预览像素。
2. 音频与 mediaInput 在有 URL 且有至少一项字段时显示外置底栏。
3. 上传/复制节点在 probe（及音频 metadata）成功后出现摘要，无需 generation `completed`。
4. 视频 L0 不含时长；音频含时长·格式·大小。
5. 非媒体节点行为不变；资产面板 overlay 本轮不变。
