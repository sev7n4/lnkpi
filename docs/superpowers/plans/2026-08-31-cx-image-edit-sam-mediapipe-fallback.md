# 精修点选 SAM3 + MediaPipe 降级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 云端 fal SAM3 点选失败（502/503/网络）时，浏览器自动降级到 MediaPipe Interactive Segmenter；toast 一次、会话粘滞；不改积分与精修出图。

**Architecture:** 服务端将 fal 失败映射为 `502`。前端抽可测编排 `resolvePointMaskRgba`（先 remote，可降级则本地 + 粘滞）。`mediapipeSegment.ts` 懒加载 `@mediapipe/tasks-vision`，把 confidence mask 转成与 `mergeMaskRgba` 兼容的 RGBA。`RefineSidePanel.onPointSelect` 接线；关精修/换图复位。

**Tech Stack:** NestJS、Vitest、Vue 3、Element Plus `ElMessage`、`@mediapipe/tasks-vision`（Interactive Segmenter）

**Spec:** `docs/superpowers/specs/2026-08-31-cx-image-edit-sam-mediapipe-fallback-design.md`

## Global Constraints

- 主路径仍为 fal **`fal-ai/sam-3/image`**；CVM **不**跑 MediaPipe / SAM
- 仅故障自动降级；无手动「本地点选」；不预热精修面板
- 首次降级成功 toast：**「云端点选暂不可用，已用本地点选」**（会话内一次）
- 粘滞：本轮精修内后续点选只走本地；关精修 / 换工作图后复位再试 SAM3
- 可降级：HTTP **502 / 503**，或无 `response` 的网络/超时；**不可**降级：400、本平台用户限流 429
- 点选仍不扣分；不改 EditProvider / 抠图 / 文本指代
- TDD；提交前缀 `feat:` / `fix:` / `test:` / `docs:`
- 不 `git add -A`；勿提交 `.seedream-backup`、`deploy/`、`q.js`、`.superpowers/sdd/*`

## File map

| File | Responsibility |
|------|----------------|
| `apps/server/src/studio/studio.service.ts` | `segmentImage`：捕获 provider 错误 → `BadGatewayException` |
| `apps/server/src/studio/studio.segment.test.ts` | 502 / 503 / 429 / 400 用例 |
| `apps/web/src/components/canvas/refine/segmentDegrade.ts` | `isSegmentUpstreamDegradable` |
| `apps/web/src/components/canvas/refine/segmentDegrade.test.ts` | 可降级判定单测 |
| `apps/web/src/components/canvas/refine/pointSegmentSession.ts` | 会话状态 + `resolvePointMaskRgba` 编排 |
| `apps/web/src/components/canvas/refine/pointSegmentSession.test.ts` | 粘滞 / toast / 跳过 API |
| `apps/web/src/components/canvas/refine/mediapipeSegment.ts` | MediaPipe 懒加载 + 点选 → RGBA；可注入 factory 供测 |
| `apps/web/src/components/canvas/refine/mediapipeSegment.test.ts` | `confidenceMaskToRgba` + mock segmenter |
| `apps/web/src/components/canvas/refine/RefineSidePanel.vue` | `onPointSelect` 接线；换图/卸载复位 |
| `apps/web/package.json` | 依赖 `@mediapipe/tasks-vision` |
| Spec status | 实现后把 design Status 改为 Implemented |

---

### Task 0: 确认分支与基线

**Files:** 无代码改动（当前应在 `feature/cx-sam-mediapipe-fallback`，已含 design commit）

- [ ] **Step 1: 确认分支**

```bash
git branch --show-current
git log -1 --oneline
```

Expected: `feature/cx-sam-mediapipe-fallback`；HEAD 含 mediapipe fallback design（或其后继提交）

若在错误分支：

```bash
git fetch origin
git checkout feature/cx-sam-mediapipe-fallback
```

- [ ] **Step 2: 基线测试**

```bash
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.segment.test.ts
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskRemote.test.ts
```

Expected: PASS

---

