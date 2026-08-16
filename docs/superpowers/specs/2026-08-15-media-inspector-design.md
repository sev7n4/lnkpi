# 媒体属性 Inspector + 参考图 Probe / 视频预检 Design

**Date:** 2026-08-15  
**Status:** Approved for planning (pending user review of this file)  
**代号:** **MEDIA-INSPECTOR**  
**Related:**
- 生产故障：`cmsud22f6003gpf01oybnvosn`（Agnes keyframes 因 I3 参考图 3072×4096 / 12.75MB 被拒）
- `2026-07-21-node-generation-failure-diagnostics-design.md`（失败 ⓘ；本规格扩展成功态只读属性）
- `2026-08-08-seedance-agnes-video-adapter-design.md`（video refWire / keyframes）
- `2026-08-15-i2v-upstream-capability-audit-design.md`（I2V 能力产品化）

---

## Goal

让创作者在**画布节点**与**资产库**上，用**一次点击**快速查看图片/视频的文件属性与生成上下文；并在视频生成前对参考图做**体积/尺寸预检**，避免上游 `image URL could not be downloaded or did not return a valid supported image` 类失败。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 信息分层 | **L0** 常驻摘要（completed + mediaInfo）；**L1** Inspector 默认 Tab；**L2** 高级（prompt/seed/nativeParams）；**L3** 失败诊断（复用现有 diagnostic） |
| 入口统一 | 画布节点、资产库、任务历史、预览浮层 → **同一 `MediaInspector` 组件** |
| Dock 职责 | Dock = **编辑/再生成**；Inspector = **只读属性**（Figma Design vs Inspect） |
| 数据 SSOT | `GenerationRecord.metadata.mediaInfo` + `Material.metadata.mediaInfo`；节点 `data.mediaInfo` 为 L0 缓存 |
| Probe 时机 | 生成 **completed** 时服务端 probe 一次；参考图列表 lazy probe（视频生成前必 probe） |
| 资产库 | `UserAsset.metadata` JSON（可选 `generationRecordId`）；存库时快照 L1 |
| 视频预检 | 调用上游前 probe 全部 referenceImages；超阈值 **warn**（UI）+ 可选 **block**（服务端，见阈值） |
| 超大图处理（P1） | 超阈值自动 downscale 至 2048 长边后 inline data URI（复用 `upstream-ref-inline` 思路）；P0 仅 warn |
| API | 扩展 `GET /studio/generations/:id` 返回解析后的 `mediaInfo`；新增 `GET /studio/media-probe?url=`（鉴权 + 限流） |
| 失败/成功 ⓘ | 成功态节点右上角 **18px ⓘ** 打开 Inspector；失败态 ⓘ 仍优先 diagnostic（Inspector 内链到诊断 Tab） |

## Non-goals (this iteration)

- EXIF/IPTC 深度解析、色彩空间、DPI 打印参数
- 批量导出 CSV / 管理员全局媒体审计后台
- Material/shot 旁路全面重构（仅复用 Inspector 组件读取 Material metadata）
- Playwright 全链路 E2E（用手动 + pytest 生产脚本验收）
- 视频参考图自动压缩 **强制** inline（P0 仅 warn；P1 Task 可选开启 auto-downscale）

---

## Problem baseline

| 层 | 现状 | 问题 |
|----|------|------|
| 服务端 | `GenerationRecord.metadata` 含 model/refWire/参考 URL 等 | 无 width/height/bytes；参考图无 probe |
| 节点 | `node.data` 仅 url/prompt/模型参数 | 成功态无属性入口；与 DB metadata 不同步 |
| 资产库 | `UserAsset` 仅 url/label/kind | 存库丢弃生成上下文 |
| 任务历史 | 部分展示 model/参数 | 无文件尺寸；与节点/资产库三套 UI |
| 视频 | keyframes 直传 URL | 13MB 大图导致 BYOK 400；用户无事前感知 |

---

## UX

### L0 — 零点击摘要

- **Image/Video 节点** completed：节点底部细条（常驻）：`1024×1024 · 16:9 · 0.9MB`
- **Video 节点** 参考图有风险：细条追加 `⚠ ref 偏大`
- **资产库** grid hover：同样格式的一行摘要

### L1 — MediaInspector（一次点击）

触发：节点 ⓘ、资产库「详情」、任务历史「属性」、预览浮层「更多信息」。

**默认展开区块：**

1. **预览** + 标题（label / 节点 id / 生成时间）
2. **文件信息**：尺寸、体积、格式、时长（video）、URL（可复制，截断）
3. **生成参数**：模型、渠道（BYOK/平台）、比例、分辨率、duration、videoMode、积分
4. **参考媒体**（若有）：缩略图列表，每项含 refKey、尺寸、体积、告警 badge
5. **操作**：复制任务 ID、定位画布节点、下载

