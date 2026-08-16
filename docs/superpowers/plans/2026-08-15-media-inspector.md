# 媒体属性 Inspector + 视频参考图预检 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现画布/资产库统一的只读 **MediaInspector**（L0 摘要 + L1 属性 Drawer），服务端 **mediaInfo probe** 落库，并在视频 keyframes 生成前 **block 超大参考图**，防止 Agnes 400 类失败。

**Architecture:** `@lnkpi/shared` 定义 `MediaInfo` 与预检阈值；Nest `MediaProbeService` 在生成完成与 video 发起前 probe；`studio.service` 写 metadata + preflight 拦截；Vue `MediaInspectorDrawer` 统一入口，节点/任务历史/VideoDock 集成。

**Tech Stack:** NestJS、Prisma SQLite、Vue 3 + Element Plus、Vitest、Python prod verify

**Spec:** `docs/superpowers/specs/2026-08-15-media-inspector-design.md`

## Global Constraints

- P0 范围：**不含** UserAsset.metadata 迁移（P1）、**不含** 自动 downscale inline（P1）
- Inspector 与 Dock **职责分离**：Inspector 只读，Dock 可编辑
- 成功态节点 ⓘ 打开 Inspector；失败态 diagnostic **复用**现有 `NodeDiagnosticPopover` / GET diagnostic
- 视频 preflight：`level === 'error'` 且 `refWire === 'agnes_keyframes'` → **400 block**，不调用 upstream
- 阈值（verbatim）：warn 5MB / 2048px；error 10MB / 4096px
- probe 超时 10s；`/studio/media-probe` rate limit 30/min/user
- TDD：先写失败测试再实现；提交前缀 `feat:` / `fix:` / `test:`

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/mediaInfo.ts` | `MediaInfo`, `ProbedMediaFile`, 阈值, `evaluateMediaRefPreflight()` |
| `packages/shared/src/mediaInfo.test.ts` | 共享单测 |
| `packages/shared/src/index.ts` | 导出 |
| `apps/server/src/media/media-probe.service.ts` | URL probe（HEAD + 图片头解析） |
| `apps/server/src/media/media-probe.service.test.ts` | probe 单测 |
| `apps/server/src/media/media-probe.module.ts` | Nest module |
| `apps/server/src/studio/studio.service.ts` | completed 写 mediaInfo；video preflight |
| `apps/server/src/studio/studio.controller.ts` | `GET media-probe`；generation 响应扩展 |
| `apps/server/src/studio/studio.video-preflight.test.ts` | 超大 ref block |
| `apps/web/src/components/media/MediaInspectorDrawer.vue` | L1/L2 UI |
| `apps/web/src/components/media/MediaInfoSummary.vue` | L0 摘要 |
| `apps/web/src/components/media/MediaRefList.vue` | 参考图 + badge |
| `apps/web/src/composables/useMediaInspector.ts` | 状态 + API |
| `apps/web/src/services/studio-api.ts` | 类型 + probe client |
| `apps/web/src/composables/useNodeGeneration.ts` | `applyStudioRecord` 写摘要 |
| `apps/web/src/components/canvas/CanvasNodeImage.vue` | L0 + ⓘ |
| `apps/web/src/components/canvas/CanvasNodeVideo.vue` | L0 + ⓘ |
| `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` | preflight banner |
| `apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue` | 嵌入 Inspector 区 |
| `deploy/prod-media-inspector-verify.py` | 生产验收 |

---

### Task 0: 分支与基线

**Files:** —

- [ ] **Step 1:** `git checkout main && git pull origin main`
- [ ] **Step 2:** `git checkout -b feature/media-inspector-p0`
- [ ] **Step 3:** `pnpm build` 确认基线绿

---

### Task 1: Shared MediaInfo 类型与预检逻辑

**Files:**
- Create: `packages/shared/src/mediaInfo.ts`
- Create: `packages/shared/src/mediaInfo.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `export interface ProbedMediaFile { url: string; width?: number; height?: number; bytes?: number; mimeType?: string; durationSec?: number; probeStatus: 'ok' | 'failed' | 'pending'; probeError?: string }`
  - `export interface MediaInfo { output?: ProbedMediaFile; references?: Array<ProbedMediaFile & { refKey?: string; role?: string }>; probedAt?: string }`
  - `export type MediaRefWarningLevel = 'none' | 'warn' | 'error'`
  - `export interface MediaRefPreflight { level: MediaRefWarningLevel; code?: string; message: string; refs: Array<{ url: string; refKey?: string; width?: number; height?: number; bytes?: number; level: MediaRefWarningLevel }> }`
  - `export const VIDEO_REF_WARN_BYTES`, `VIDEO_REF_ERROR_BYTES`, `VIDEO_REF_WARN_MAX_EDGE`, `VIDEO_REF_ERROR_MAX_EDGE`
  - `export function maxEdge(width?: number, height?: number): number`
  - `export function classifyRefSize(file: Pick<ProbedMediaFile, 'width' | 'height' | 'bytes'>): MediaRefWarningLevel`
  - `export function evaluateMediaRefPreflight(refs: Array<ProbedMediaFile & { refKey?: string }>, opts?: { blockWire?: string }): MediaRefPreflight`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  classifyRefSize,
  evaluateMediaRefPreflight,
  VIDEO_REF_ERROR_BYTES,
} from './mediaInfo'