### Task 1: 服务端 fal 失败 → 502

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`（`segmentImage`）
- Modify: `apps/server/src/studio/studio.segment.test.ts`

**Interfaces:**
- Consumes: 现有 `createSegmentProvider(...).segment(...)`
- Produces: 无 key → 仍 `ServiceUnavailableException`（503）；provider throw → `BadGatewayException('云端点选失败')`（502）；限流/参数不变

- [ ] **Step 1: Write the failing test**

在 `studio.segment.test.ts` 的 `StudioService.segmentImage` describe 内追加（并在文件顶部 import 增加 `BadGatewayException`）：

```ts
it('maps provider failure to BadGatewayException', async () => {
  segment.mockRejectedValueOnce(new Error('Segment API 403: TOP_UP'))

  await expect(
    svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 }),
  ).rejects.toBeInstanceOf(BadGatewayException)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.segment.test.ts
```

Expected: FAIL — provider 错误未映射为 `BadGatewayException`（现为未捕获 Error / 500）

- [ ] **Step 3: Write minimal implementation**

在 `studio.service.ts` 的 Nest import 中增加 `BadGatewayException`。将 `segmentImage` 末尾：

```ts
return createSegmentProvider({ apiKey }).segment({
  imageUrl: publicUrl,
  x: input.x,
  y: input.y,
  label: input.label ?? 1,
})
```

改为：

```ts
try {
  return await createSegmentProvider({ apiKey }).segment({
    imageUrl: publicUrl,
    x: input.x,
    y: input.y,
    label: input.label ?? 1,
  })
} catch (err) {
  if (
    err instanceof BadRequestException
    || err instanceof ServiceUnavailableException
    || err instanceof HttpException
  ) {
    throw err
  }
  throw new BadGatewayException('云端点选失败')
}
```

说明：限流/参数在 try 之前已抛出，不会进 catch。若未来 provider 抛 `HttpException`，原样透出。MVP 不强制业务码字段；前端以 status 为准。

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.segment.test.ts
```

Expected: PASS（含原有 503/429/400 + 新 502）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio/studio.service.ts apps/server/src/studio/studio.segment.test.ts
git commit -m "fix(server): map segment upstream failures to 502"
```

---

### Task 2: `isSegmentUpstreamDegradable`

**Files:**
- Create: `apps/web/src/components/canvas/refine/segmentDegrade.ts`
- Create: `apps/web/src/components/canvas/refine/segmentDegrade.test.ts`

**Interfaces:**
- Produces: `isSegmentUpstreamDegradable(err: unknown): boolean`
  - `true`：`response.status` 为 502 或 503；或 **没有** `response`（网络/超时，axios 常见形态）
  - `false`：400、429、其它 4xx（除无 response）、非对象、`undefined`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { isSegmentUpstreamDegradable } from './segmentDegrade'

describe('isSegmentUpstreamDegradable', () => {
  it('treats 502 and 503 as degradable', () => {
    expect(isSegmentUpstreamDegradable({ response: { status: 502 } })).toBe(true)
    expect(isSegmentUpstreamDegradable({ response: { status: 503 } })).toBe(true)
  })

  it('treats network errors without response as degradable', () => {
    expect(isSegmentUpstreamDegradable({ message: 'Network Error' })).toBe(true)
    expect(isSegmentUpstreamDegradable({ code: 'ECONNABORTED' })).toBe(true)
  })

  it('does not degrade 400 or platform 429', () => {
    expect(isSegmentUpstreamDegradable({ response: { status: 400 } })).toBe(false)
    expect(isSegmentUpstreamDegradable({ response: { status: 429 } })).toBe(false)
  })

  it('does not degrade unrelated 4xx', () => {
    expect(isSegmentUpstreamDegradable({ response: { status: 401 } })).toBe(false)
    expect(isSegmentUpstreamDegradable({ response: { status: 404 } })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/segmentDegrade.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
export function isSegmentUpstreamDegradable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const response = (err as { response?: { status?: number } }).response
  if (!response) return true
  const status = response.status
  return status === 502 || status === 503
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/segmentDegrade.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/segmentDegrade.ts apps/web/src/components/canvas/refine/segmentDegrade.test.ts
git commit -m "feat(web): detect degradable segment upstream errors"
```