**告警规则（P0）：**

| 条件 | 展示 | 视频 keyframes 含义 |
|------|------|---------------------|
| 长边 > 2048 或体积 > 5MB | 黄色 `偏大` | 可能上游拒收 |
| 长边 > 4096 或体积 > 10MB | 红色 `过大` | 高概率失败（如生产 I3） |

### L2 — 高级（折叠）

- prompt（只读，可复制）
- seed / negativePrompt / generateAudio
- refWire / gatewayModelId / scenario
- mergedText（若有）
- nativeParams（JSON 折叠，默认收起）

### L3 — 诊断（仅失败/fallback）

- 复用 `NodeDiagnosticPopover` 数据与复制格式
- Inspector 内 Tab 切换，不另做一套

### 与 Dock 关系

```
选中节点
├── Dock（底部）→ 编辑 prompt / 模型 / 再生成
└── ⓘ Inspector（右侧 Drawer 320px）→ 只读属性
```

Drawer 不遮挡画布中心；移动端可全屏 Sheet。

---

## Data model

### `MediaInfo`（shared SSOT）

```ts
export interface ProbedMediaFile {
  url: string
  width?: number
  height?: number
  bytes?: number
  mimeType?: string
  durationSec?: number   // video only
  probeStatus: 'ok' | 'failed' | 'pending'
  probeError?: string
}

export interface MediaInfo {
  output?: ProbedMediaFile
  references?: Array<ProbedMediaFile & { refKey?: string; role?: string }>
  probedAt?: string      // ISO
}

export type MediaRefWarningLevel = 'none' | 'warn' | 'error'

export interface MediaRefPreflight {
  level: MediaRefWarningLevel
  code?: 'ref_too_large' | 'ref_dimension_exceeded' | 'ref_probe_failed'
  message: string
  refs: Array<{ url: string; refKey?: string; width?: number; height?: number; bytes?: number; level: MediaRefWarningLevel }>
}
```

### 阈值常量（shared）

```ts
export const VIDEO_REF_WARN_BYTES = 5 * 1024 * 1024      // 5MB
export const VIDEO_REF_ERROR_BYTES = 10 * 1024 * 1024    // 10MB
export const VIDEO_REF_WARN_MAX_EDGE = 2048
export const VIDEO_REF_ERROR_MAX_EDGE = 4096
```

### Persistence

**GenerationRecord / Material metadata**（生成 completed 时写入）：

```json
{
  "mediaInfo": {
    "output": { "url": "...", "width": 1024, "height": 1024, "bytes": 952274, "mimeType": "image/png", "probeStatus": "ok" },
    "references": [
      { "url": "...", "refKey": "I1", "width": 1024, "height": 1024, "bytes": 952274, "probeStatus": "ok" }
    ],
    "probedAt": "2026-08-15T12:37:00.000Z"
  }
}
```

**node.data**（`applyStudioRecord` 写入摘要）：

```ts
mediaInfo?: {
  kind?: 'image' | 'video'
  width?: number
  height?: number
  bytes?: number
  aspectRatio?: string
  resolution?: string
  refWarning?: MediaRefWarningLevel
}
```

**UserAsset**（Prisma 迁移）：

```prisma
model UserAsset {
  // ...existing
  metadata       String?   // JSON: { mediaInfo, generationRecordId?, promptPreview? }
}
```

存库 API 接受可选 `generationRecordId`；服务端从 record 复制 `mediaInfo` 快照。

---

## Server behavior

### Probe service

`apps/server/src/media/media-probe.service.ts`

- `probeUrl(url: string): Promise<ProbedMediaFile>`
  - HEAD 取 content-length / content-type
  - 图片：读 PNG IHDR 或 JPEG SOF（仅前 64KB）取宽高，避免全量下载
  - 视频：优先 content-type + content-length；可选 ffprobe（**P0 不做**，duration 来自 generation metadata）
- 超时 10s；失败 `probeStatus: 'failed'`

### 写入时机

| 事件 | 动作 |
|------|------|
| image/video completed | probe output url + metadata.referenceImages → 写 `mediaInfo` |
| video generate 开始前 | probe 全部 refs → 写 `preflight` 到 metadata；超 error 阈值抛 `BadRequestException`（带 refKey） |
| GET generation by id | 返回 `mediaInfo` + 解析后的 `preflight` |

### Video preflight（P0）

在 `studio.service.ts` `generateVideo` → `completeVideo` 之前：

