# 画布媒体信息外置底栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布图/视频/音频/`mediaInput` 的 L0 摘要改为 `NeoBaseNode` 外置底栏；有 URL 即 ensure `mediaInfo`（probe + 音频前端时长），去掉像素上的 overlay 黑条。

**Architecture:** 纯函数负责 probe→summary 合并与「是否需要 ensure」；`useNodeMediaInfoFooter` 用 `CANVAS_NODE_PATCH_KEY` 写回节点。`NeoBaseNode` 只提供 `#footer` 槽与对称 CSS。各媒体节点把 `MediaInfoSummary` 放进 footer，并去掉 `--overlay`。

**Tech Stack:** Vue 3、Vitest、`@vue/test-utils`、现有 `studioApi.probeMedia`、`CANVAS_NODE_PATCH_KEY`

**Spec:** `docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md`

## Global Constraints

- 底栏在卡片外：`bottom: -32px`，镜像标题 `top: -32px`；**禁止**再把画布节点摘要叠在媒体像素上
- 节点范围仅：`image` / `video` / `audio` / `mediaInput`
- 视频 L0 **不含**时长；音频 L0：**时长 · 格式 · 大小**
- 可见性：有 URL 且至少一项可展示 → 显示；**不再**要求 `status === completed`
- 服务端 probe **本轮不改**；音频 `durationSec` 仅前端 `loadedmetadata`
- 资产面板 / 任务历史 overlay **本轮不动**
- 禁止 SAM / 抠图 / Inspector 点击入口改动
- TDD：先失败测试再实现；提交前缀 `feat:` / `test:` / `docs:`
- 不 `git add -A`；勿提交 `.seedream-backup`、`deploy/`、`q.js`、`.superpowers/sdd/*`、`apps/server/prisma/prisma/`
- 功能开发走 `feature/cx-media-info-footer`，禁止直接往 main 堆实现提交（docs 已在 main 的设计提交可作基线）

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/utils/mediaInfoFormat.ts` | `formatMediaDuration` / `formatMediaFormat` / `aspectRatioLabel` |
| `apps/web/src/utils/mediaInfoFormat.test.ts` | 上述纯函数单测 |
| `apps/web/src/components/media/MediaInfoSummary.vue` | `kind: audio` + duration/format 行；video 仍无时长 |
| `apps/web/src/components/media/MediaInfoSummary.test.ts` | 挂载断言拼接文案 |
| `apps/web/src/composables/useMediaInspector.ts` | `NodeMediaInfoSummary` 扩 `audio` / `durationSec` / `format` |
| `apps/web/src/composables/nodeMediaInfo.ts` | `hasSummaryPayload` / `needsMediaInfoEnsure` / `summaryFromProbed` / `mergeNodeMediaInfo` |
| `apps/web/src/composables/nodeMediaInfo.test.ts` | 纯函数单测 |
| `apps/web/src/composables/useNodeMediaInfoFooter.ts` | watch url → probe/patch；`applyDurationSec` |
| `apps/web/src/composables/useNodeMediaInfoFooter.test.ts` | mock inject + probe |
| `apps/web/src/components/canvas/NeoBaseNode.vue` | `#footer` 槽 |
| `apps/web/src/styles/neo-node.css` | `.neo-node-external-footer` |
| `CanvasNodeImage.vue` / `Video` / `Audio` / `MediaInput.vue` | 接 footer + composable；去 overlay |

---

### Task 0: Feature 分支

- [ ] **Step 1: 切分支**

```bash
git checkout main
git pull origin main 2>/dev/null || true
# 若本地已有设计 commit 8bfd6b0 且 ahead，直接基于当前 HEAD：
git checkout -b feature/cx-media-info-footer
```