describe('classifyRefSize', () => {
  it('errors on 3072x4096 13MB poster (prod case)', () => {
    expect(classifyRefSize({ width: 3072, height: 4096, bytes: 13_367_984 })).toBe('error')
  })
  it('warns on 1024x1024 6MB', () => {
    expect(classifyRefSize({ width: 1024, height: 1024, bytes: 6 * 1024 * 1024 })).toBe('warn')
  })
  it('none on 1024x1024 1MB', () => {
    expect(classifyRefSize({ width: 1024, height: 1024, bytes: 1_000_000 })).toBe('none')
  })
})

describe('evaluateMediaRefPreflight', () => {
  it('returns error level when any ref exceeds error threshold', () => {
    const r = evaluateMediaRefPreflight([
      { url: 'a', refKey: 'I1', width: 1024, height: 1024, bytes: 900_000, probeStatus: 'ok' },
      { url: 'b', refKey: 'I3', width: 3072, height: 4096, bytes: VIDEO_REF_ERROR_BYTES + 1, probeStatus: 'ok' },
    ])
    expect(r.level).toBe('error')
    expect(r.message).toMatch(/I3/)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/mediaInfo.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Implement `mediaInfo.ts` + export in `index.ts`**

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mediaInfo.ts packages/shared/src/mediaInfo.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): MediaInfo types and video ref preflight thresholds"
```

---

### Task 2: MediaProbeService（服务端 probe）

**Files:**
- Create: `apps/server/src/media/media-probe.service.ts`
- Create: `apps/server/src/media/media-probe.service.test.ts`
- Create: `apps/server/src/media/media-probe.module.ts`
- Modify: `apps/server/src/studio/studio.module.ts`（import MediaProbeModule）

**Interfaces:**
- Produces:
  - `@Injectable() class MediaProbeService { probeUrl(url: string): Promise<ProbedMediaFile> }`
  - `parsePngDimensions(buf: Buffer): { width: number; height: number } | null`
  - `parseJpegDimensions(buf: Buffer): { width: number; height: number } | null`

- [ ] **Step 1: Write failing tests**（PNG IHDR 假 buffer + JPEG SOF 假 buffer；mock fetch HEAD）

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/media/media-probe.service.test.ts`

- [ ] **Step 3: Implement probe**（HEAD content-length；GET Range 0-65535 解析宽高）

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): MediaProbeService for URL dimension and size probe"
```

---

### Task 3: 生成完成写 mediaInfo + GET 扩展

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.controller.ts`
- Create: `apps/server/src/studio/studio.media-info.test.ts`

**Interfaces:**
- Consumes: `MediaProbeService`, `MediaInfo` from shared
- Produces:
  - `private async attachMediaInfoToRecord(recordId: string, outputUrl: string | null, referenceUrls: string[]): Promise<void>`
  - `GET /studio/generations/:id` 响应 JSON 增加 `mediaInfo?: MediaInfo`

- [ ] **Step 1: Test** — mock probe；image completed 后 metadata 含 `mediaInfo.output.width`

- [ ] **Step 2: Implement** — 在 `completeImage` / `completeVideo` success 分支调用 `attachMediaInfoToRecord`

- [ ] **Step 3: Run tests + `pnpm build`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(studio): persist mediaInfo on generation complete"
```

---

### Task 4: Video 参考图 preflight（block 超大 ref）

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`（`generateVideo` / `completeVideo` 前）
- Create: `apps/server/src/studio/studio.video-preflight.test.ts`

**Interfaces:**
- Consumes: `evaluateMediaRefPreflight`, `MediaProbeService`
- Produces: 抛 `BadRequestException` message 含 refKey；metadata 写 `refPreflight`

- [ ] **Step 1: Write failing test**

```ts
it('blocks agnes_keyframes when ref exceeds error threshold', async () => {
  // mock probe returning 3072x4096 13MB for third ref
  await expect(svc.generateVideo(/* ... 3 refs ... */)).rejects.toThrow(/I3|过大/)
  expect(videoGenerate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement preflight in generateVideo**（probe refs → evaluate → block）

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(studio): block oversized video keyframe references before upstream"
```

---

### Task 5: GET /studio/media-probe

**Files:**
- Modify: `apps/server/src/studio/studio.controller.ts`
- Modify: `apps/server/src/studio/studio.media-info.test.ts`

- [ ] **Step 1: Test** — 鉴权用户 probe allowlist URL 返回 ProbedMediaFile

- [ ] **Step 2: Implement** — query `url`；拒绝非 http(s) / 非 allowlist（`platform-outputs.agnes-ai.space`, 本机 uploads 等）

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(studio): authenticated media-probe endpoint"
```

---

### Task 6: 前端 API + useMediaInspector

**Files:**
- Modify: `apps/web/src/services/studio-api.ts`
- Create: `apps/web/src/composables/useMediaInspector.ts`

- [ ] **Step 1: Extend `GenerationRecord` type** with `mediaInfo?: MediaInfo`, `refPreflight?: MediaRefPreflight`

- [ ] **Step 2: Add `studioApi.probeMedia(url)`**

- [ ] **Step 3: `useMediaInspector`** — `open({ generationRecordId?, url?, nodeId? })`；lazy fetch；缓存 Map

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): media inspector composable and studio API types"
```

---

### Task 7: MediaInspector UI 组件

**Files:**
- Create: `apps/web/src/components/media/MediaInspectorDrawer.vue`
- Create: `apps/web/src/components/media/MediaInfoSummary.vue`
- Create: `apps/web/src/components/media/MediaRefList.vue`

- [ ] **Step 1: MediaInfoSummary** — props: `{ width?, height?, bytes?, model?, refWarning? }`

- [ ] **Step 2: MediaRefList** — 列表 + warn/error badge

- [ ] **Step 3: MediaInspectorDrawer** — 320px ElDrawer；区块：预览、文件、生成、参考、操作按钮

- [ ] **Step 4: Manual smoke** — Storybook 或 Canvas 本地打开

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): MediaInspector drawer and summary components"
```

---

### Task 8: 画布节点 + useNodeGeneration 集成

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue`
- Modify: `apps/web/src/components/canvas/CanvasNodeVideo.vue`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`

- [ ] **Step 1: `applyStudioRecord`** — 从 `record.mediaInfo` 写 `node.data.mediaInfo` 摘要

- [ ] **Step 2: completed 节点** — 底部 `MediaInfoSummary`；右上角 ⓘ `@click="inspector.open({ generationRecordId })"`

- [ ] **Step 3: 失败节点** — ⓘ 仍走 diagnostic；可选双按钮（属性 | 诊断）

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(canvas): node media summary and inspector entry"
```

---

### Task 9: VideoDock preflight banner

**Files:**
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`

- [ ] **Step 1: 选中 video 节点且有 referenceImages 时** — 调 probe（或读最近 failed record 的 pattern：生成前 client-side classify 若已有 mediaInfo on upstream image nodes）

- [ ] **Step 2: P0 简化** — 生成 POST 若 400 preflight，toast 展示 server message

- [ ] **Step 3: warn/error ElAlert** above 生成按钮 when refs probed

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): video dock ref preflight warning banner"
```

---

### Task 10: 任务历史复用 Inspector

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue`

- [ ] **Step 1: 详情展开区** — 替换/并列现有参数字段为 `<MediaInspectorDrawer inline :record="record" />` 或只读子集

- [ ] **Step 2: 避免重复 fetch** — 用 record 已有 mediaInfo

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): task history uses MediaInspector read-only section"
```

---

### Task 11: 生产验收脚本

**Files:**
- Create: `deploy/prod-media-inspector-verify.py`

- [ ] **Step 1: 脚本逻辑**

```python
# 1. login
# 2. GET /studio/generations?limit=5&type=video — find recent with referenceImages
# 3. GET /studio/generations/:id — assert "mediaInfo" in response (after deploy)
# 4. GET /studio/media-probe?url=<known png> — assert width/height
# 5. print PASS/FAIL
```

- [ ] **Step 2: 本地 dry-run** against prod（只读）

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(deploy): prod media inspector verify script"
```

---

### Task 12: CI + PR

- [ ] **Step 1:** `pnpm build`
- [ ] **Step 2:** `pnpm --filter @lnkpi/shared exec vitest run src/mediaInfo.test.ts`
- [ ] **Step 3:** `pnpm --filter @lnkpi/server exec vitest run src/media/media-probe.service.test.ts src/studio/studio.video-preflight.test.ts src/studio/studio.media-info.test.ts`
- [ ] **Step 4:** `gh pr create` → CI watch → merge

---

## Execution tracking（闭环）

> 实施过程中在本节勾选；PR merge 后补 **生产验证** 行。

| ID | Task | Owner | Status | Evidence |
|----|------|-------|--------|----------|
| T0 | 分支基线 | — | `[ ]` | |
| T1 | shared mediaInfo | — | `[ ]` | vitest log |
| T2 | MediaProbeService | — | `[ ]` | vitest log |
| T3 | completed 写 mediaInfo | — | `[ ]` | studio.media-info.test |
| T4 | video preflight block | — | `[ ]` | studio.video-preflight.test |
| T5 | media-probe API | — | `[ ]` | curl / pytest |
| T6 | web composable | — | `[ ]` | |
| T7 | Inspector UI | — | `[ ]` | screenshot |
| T8 | 画布节点集成 | — | `[ ]` | manual UAT |
| T9 | VideoDock banner | — | `[ ]` | manual UAT |
| T10 | 任务历史 | — | `[ ]` | manual UAT |
| T11 | prod verify script | — | `[ ]` | `prod-media-inspector-verify.py` |
| T12 | CI / PR / merge | — | `[ ]` | PR URL |

### 生产验证（merge + deploy 后）

- [ ] `python3 deploy/prod-media-inspector-verify.py` 全绿
- [ ] 会话 `cmsocwe7o000yqf01lbgv77wm` 复现：3 refs 含 3072 海报 → 生成前 UI 告警 + API 400 block
- [ ] 新 video 生成 completed → GET record 含 `mediaInfo.output`

### UAT checklist（spec §Testing）

- [ ] 画布 image completed → hover 尺寸；ⓘ Inspector
- [ ] video 超大 ref → Dock 红 banner；无法发起生成
- [ ] 任务历史与 Inspector 信息一致

---

## P1 extension（已完成 #256）

| 项 | Spec 节 | 状态 |
|----|---------|------|
| UserAsset.metadata 迁移 | §Data model | `[x]` |
| 资产库 Inspector 入口 + L0 hover | §UX | `[x]` |
| POST /assets generationRecordId | §API | `[x]` |
| 超大 ref 自动 downscale inline | §Server P1 | `[x]` agnes_keyframes 预检前 downscale |

## P0 polish（已完成 #256）

| 项 | 状态 |
|----|------|
| 预览浮层「更多信息」 | `[x]` |
| 失败占位节点 ⓘ | `[x]` |
| L2 字段复制 | `[x]` |
| 任务历史 UI 去重 | `[x]` |
| 移动端 Drawer 全宽 | `[x]` |

---

## Plan self-review

- [x] Spec P0 每条需求可映射到 Task 1–12
- [x] 无 TBD 步骤；测试命令具体
- [x] 生产故障 case 覆盖 Task 1 + Task 4 + Task 11
- [x] 类型名前后一致（`MediaInfo`, `MediaRefPreflight`, `ProbedMediaFile`）

---

**Plan complete.** 执行选项：

1. **Subagent-Driven（推荐）** — 每 Task 独立 subagent + 任务间 review  
2. **Inline Execution** — 本会话按 Task 0→12 连续实施 + checkpoint

请告知选择；若 spec 需修改，先改 spec 再动代码。