---

### Task 3: 点选会话编排 `resolvePointMaskRgba`

**Files:**
- Create: `apps/web/src/components/canvas/refine/pointSegmentSession.ts`
- Create: `apps/web/src/components/canvas/refine/pointSegmentSession.test.ts`

**Interfaces:**
- Consumes: `isSegmentUpstreamDegradable`
- Produces:
  - `type PointSegmentSession = { preferLocal: boolean; fallbackToastShown: boolean }`
  - `createPointSegmentSession(): PointSegmentSession`
  - `resetPointSegmentSession(session: PointSegmentSession): void` — 两字段归 `false`
  - `resolvePointMaskRgba(opts): Promise<Uint8ClampedArray>`，opts：
    - `session: PointSegmentSession`
    - `remoteSegment: () => Promise<{ maskUrl: string }>`
    - `loadRemoteRgba: (maskUrl: string) => Promise<Uint8ClampedArray>`
    - `localSegment: () => Promise<Uint8ClampedArray>`
    - `onFallbackToast?: () => void`
  - 行为：
    1. 若 `session.preferLocal`：只调 `localSegment`，不调 remote
    2. 否则试 `remoteSegment` → `loadRemoteRgba`
    3. remote 抛错且 `isSegmentUpstreamDegradable`：调 `localSegment`；成功则 `preferLocal=true`；若尚未 toast 则调 `onFallbackToast` 并 `fallbackToastShown=true`
    4. remote 抛错且不可降级：原样 rethrow，不调 local
    5. local 失败：原样 rethrow（调用方 toast 失败）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  createPointSegmentSession,
  resetPointSegmentSession,
  resolvePointMaskRgba,
} from './pointSegmentSession'

const rgba = () => new Uint8ClampedArray([1, 2, 3, 255])