- [ ] **Step 2: 基线**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useMediaInspector.test.ts
```

Expected: PASS

---

### Task 1: 格式化工具（时长 / 格式 / 比例）

**Files:**
- Modify: `apps/web/src/utils/mediaInfoFormat.ts`
- Create: `apps/web/src/utils/mediaInfoFormat.test.ts`

**Interfaces:**
- Produces:
  - `formatMediaDuration(durationSec?: number): string | null` — 有效有限非负；`<1h` → `m:ss`（如 `0:03`、`1:05`）；`≥1h` → `h:mm:ss`
  - `formatMediaFormat(mimeOrExt?: string): string | null` — `audio/mpeg`→`MP3`；`audio/wav`/`audio/x-wav`→`WAV`；`audio/mp4`/`audio/aac`→`M4A`/`AAC`；裸 `mp3`→`MP3`；未知返回大写扩展或 mime 子类型
  - `aspectRatioLabel(width?: number, height?: number): string | null` — 用 gcd 约分，如 `1920×1080`→`16:9`

- [ ] **Step 1: Write the failing test**

创建 `apps/web/src/utils/mediaInfoFormat.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  formatMediaBytes,
  formatMediaDimensions,
  formatMediaDuration,
  formatMediaFormat,
  aspectRatioLabel,
} from './mediaInfoFormat'

describe('formatMediaDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMediaDuration(3)).toBe('0:03')
    expect(formatMediaDuration(65)).toBe('1:05')
  })
  it('formats hours as h:mm:ss', () => {
    expect(formatMediaDuration(3661)).toBe('1:01:01')
  })
  it('returns null for invalid', () => {
    expect(formatMediaDuration(undefined)).toBeNull()
    expect(formatMediaDuration(Number.NaN)).toBeNull()
    expect(formatMediaDuration(-1)).toBeNull()
  })
})

describe('formatMediaFormat', () => {
  it('maps common audio mime types', () => {
    expect(formatMediaFormat('audio/mpeg')).toBe('MP3')
    expect(formatMediaFormat('audio/wav')).toBe('WAV')
    expect(formatMediaFormat('mp3')).toBe('MP3')
  })
  it('returns null for empty', () => {
    expect(formatMediaFormat(undefined)).toBeNull()
    expect(formatMediaFormat('')).toBeNull()
  })
})

describe('aspectRatioLabel', () => {
  it('reduces dimensions', () => {
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9')
    expect(aspectRatioLabel(1024, 1024)).toBe('1:1')
  })
  it('returns null when incomplete', () => {
    expect(aspectRatioLabel(100, undefined)).toBeNull()
  })
})