1. probe 所有 referenceImages
2. 计算 `MediaRefPreflight`
3. 若任一 ref `level === 'error'` 且 `refWire === 'agnes_keyframes'`：**拒绝发起上游**（400，`invalid_input`，userMessage 指明 refKey 与尺寸）
4. 若 `warn`：仍允许生成，metadata 记录 `refPreflight`

**错误示例（对齐生产 case）：**

> 参考图 I3 过大（3072×4096，12.8MB），Agnes 关键帧模式可能无法处理。请压缩后重试或移除该参考图。

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/studio/generations/:id` | 响应增加 `mediaInfo`, `refPreflight?` |
| GET | `/studio/media-probe?url=` | 登录用户；同源或 allowlist 域名；rate limit 30/min |
| POST | `/assets` | body 可含 `generationRecordId`；服务端填充 metadata |

---

## Frontend components

| 组件 | 路径 | 职责 |
|------|------|------|
| `MediaInspectorDrawer.vue` | `apps/web/src/components/media/` | L1/L2 主 UI |
| `MediaInfoSummary.vue` | 同上 | L0 摘要条（节点/资产库复用） |
| `MediaRefList.vue` | 同上 | 参考图列表 + 告警 badge |
| `useMediaInspector.ts` | `apps/web/src/composables/` | 打开/关闭、拉 record、缓存 |
| `mediaProbeApi` | `apps/web/src/services/studio-api.ts` | probe + generation 扩展 |

**集成点：**

- `CanvasNodeImage.vue` / `CanvasNodeVideo.vue`：L0 摘要 + ⓘ
- `CanvasAssetPanel.vue`：详情按钮 → Inspector
- `CanvasTaskHistoryPanel.vue`：详情页嵌入 `MediaInspector` 只读区（去重 UI）
- `VideoDockPanel.vue`：生成按钮上方显示 `refPreflight` banner（warn/error）
- `useNodeGeneration.applyStudioRecord`：写入 `mediaInfo` 摘要

---

## Error handling

| 场景 | 行为 |
|------|------|
| probe 超时 | `probeStatus: failed`；Inspector 显示「未能读取文件属性」 |
| 私有/不可达 URL | probe failed；视频 preflight error → 阻止生成 |
| 旧记录无 mediaInfo | Inspector lazy 调 `/media-probe` |
| 用户取消平台回退 | 不影响 Inspector；诊断 Tab 仍可用 |

---

## Testing & acceptance

### 单元

- `packages/shared/src/mediaInfo.test.ts`：阈值判定、`evaluateMediaRefPreflight()`
- `apps/server/src/media/media-probe.service.test.ts`：PNG/JPEG 头解析
- `apps/server/src/studio/studio.video-preflight.test.ts`：3 refs 含 3072×4096 → 400

### 集成

- video generate with oversized ref → 不调用 upstream；metadata 含 preflight

### 生产验收脚本

`deploy/prod-media-inspector-verify.py`：

1. 登录生产
2. 查 `cmsud22f6003gpf01oybnvosn` 同类 session 最近 video record
3. 断言 GET generation 返回 `mediaInfo.references[].bytes`
4. （可选）POST 模拟超大 ref 应 400

### 人工 UAT

- [ ] 画布 image 节点 completed → hover 见尺寸；ⓘ 打开 Inspector
- [ ] 资产库存库后 Inspector 见生成模型
- [ ] video 节点 3 refs 含大图 → Dock banner 红色；点生成被拦截（P0）
- [ ] 任务历史详情与 Inspector 信息一致

---

## Phasing

| 阶段 | 交付 | 验收 |
|------|------|------|
| **P0** | shared 类型 + probe service + video preflight block + Inspector L1/L2/L3 + 节点/历史入口 | ✅ 已交付 (#250–#256) |
| **P1** | UserAsset.metadata + 资产库 Inspector + 自动 downscale inline | ✅ 本 PR |
| **P2** | 批量列表视图 + Material 路径深化 | 部分完成（#254 material mediaInfo） |

本 plan 文件 **仅覆盖 P0**；P1/P2 另开 plan 或在本 plan 末尾 Extension 节跟踪。

---

## Open questions (resolved in spec)

| 问题 | 决议 |
|------|------|
| 预检 block 还是仅 warn？ | P0：**error 阈值 block**；warn 仅 UI |
| Inspector 与 Dock 合并？ | **否**，职责分离 |
| ffprobe 取视频时长？ | P0 用 metadata.duration；probe 不依赖 ffprobe |

---

## Spec self-review

- [x] 无 TBD / 占位段落
- [x] 与失败诊断规格不矛盾（成功 ⓘ / 失败 diagnostic Tab）
- [x] P0 范围可在一个 plan 内完成
- [x] 生产故障 case 有明确阈值与验收