describe('resolvePointMaskRgba', () => {
  it('uses remote when healthy', async () => {
    const session = createPointSegmentSession()
    const remoteSegment = vi.fn(async () => ({ maskUrl: 'https://m' }))
    const loadRemoteRgba = vi.fn(async () => rgba())
    const localSegment = vi.fn(async () => rgba())
    const out = await resolvePointMaskRgba({
      session,
      remoteSegment,
      loadRemoteRgba,
      localSegment,
    })
    expect([...out]).toEqual([1, 2, 3, 255])
    expect(localSegment).not.toHaveBeenCalled()
    expect(session.preferLocal).toBe(false)
  })

  it('falls back once and sticks to local', async () => {
    const session = createPointSegmentSession()
    const toast = vi.fn()
    const remoteSegment = vi.fn(async () => {
      throw { response: { status: 502 } }
    })
    const loadRemoteRgba = vi.fn()
    const localSegment = vi.fn(async () => rgba())

    await resolvePointMaskRgba({
      session,
      remoteSegment,
      loadRemoteRgba,
      localSegment,
      onFallbackToast: toast,
    })
    expect(toast).toHaveBeenCalledTimes(1)
    expect(session.preferLocal).toBe(true)

    remoteSegment.mockClear()
    localSegment.mockClear()
    toast.mockClear()

    await resolvePointMaskRgba({
      session,
      remoteSegment,
      loadRemoteRgba,
      localSegment,
      onFallbackToast: toast,
    })
    expect(remoteSegment).not.toHaveBeenCalled()
    expect(localSegment).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('does not fallback on 429', async () => {
    const session = createPointSegmentSession()
    const localSegment = vi.fn(async () => rgba())
    await expect(
      resolvePointMaskRgba({
        session,
        remoteSegment: async () => {
          throw { response: { status: 429, data: { message: '点选过于频繁，请稍后再试' } } }
        },
        loadRemoteRgba: async () => rgba(),
        localSegment,
      }),
    ).rejects.toMatchObject({ response: { status: 429 } })
    expect(localSegment).not.toHaveBeenCalled()
  })

  it('reset clears stickiness', () => {
    const session = createPointSegmentSession()
    session.preferLocal = true
    session.fallbackToastShown = true
    resetPointSegmentSession(session)
    expect(session).toEqual({ preferLocal: false, fallbackToastShown: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/pointSegmentSession.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
import { isSegmentUpstreamDegradable } from './segmentDegrade'

export type PointSegmentSession = {
  preferLocal: boolean
  fallbackToastShown: boolean
}

export function createPointSegmentSession(): PointSegmentSession {
  return { preferLocal: false, fallbackToastShown: false }
}

export function resetPointSegmentSession(session: PointSegmentSession): void {
  session.preferLocal = false
  session.fallbackToastShown = false
}

export async function resolvePointMaskRgba(opts: {
  session: PointSegmentSession
  remoteSegment: () => Promise<{ maskUrl: string }>
  loadRemoteRgba: (maskUrl: string) => Promise<Uint8ClampedArray>
  localSegment: () => Promise<Uint8ClampedArray>
  onFallbackToast?: () => void
}): Promise<Uint8ClampedArray> {
  const { session } = opts
  if (session.preferLocal) {
    return opts.localSegment()
  }
  try {
    const { maskUrl } = await opts.remoteSegment()
    return await opts.loadRemoteRgba(maskUrl)
  } catch (err) {
    if (!isSegmentUpstreamDegradable(err)) throw err
    const rgba = await opts.localSegment()
    session.preferLocal = true
    if (!session.fallbackToastShown) {
      session.fallbackToastShown = true
      opts.onFallbackToast?.()
    }
    return rgba
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/pointSegmentSession.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/pointSegmentSession.ts apps/web/src/components/canvas/refine/pointSegmentSession.test.ts
git commit -m "feat(web): orchestrate SAM3 to MediaPipe point-segment fallback"
```

---

### Task 4: MediaPipe 封装（可注入 + confidence→RGBA）

**Files:**
- Create: `apps/web/src/components/canvas/refine/mediapipeSegment.ts`
- Create: `apps/web/src/components/canvas/refine/mediapipeSegment.test.ts`
- Modify: `apps/web/package.json`（及锁文件：在 `apps/web` 目录执行 `pnpm add @mediapipe/tasks-vision`，从 monorepo 根目录）

**Interfaces:**
- Produces:
  - `confidenceMaskToRgba(confidence: Float32Array | number[], width: number, height: number, threshold = 0.5): Uint8ClampedArray`  
    — 长度须为 `width*height`；`value >= threshold` → RGB=255 A=255，否则 A=0（RGB=0）。供 `mergeMaskRgba` 使用（alpha>127 即选中）。
  - `type MediaPipeSegmenterLike = { setImage(image: CanvasImageSource): void; segment(strokes: unknown): { confidenceMasks?: Array<{ getAsFloat32Array?: () => Float32Array }> } | void }`
  - `type MediaPipeDeps = { loadSegmenter: () => Promise<MediaPipeSegmenterLike> }`
  - `resetMediaPipeSegmentSession(): void` — 清缓存的 segmenter/imageKey
  - `segmentPointLocal(opts: { image: CanvasImageSource; imageKey: string; x: number; y: number; width: number; height: number; deps?: MediaPipeDeps }): Promise<Uint8ClampedArray>`
    - 像素点转归一化：`nx = (x + 0.5) / width`，`ny = (y + 0.5) / height`，夹到 `[0,1]`
    - `imageKey` 变化时重新 `setImage`
    - **默认** `deps.loadSegmenter`：动态 `import('@mediapipe/tasks-vision')`，`FilesetResolver.forVisionTasks` + `InteractiveSegmenter.createFromOptions`，模型：
      `https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float16/latest/magic_touch.tflite`  
      若该 URL 404，改用官方文档当前推荐：  
      `https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task`  
      与 wasm：`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@<installed-version>/wasm`
    - stroke 形态按已安装包的类型（优先 stateful：`setImage` + `segment` 带 `keypoint`/`point` 归一化坐标）。若 API 与文档不一致，以 `@mediapipe/tasks-vision` 类型定义为准，但 **对外仍返回同尺寸 RGBA**。
    - 无 confidence mask 或长度不对 → `throw new Error('本地点选失败')`

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter @lnkpi/web add @mediapipe/tasks-vision
```

- [ ] **Step 2: Write the failing test（纯函数 + mock deps，不拉真实 WASM）**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  confidenceMaskToRgba,
  resetMediaPipeSegmentSession,
  segmentPointLocal,
} from './mediapipeSegment'

describe('confidenceMaskToRgba', () => {
  it('thresholds confidence into alpha mask', () => {
    const out = confidenceMaskToRgba([0.1, 0.9], 2, 1, 0.5)
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([255, 255, 255, 255])
  })
})

describe('segmentPointLocal', () => {
  it('uses injected segmenter and caches setImage per imageKey', async () => {
    resetMediaPipeSegmentSession()
    const setImage = vi.fn()
    const getAsFloat32Array = vi.fn(() => new Float32Array([0, 1, 0, 1]))
    const segment = vi.fn(() => ({ confidenceMasks: [{ getAsFloat32Array }] }))
    const loadSegmenter = vi.fn(async () => ({ setImage, segment }))

    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2

    const a = await segmentPointLocal({
      image: canvas,
      imageKey: 'img-a',
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      deps: { loadSegmenter },
    })
    expect(loadSegmenter).toHaveBeenCalledTimes(1)
    expect(setImage).toHaveBeenCalledTimes(1)
    expect(a.length).toBe(16)

    await segmentPointLocal({
      image: canvas,
      imageKey: 'img-a',
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      deps: { loadSegmenter },
    })
    expect(loadSegmenter).toHaveBeenCalledTimes(1)
    expect(setImage).toHaveBeenCalledTimes(1)

    await segmentPointLocal({
      image: canvas,
      imageKey: 'img-b',
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      deps: { loadSegmenter },
    })
    expect(setImage).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/mediapipeSegment.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 4: Write minimal implementation**

实现 `confidenceMaskToRgba`、模块级缓存（`segmenterPromise`、`cachedImageKey`）、`resetMediaPipeSegmentSession`、`segmentPointLocal`。  
`segment` 调用参数：先按官方 web 示例传 strokes 数组；若编译类型报错，改为包内 `RegionOfInterest`/`keypoint` 形态，但测试里用 `vi.fn` 不校验具体 stroke 结构（可用 `expect(segment).toHaveBeenCalled()`）。

默认 `loadSegmenter` 示例骨架：

```ts
async function defaultLoadSegmenter(): Promise<MediaPipeSegmenterLike> {
  const vision = await import('@mediapipe/tasks-vision')
  const fileset = await vision.FilesetResolver.forVisionTasks(
    new URL('@mediapipe/tasks-vision/wasm', import.meta.url).href,
  ).catch(async () =>
    vision.FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm`,
    ),
  )
  return vision.InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task',
    },
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  }) as unknown as MediaPipeSegmenterLike
}
```

（若 `createFromOptions` 选项名与类型不符，删掉不存在的 output* 字段，仅保留 `baseOptions`。）

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/mediapipeSegment.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml \
  apps/web/src/components/canvas/refine/mediapipeSegment.ts \
  apps/web/src/components/canvas/refine/mediapipeSegment.test.ts
git commit -m "feat(web): add MediaPipe local point segment helper"
```

---

### Task 5: 接线 `RefineSidePanel`

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`

**Interfaces:**
- Consumes: `resolvePointMaskRgba`、`createPointSegmentSession`、`resetPointSegmentSession`、`segmentPointLocal`、`resetMediaPipeSegmentSession`、现有 `studioApi.segmentImage` / `loadMaskRgbaFromUrl` / `mergeMaskRgba`
- Produces: 用户可见行为符合 spec（无新 UI 控件）

- [ ] **Step 1: 在 script 增加 session 与辅助加载图**

```ts
import {
  createPointSegmentSession,
  resetPointSegmentSession,
  resolvePointMaskRgba,
} from './pointSegmentSession'
import { resetMediaPipeSegmentSession, segmentPointLocal } from './mediapipeSegment'

const pointSession = createPointSegmentSession()

function resetPointFallbackState() {
  resetPointSegmentSession(pointSession)
  resetMediaPipeSegmentSession()
}

async function loadWorkImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return img
}
```

- [ ] **Step 2: 替换 `onPointSelect` 主体**

保持 `busy` / `segmentBusy` / canvas 校验不变；将 try 内 remote-only 换成：

```ts
const remoteRgba = await resolvePointMaskRgba({
  session: pointSession,
  remoteSegment: async () => {
    const { data } = await studioApi.segmentImage({
      imageUrl: props.beforeUrl,
      x,
      y,
      label: 1,
    })
    return { maskUrl: data.data.maskUrl }
  },
  loadRemoteRgba: (maskUrl) => loadMaskRgbaFromUrl(maskUrl, canvas.width, canvas.height),
  localSegment: async () => {
    const img = await loadWorkImage(props.beforeUrl)
    return segmentPointLocal({
      image: img,
      imageKey: props.beforeUrl,
      x,
      y,
      width: canvas.width,
      height: canvas.height,
    })
  },
  onFallbackToast: () => {
    ElMessage.warning('云端点选暂不可用，已用本地点选')
  },
})
// 然后与现网相同：mergeMaskRgba + putImageData + refineCoverage
```

- [ ] **Step 3: 复位钩子**

```ts
watch(
  () => props.beforeUrl,
  () => {
    resetPointFallbackState()
  },
)

onBeforeUnmount(() => {
  registerRefinePointSelectHandler(null)
  resetPointFallbackState()
  // ...现有 removeEventListener / stopResize / stopDrag
})
```

（`onMounted` 注册 handler 保持不变。）

- [ ] **Step 4: 手动类型检查**

```bash
pnpm --filter @lnkpi/web exec vue-tsc --noEmit
```

Expected: 无因本改动引入的错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/RefineSidePanel.vue
git commit -m "feat(web): wire MediaPipe fallback into refine point-select"
```

---

### Task 6: 验证与文档状态

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-cx-image-edit-sam-mediapipe-fallback-design.md`（Status → Implemented）

- [ ] **Step 1: 跑相关测试**

```bash
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.segment.test.ts
pnpm --filter @lnkpi/web exec vitest run \
  src/components/canvas/refine/segmentDegrade.test.ts \
  src/components/canvas/refine/pointSegmentSession.test.ts \
  src/components/canvas/refine/mediapipeSegment.test.ts \
  src/components/canvas/refine/maskRemote.test.ts
pnpm --filter @lnkpi/web exec vue-tsc --noEmit
```

Expected: 全部 PASS

- [ ] **Step 2: 更新 spec Status**

将 design 文件头部改为：

`**Status:** Implemented on \`feature/cx-sam-mediapipe-fallback\``

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-31-cx-image-edit-sam-mediapipe-fallback-design.md
git commit -m "docs: mark MediaPipe segment fallback design implemented"
```

- [ ] **Step 4: 手工验收清单（PR 描述用）**

- [ ] fal 正常：点选仍走云端，无 toast  
- [ ] 模拟 502 / 无 `FAL_KEY`：toast 一次 + 出 mask；同会话再点不打 `/segment`  
- [ ] 关精修再开：再试云端  
- [ ] 本平台连点触发 429：不降级，错误提示  
- [ ] 积分不变直至「精修」

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| 502 映射 fal 失败 | T1 |
| 503 无 key 保持 | T1（既有 + 不改） |
| 可降级判定 502/503/网络 | T2 |
| 不降级 400/429 | T2 + T3 |
| 编排 + 粘滞 + toast 一次 | T3 |
| MediaPipe 懒加载封装 | T4 |
| SidePanel 接线 / 换图复位 | T5 |
| 成功标准 / 文档 | T6 |
| 无手动开关 / 不预热 / CVM 不跑 | Global + T4/T5 未做相反事 |

**Placeholder scan:** 无 TBD；MediaPipe 模型 URL 给了主选与文档备选。  
**Type consistency:** `PointSegmentSession` / `resolvePointMaskRgba` / `segmentPointLocal` 命名在 T3–T5 一致。