describe('existing helpers still work', () => {
  it('bytes and dims', () => {
    expect(formatMediaBytes(1024)).toBe('1.0KB')
    expect(formatMediaDimensions(10, 20)).toBe('10×20')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/utils/mediaInfoFormat.test.ts
```

Expected: FAIL（`formatMediaDuration` 等未导出）

- [ ] **Step 3: Write minimal implementation**

在 `mediaInfoFormat.ts` 追加：

```ts
function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

export function formatMediaDuration(durationSec?: number): string | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec < 0) return null
  const total = Math.floor(durationSec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

const MIME_FORMAT: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/mp4': 'M4A',
  'audio/aac': 'AAC',
  'audio/ogg': 'OGG',
  'audio/flac': 'FLAC',
  'audio/webm': 'WEBM',
}

export function formatMediaFormat(mimeOrExt?: string): string | null {
  const raw = mimeOrExt?.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (MIME_FORMAT[lower]) return MIME_FORMAT[lower]
  if (!lower.includes('/')) return lower.replace(/^\./, '').toUpperCase()
  const sub = lower.split('/')[1]?.split(';')[0]?.trim()
  if (!sub) return null
  if (sub === 'mpeg' || sub === 'mp3') return 'MP3'
  return sub.toUpperCase()
}

export function aspectRatioLabel(width?: number, height?: number): string | null {
  if (width == null || height == null || width <= 0 || height <= 0) return null
  const g = gcd(width, height)
  return `${Math.round(width / g)}:${Math.round(height / g)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/utils/mediaInfoFormat.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/mediaInfoFormat.ts apps/web/src/utils/mediaInfoFormat.test.ts
git commit -m "feat(web): media duration/format/aspect formatters"
```

---

### Task 2: `MediaInfoSummary` 支持 audio

**Files:**
- Modify: `apps/web/src/composables/useMediaInspector.ts`（仅类型）
- Modify: `apps/web/src/components/media/MediaInfoSummary.vue`
- Create: `apps/web/src/components/media/MediaInfoSummary.test.ts`

**Interfaces:**
- Produces: `NodeMediaInfoSummary.kind` 含 `'audio'`；可选 `durationSec?: number`；`format?: string`
- `MediaInfoSummary` props 同步；audio 行：`formatMediaDuration` · `format` · `formatMediaBytes`；**video 分支不读 durationSec**

- [ ] **Step 1: Write the failing test**

创建 `MediaInfoSummary.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaInfoSummary from './MediaInfoSummary.vue'

describe('MediaInfoSummary', () => {
  it('renders audio as duration · format · size', () => {
    const w = mount(MediaInfoSummary, {
      props: { kind: 'audio', durationSec: 65, format: 'MP3', bytes: 1024 * 1024 },
    })
    expect(w.text()).toContain('1:05')
    expect(w.text()).toContain('MP3')
    expect(w.text()).toContain('1.0MB')
  })

  it('video line ignores durationSec', () => {
    const w = mount(MediaInfoSummary, {
      props: {
        kind: 'video',
        resolution: '720p',
        aspectRatio: '16:9',
        bytes: 2048,
        durationSec: 99,
      },
    })
    expect(w.text()).toContain('720p')
    expect(w.text()).not.toContain('1:39')
    expect(w.text()).not.toContain('99')
  })

  it('image line keeps dims · aspect · size', () => {
    const w = mount(MediaInfoSummary, {
      props: { kind: 'image', width: 1024, height: 1024, aspectRatio: '1:1', bytes: 512 },
    })
    expect(w.text()).toContain('1024×1024')
    expect(w.text()).toContain('1:1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/media/MediaInfoSummary.test.ts
```

Expected: FAIL（audio 未拼时长/格式）

- [ ] **Step 3: Update types + component**

`useMediaInspector.ts` 中：

```ts
export interface NodeMediaInfoSummary {
  kind?: 'image' | 'video' | 'audio'
  width?: number
  height?: number
  bytes?: number
  aspectRatio?: string
  resolution?: string
  durationSec?: number
  format?: string
  refWarning?: 'warn' | 'error'
}
```

`MediaInfoSummary.vue` script：

```ts
import { formatMediaBytes, formatMediaDimensions, formatMediaDuration } from '@/utils/mediaInfoFormat'

const props = defineProps<{
  kind?: 'image' | 'video' | 'audio'
  width?: number
  height?: number
  bytes?: number
  aspectRatio?: string
  resolution?: string
  durationSec?: number
  format?: string
  refWarning?: MediaRefWarningLevel
}>()

const parts = computed(() => {
  const line: string[] = []
  const size = formatMediaBytes(props.bytes)
  if (props.kind === 'audio') {
    const dur = formatMediaDuration(props.durationSec)
    if (dur) line.push(dur)
    if (props.format?.trim()) line.push(props.format.trim())
    if (size) line.push(size)
    return line
  }
  if (props.kind === 'video') {
    if (props.resolution?.trim()) line.push(props.resolution.trim())
    if (props.aspectRatio?.trim()) line.push(props.aspectRatio.trim())
    if (size) line.push(size)
    return line
  }
  const dims = formatMediaDimensions(props.width, props.height)
  if (dims) line.push(dims)
  if (props.aspectRatio?.trim()) line.push(props.aspectRatio.trim())
  if (size) line.push(size)
  return line
})
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/media/MediaInfoSummary.test.ts src/composables/useMediaInspector.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useMediaInspector.ts \
  apps/web/src/components/media/MediaInfoSummary.vue \
  apps/web/src/components/media/MediaInfoSummary.test.ts
git commit -m "feat(web): MediaInfoSummary audio L0 fields"
```

---

### Task 3: 纯函数 `nodeMediaInfo`（probe→summary / merge / needsEnsure）

**Files:**
- Create: `apps/web/src/composables/nodeMediaInfo.ts`
- Create: `apps/web/src/composables/nodeMediaInfo.test.ts`

**Interfaces:**
- Consumes: `NodeMediaInfoSummary`；`ProbedMediaFile`（`@lnkpi/shared`）；`aspectRatioLabel` / `formatMediaFormat`
- Produces:
  - `hasSummaryPayload(summary?: NodeMediaInfoSummary): boolean`
  - `needsMediaInfoEnsure(kind, summary, url): boolean` — 无 url→false；无 summary 或 `!hasSummaryPayload`→true；audio 且缺 `durationSec` 仍返回 true（需前端补时长，但 probe 可跳过——见 composable）
  - `summaryFromProbed(kind, probed): NodeMediaInfoSummary | undefined`
  - `mergeNodeMediaInfo(prev, next): NodeMediaInfoSummary` — 逐字段：next 有值才覆盖；保留 prev 的其余字段

说明：`needsMediaInfoEnsure` 用于「是否该跑 ensure」。音频缺时长时 composable 仍可只走 `applyDurationSec` 而不重复 probe（用模块级 `probedUrls` Set）。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { ProbedMediaFile } from '@lnkpi/shared'
import {
  hasSummaryPayload,
  needsMediaInfoEnsure,
  summaryFromProbed,
  mergeNodeMediaInfo,
} from './nodeMediaInfo'

const okProbe = (partial: Partial<ProbedMediaFile>): ProbedMediaFile => ({
  url: 'https://x/a.bin',
  probeStatus: 'ok',
  ...partial,
})

describe('hasSummaryPayload', () => {
  it('true when display fields present', () => {
    expect(hasSummaryPayload({ kind: 'image', width: 1, height: 1 })).toBe(true)
    expect(hasSummaryPayload({ kind: 'audio', format: 'MP3' })).toBe(true)
    expect(hasSummaryPayload({ kind: 'image' })).toBe(false)
  })
})

describe('needsMediaInfoEnsure', () => {
  it('false without url', () => {
    expect(needsMediaInfoEnsure('image', undefined, '')).toBe(false)
  })
  it('true when missing payload', () => {
    expect(needsMediaInfoEnsure('image', undefined, 'https://x')).toBe(true)
  })
  it('false when image payload complete enough', () => {
    expect(needsMediaInfoEnsure('image', { kind: 'image', bytes: 10 }, 'https://x')).toBe(false)
  })
  it('true for audio missing duration even if format present', () => {
    expect(
      needsMediaInfoEnsure('audio', { kind: 'audio', format: 'MP3', bytes: 1 }, 'https://x'),
    ).toBe(true)
  })
})

describe('summaryFromProbed', () => {
  it('builds image summary', () => {
    const s = summaryFromProbed('image', okProbe({ width: 1920, height: 1080, bytes: 100 }))
    expect(s).toMatchObject({ kind: 'image', width: 1920, height: 1080, bytes: 100, aspectRatio: '16:9' })
  })
  it('builds audio format from mime', () => {
    const s = summaryFromProbed('audio', okProbe({ mimeType: 'audio/mpeg', bytes: 50 }))
    expect(s).toMatchObject({ kind: 'audio', format: 'MP3', bytes: 50 })
  })
  it('builds video with dims as resolution fallback', () => {
    const s = summaryFromProbed('video', okProbe({ width: 1280, height: 720, bytes: 9 }))
    expect(s?.kind).toBe('video')
    expect(s?.bytes).toBe(9)
    expect(s?.aspectRatio).toBe('16:9')
    expect(s?.resolution).toBe('1280×720')
  })
})

describe('mergeNodeMediaInfo', () => {
  it('does not clobber with empty next fields', () => {
    const merged = mergeNodeMediaInfo(
      { kind: 'audio', format: 'MP3', bytes: 10, durationSec: 3 },
      { kind: 'audio', format: undefined, bytes: 20 },
    )
    expect(merged).toEqual({ kind: 'audio', format: 'MP3', bytes: 20, durationSec: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/nodeMediaInfo.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `nodeMediaInfo.ts`**

```ts
import type { ProbedMediaFile } from '@lnkpi/shared'
import type { NodeMediaInfoSummary } from '@/composables/useMediaInspector'
import { aspectRatioLabel, formatMediaDimensions, formatMediaFormat } from '@/utils/mediaInfoFormat'

export function hasSummaryPayload(summary?: NodeMediaInfoSummary): boolean {
  if (!summary) return false
  const { kind: _k, refWarning: _r, ...rest } = summary
  return Object.values(rest).some((v) => v != null && v !== '')
}

export function needsMediaInfoEnsure(
  kind: 'image' | 'video' | 'audio',
  summary: NodeMediaInfoSummary | undefined,
  url: string | undefined,
): boolean {
  if (!url?.trim()) return false
  if (!hasSummaryPayload(summary)) return true
  if (kind === 'audio' && (summary?.durationSec == null || !Number.isFinite(summary.durationSec))) {
    return true
  }
  return false
}

export function summaryFromProbed(
  kind: 'image' | 'video' | 'audio',
  probed: ProbedMediaFile,
): NodeMediaInfoSummary | undefined {
  const summary: NodeMediaInfoSummary = { kind }
  if (probed.bytes != null) summary.bytes = probed.bytes
  if (kind === 'audio') {
    const fmt = formatMediaFormat(probed.mimeType)
    if (fmt) summary.format = fmt
    if (probed.durationSec != null) summary.durationSec = probed.durationSec
  } else if (kind === 'video') {
    const dims = formatMediaDimensions(probed.width, probed.height)
    if (dims) summary.resolution = dims
    const ar = aspectRatioLabel(probed.width, probed.height)
    if (ar) summary.aspectRatio = ar
  } else {
    if (probed.width != null) summary.width = probed.width
    if (probed.height != null) summary.height = probed.height
    const ar = aspectRatioLabel(probed.width, probed.height)
    if (ar) summary.aspectRatio = ar
  }
  return hasSummaryPayload(summary) ? summary : undefined
}

export function mergeNodeMediaInfo(
  prev: NodeMediaInfoSummary | undefined,
  next: NodeMediaInfoSummary,
): NodeMediaInfoSummary {
  const out: NodeMediaInfoSummary = { ...(prev ?? {}), ...next, kind: next.kind ?? prev?.kind }
  const keys = [
    'width',
    'height',
    'bytes',
    'aspectRatio',
    'resolution',
    'durationSec',
    'format',
    'refWarning',
  ] as const
  for (const k of keys) {
    const v = next[k]
    if (v == null || v === '') {
      if (prev?.[k] != null && prev[k] !== '') (out as Record<string, unknown>)[k] = prev[k]
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/nodeMediaInfo.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/nodeMediaInfo.ts apps/web/src/composables/nodeMediaInfo.test.ts
git commit -m "feat(web): node mediaInfo probe merge helpers"
```

---

### Task 4: `useNodeMediaInfoFooter` composable

**Files:**
- Create: `apps/web/src/composables/useNodeMediaInfoFooter.ts`
- Create: `apps/web/src/composables/useNodeMediaInfoFooter.test.ts`

**Interfaces:**
- Consumes: `CANVAS_NODE_PATCH_KEY`；`studioApi.probeMedia`；`nodeMediaInfo` helpers
- Produces:
  - `useNodeMediaInfoFooter(args: { nodeId: string; url: MaybeRefOrGetter<string | undefined>; kind: MaybeRefOrGetter<'image'|'video'|'audio'>; mediaInfo: MaybeRefOrGetter<NodeMediaInfoSummary | undefined> })`
  - `applyDurationSec(durationSec: number): void` — 合并 patch `mediaInfo`
  - 行为：`watch` url/kind；若 `needsMediaInfoEnsure` 且该 url 未成功 probe 过 → probe → `merge` → `patchNode(nodeId, { mediaInfo })`；probe 失败静默；同一 url 不重复 probe（模块 `Set`）；音频缺时长时仍允许 `applyDurationSec`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { CANVAS_NODE_PATCH_KEY } from '@/composables/canvasNodeActions'

vi.mock('@/services/studio-api', () => ({
  studioApi: {
    probeMedia: vi.fn(),
  },
}))

import { studioApi } from '@/services/studio-api'
import { useNodeMediaInfoFooter } from './useNodeMediaInfoFooter'

describe('useNodeMediaInfoFooter', () => {
  beforeEach(() => {
    vi.mocked(studioApi.probeMedia).mockReset()
  })

  it('probes and patches when url present without mediaInfo', async () => {
    vi.mocked(studioApi.probeMedia).mockResolvedValue({
      url: 'https://cdn/a.png',
      width: 10,
      height: 10,
      bytes: 100,
      probeStatus: 'ok',
    })
    const patches: Array<Record<string, unknown>> = []
    const url = ref('https://cdn/a.png')
    const mediaInfo = ref(undefined)
    const Comp = defineComponent({
      setup() {
        useNodeMediaInfoFooter({
          nodeId: 'n1',
          url,
          kind: 'image',
          mediaInfo,
        })
        return () => h('div')
      },
    })
    mount(Comp, {
      global: {
        provide: {
          [CANVAS_NODE_PATCH_KEY as symbol]: (id: string, patch: Record<string, unknown>) => {
            expect(id).toBe('n1')
            patches.push(patch)
            mediaInfo.value = patch.mediaInfo as typeof mediaInfo.value
          },
        },
      },
    })
    await nextTick()
    await vi.waitFor(() => expect(studioApi.probeMedia).toHaveBeenCalledWith('https://cdn/a.png'))
    expect(patches[0]?.mediaInfo).toMatchObject({ kind: 'image', width: 10, height: 10, bytes: 100 })
  })

  it('skips probe when payload already present for image', async () => {
    const url = ref('https://cdn/b.png')
    const mediaInfo = ref({ kind: 'image' as const, bytes: 1 })
    const Comp = defineComponent({
      setup() {
        useNodeMediaInfoFooter({ nodeId: 'n2', url, kind: 'image', mediaInfo })
        return () => h('div')
      },
    })
    mount(Comp, {
      global: { provide: { [CANVAS_NODE_PATCH_KEY as symbol]: vi.fn() } },
    })
    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
    expect(studioApi.probeMedia).not.toHaveBeenCalled()
  })
})
```

若 `vi.waitFor` 在项目 Vitest 版本不可用，改用短轮询 `for` + `await nextTick`。

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeMediaInfoFooter.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement composable**

```ts
import { inject, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { CANVAS_NODE_PATCH_KEY } from '@/composables/canvasNodeActions'
import type { NodeMediaInfoSummary } from '@/composables/useMediaInspector'
import {
  hasSummaryPayload,
  mergeNodeMediaInfo,
  needsMediaInfoEnsure,
  summaryFromProbed,
} from '@/composables/nodeMediaInfo'
import { studioApi } from '@/services/studio-api'

const probedOkUrls = new Set<string>()

export function useNodeMediaInfoFooter(args: {
  nodeId: string
  url: MaybeRefOrGetter<string | undefined>
  kind: MaybeRefOrGetter<'image' | 'video' | 'audio'>
  mediaInfo: MaybeRefOrGetter<NodeMediaInfoSummary | undefined>
}) {
  const patchNode = inject(CANVAS_NODE_PATCH_KEY, null)

  async function ensureProbe() {
    const url = String(toValue(args.url) ?? '').trim()
    const kind = toValue(args.kind)
    const current = toValue(args.mediaInfo)
    if (!url || !patchNode) return
    const need = needsMediaInfoEnsure(kind, current, url)
    if (!need) return
    const onlyNeedDuration =
      kind === 'audio' && hasSummaryPayload(current) && current?.durationSec == null
    if (onlyNeedDuration) return
    if (probedOkUrls.has(url) && hasSummaryPayload(current)) return
    try {
      const probed = await studioApi.probeMedia(url)
      if (probed.probeStatus === 'ok') probedOkUrls.add(url)
      const built = summaryFromProbed(kind, probed)
      if (!built) return
      const merged = mergeNodeMediaInfo(toValue(args.mediaInfo), built)
      if (!hasSummaryPayload(merged)) return
      patchNode(args.nodeId, { mediaInfo: merged })
    } catch {
      // silent
    }
  }

  function applyDurationSec(durationSec: number) {
    if (!patchNode || !Number.isFinite(durationSec) || durationSec < 0) return
    const kind = toValue(args.kind)
    if (kind !== 'audio') return
    const merged = mergeNodeMediaInfo(toValue(args.mediaInfo), {
      kind: 'audio',
      durationSec,
    })
    patchNode(args.nodeId, { mediaInfo: merged })
  }

  watch(
    () => [toValue(args.url), toValue(args.kind), toValue(args.mediaInfo)] as const,
    () => {
      void ensureProbe()
    },
    { immediate: true },
  )

  return { applyDurationSec }
}
```

注意：若 `watch` 因 `mediaInfo` 自更新形成循环，依赖 `probedOkUrls` + `needsMediaInfoEnsure` 在 patch 后对 image/video 变为 false 来收敛；音频在 patch 后仍可能 `needs===true`（缺 duration），但 `onlyNeedDuration` 提前 return，避免重复 probe。

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeMediaInfoFooter.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useNodeMediaInfoFooter.ts \
  apps/web/src/composables/useNodeMediaInfoFooter.test.ts
git commit -m "feat(web): useNodeMediaInfoFooter probe ensure"
```

---

### Task 5: `NeoBaseNode` 外置 footer 槽

**Files:**
- Modify: `apps/web/src/components/canvas/NeoBaseNode.vue`
- Modify: `apps/web/src/styles/neo-node.css`

**Interfaces:**
- Produces: named slot `footer`；有 `$slots.footer` 时渲染 `.neo-node-external-footer`

- [ ] **Step 1: CSS**

在 `.neo-node-external-title` 块后追加：

```css
.neo-node-external-footer {
  position: absolute;
  bottom: -32px;
  left: 0;
  right: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  pointer-events: auto;
  min-width: 0;
}
```

- [ ] **Step 2: Template**

在 `NeoBaseNode.vue` 中，外置 title 与 `.neo-node` 之间或 **`.neo-node` 闭合之后**（与 title 同级）插入：

```vue
    <div
      v-if="$slots.footer"
      class="neo-node-external-footer"
      @mouseenter="setHovered(true)"
      @mouseleave="setHovered(false)"
    >
      <slot name="footer" />
    </div>
```

推荐放在 `.neo-node` **之后**、`Handle` **之前**，避免被卡片遮挡。

- [ ] **Step 3: 无单测强制**（可选手动确认非媒体节点无 footer）

非媒体节点不传 `#footer` → 无底栏 DOM。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/NeoBaseNode.vue apps/web/src/styles/neo-node.css
git commit -m "feat(web): NeoBaseNode external footer slot"
```

---

### Task 6: 接线 Image / Video 节点

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue`
- Modify: `apps/web/src/components/canvas/CanvasNodeVideo.vue`

**Interfaces:**
- Consumes: `useNodeMediaInfoFooter`；`NeoBaseNode` `#footer`
- 删除：`showMediaSummary` 对 `completed` 的依赖；删除 `neo-media-info-summary--overlay`

- [ ] **Step 1: Image**

1. 扩展 `data.mediaInfo` 类型与 `NodeMediaInfoSummary` 对齐（含 `audio` 字段可选无妨）。
2. 增加：

```ts
import { useNodeMediaInfoFooter } from '@/composables/useNodeMediaInfoFooter'
import { computed, toRef } from 'vue'

const mediaInfoRef = computed(() => props.data.mediaInfo)
useNodeMediaInfoFooter({
  nodeId: props.id,
  url: computed(() => props.data.url),
  kind: 'image',
  mediaInfo: mediaInfoRef,
})

const showMediaSummary = computed(() => Boolean(props.data.url && props.data.mediaInfo))
```

3. 模板：从预览层移除 `MediaInfoSummary`；在 `NeoBaseNode` 上：

```vue
  <NeoBaseNode node-type="image" :selected="selected" :data="data" :status="data.status">
    <template v-if="showMediaSummary && data.mediaInfo" #footer>
      <MediaInfoSummary v-bind="data.mediaInfo" />
    </template>
    <!-- 原 default slot 内容不变，无 overlay summary -->
```

- [ ] **Step 2: Video** — 同上，`kind: 'video'`，去掉 overlay。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/CanvasNodeImage.vue \
  apps/web/src/components/canvas/CanvasNodeVideo.vue
git commit -m "feat(web): image/video media info external footer"
```

---

### Task 7: 接线 Audio + MediaInput

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodeAudio.vue`
- Modify: `apps/web/src/components/canvas/CanvasNodeMediaInput.vue`

- [ ] **Step 1: Audio**

```ts
import MediaInfoSummary from '@/components/media/MediaInfoSummary.vue'
import { useNodeMediaInfoFooter } from '@/composables/useNodeMediaInfoFooter'
import type { NodeMediaInfoSummary } from '@/composables/useMediaInspector'
import { computed } from 'vue'

// props.data 增加 mediaInfo?: NodeMediaInfoSummary

const { applyDurationSec } = useNodeMediaInfoFooter({
  nodeId: props.id,
  url: computed(() => props.data.url),
  kind: 'audio',
  mediaInfo: computed(() => props.data.mediaInfo),
})

function onAudioLoadedMetadata(e: Event) {
  const el = e.target as HTMLAudioElement
  if (Number.isFinite(el.duration)) applyDurationSec(el.duration)
}

const showMediaSummary = computed(() => Boolean(props.data.url && props.data.mediaInfo))
```

模板：

```vue
  <NeoBaseNode ...>
    <template v-if="showMediaSummary && data.mediaInfo" #footer>
      <MediaInfoSummary v-bind="data.mediaInfo" />
    </template>
    ...
    <audio
      :src="displayUrl"
      controls
      class="nodrag nowheel w-full"
      @loadedmetadata="onAudioLoadedMetadata"
    />
```

- [ ] **Step 2: MediaInput**

- 根据已有 `mediaKind` computed 得到 `'image'|'video'|'audio'`。
- 调用 `useNodeMediaInfoFooter`；`mediaInfo` 从 `data.mediaInfo` 读（props 扩展）。
- 音频分支：给 `<audio>` 加 `@loadedmetadata`。
- `#footer` + `MediaInfoSummary`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/CanvasNodeAudio.vue \
  apps/web/src/components/canvas/CanvasNodeMediaInput.vue
git commit -m "feat(web): audio and mediaInput external media footer"
```

---

### Task 8: 验证 + 规格状态

- [ ] **Step 1: 单测**

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/utils/mediaInfoFormat.test.ts \
  src/components/media/MediaInfoSummary.test.ts \
  src/composables/nodeMediaInfo.test.ts \
  src/composables/useNodeMediaInfoFooter.test.ts \
  src/composables/useMediaInspector.test.ts
```

Expected: PASS

- [ ] **Step 2: 类型/构建（按仓库工作流，提交 PR 前）**

```bash
pnpm --filter @lnkpi/web exec vue-tsc --noEmit
# 或全仓：
pnpm build
```

Expected: PASS

- [ ] **Step 3: 更新 design status**

将 `docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md` 的 Status 改为：

`Approved, plan in docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-canvas-media-info-footer-design.md \
  docs/superpowers/plans/2026-08-21-canvas-media-info-footer.md
git commit -m "docs: link media info footer plan"
```

（若本 plan 文件尚未提交，本步一并加入。）

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| NeoBaseNode `#footer` + `bottom: -32px` | 5 |
| 去掉画布 overlay | 6–7 |
| 图/视频字段 | 2, 6 |
| 音频时长·格式·大小 | 1–2, 7 |
| 视频无时长 | 2 |
| 有 URL 即显示 / 非 completed | 6–7 |
| probe 写 mediaInfo | 3–4 |
| 音频 loadedmetadata | 7 |
| mediaInput | 7 |
| 资产面板不动 | （无任务改动） |
| 服务端 duration 不改 | （无任务改动） |
| 静默失败 | 4 |
| 单测 | 1–4, 8 |

## Manual UAT（实现后）

1. 生成完成图/视频：底栏在卡片外，不盖像素。
2. 上传图/视频/音频：短暂后出现摘要。
3. mediaInput 三类：底栏出现。
4. 视频无时长；音频有 `m:ss · FORMAT · size`。
5. 非媒体节点无底栏。
