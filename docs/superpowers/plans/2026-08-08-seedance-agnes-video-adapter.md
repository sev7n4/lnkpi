# Seedance / agnes-video 视频多模态对接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-08-08-seedance-agnes-video-adapter-design.md`

**Goal:** 打通 Agnes keyframes 与 Seedance APIMart 多模态视频（I*/V*/A* native wire + @ 占位符），消除 Seedance BYOK placeholder，Studio/Material 双路径共用 adapter。

**Architecture:** 在 `@lnkpi/shared` 新增 `VideoModelProfile`（镜像 `imageModelProfiles.ts`）；`generation-adapter` 扩展 `buildVideoReferenceBundle` / `buildVideoProviderOptions` / `buildEffectiveVideoPrompt`；`video-provider` 新增 `ApimartVideoProvider` 并增强 `AgnesVideoProvider`；`studio.service` / `material.service` 统一引用 bundle 与 provider options。

**Tech Stack:** TypeScript, Vitest, NestJS (`studio.service`, `material.service`), `@lnkpi/agent`, `@lnkpi/shared`, fetch APIMart `/v1/videos/generations` + `/tasks/{id}`

## Global Constraints

- `seedance-2.0-min` → gateway `doubao-seedance-2.0-mini`（catalog 必须修正）
- Seedance 引用：`image_urls` / `video_urls` / `audio_urls` + prompt `@ImageN` / `@VideoN` / `@AudioN`（1-based）
- Agnes 多图：`extra_body.image[]` + `extra_body.mode: "keyframes"`；单图仍用 `image`
- 禁止 `blob:` refs 出站；生成前 inline 为公网 HTTPS
- 仅 A* 无 I*/V* → 服务端 `BadRequestException('参考音频须配合参考图或视频')`
- 非 Agnes 且非 Apimart 的 BYOK → **不得** `PlaceholderVideoProvider`；抛可读错误
- metadata 必须记录 `refWire`, `responseMode`, `scenario`, `refImageMode`, `refVideoMode`, `refAudioMode`, `droppedFields`
- 禁止第三种「既不传也不记」
- 实施顺序：**P0 → P3 → P2 → P5 → P4 → P1 → P7**（P6 UI 可选后续 PR）
- 每 Task 完成后单独 commit；不 amend 已 push commit

---

## File Map

| File | Responsibility |
|---|---|
| `packages/shared/src/videoModelProfiles.ts` | Profile 解析、gateway 映射、clamp |
| `packages/shared/src/videoModelProfiles.test.ts` | Profile 单测 |
| `packages/shared/src/studioModelCatalog.ts` | seedance gatewayId + params |
| `packages/shared/src/index.ts` | 导出新类型 |
| `packages/agent/src/studio/video-refs.ts` | `VideoReferenceBundle`, `buildVideoReferenceBundle`, `inferVideoScenario` |
| `packages/agent/src/studio/video-refs.test.ts` | bundle / scenario 单测 |
| `packages/agent/src/studio/generation-adapter.ts` | video adapter + prompt 构建 |
| `packages/agent/src/studio/generation-adapter.test.ts` | adapter 单测 |
| `packages/agent/src/tools/video-provider.ts` | Apimart + Agnes 增强 + 路由 |
| `packages/agent/src/tools/video-provider.test.ts` | provider 单测 |
| `packages/agent/src/refs/merge-refs.ts` | video 下游传 `imageRefs` |
| `packages/agent/src/index.ts` | 导出新函数 |
| `apps/server/src/studio/studio.service.ts` | Studio 视频生成链 |
| `apps/server/src/canvas/material.service.ts` | Material 视频生成链 |

---

### Task 1: VideoModelProfile（shared）

**Files:**
- Create: `packages/shared/src/videoModelProfiles.ts`
- Create: `packages/shared/src/videoModelProfiles.test.ts`
- Modify: `packages/shared/src/studioModelCatalog.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `VideoRefWire`, `VideoModelProfile`, `resolveVideoModelProfile(modelKey, gatewayModelId, opts?)`, `resolveVideoGatewayModelId(modelKey, gatewayModelId)`, `clampVideoGenerationInput(profile, input)`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/shared/src/videoModelProfiles.test.ts
import { describe, expect, it } from 'vitest'
import { clampVideoGenerationInput, resolveVideoGatewayModelId, resolveVideoModelProfile } from './videoModelProfiles'

describe('resolveVideoModelProfile', () => {
  it('maps seedance-2.0-min to doubao-seedance-2.0-mini async multimodal', () => {
    const p = resolveVideoModelProfile('seedance-2.0-min', 'seedance-2.0-min')
    expect(p.gatewayModelId).toBe('doubao-seedance-2.0-mini')
    expect(p.responseMode).toBe('async_task')
    expect(p.maxImageRefs).toBe(9)
    expect(p.maxVideoRefs).toBe(3)
    expect(p.maxAudioRefs).toBe(3)
  })

  it('maps agnes-video to agnes_poll pixel_frames', () => {
    const p = resolveVideoModelProfile('agnes-video-v2.0', 'agnes-video-v2.0')
    expect(p.responseMode).toBe('agnes_poll')
    expect(p.sizeWire).toBe('pixel_frames')
    expect(p.maxImageRefs).toBe(8)
  })
})

describe('clampVideoGenerationInput', () => {
  it('downgrades seedance mini 1080p to 720p', () => {
    const profile = resolveVideoModelProfile('seedance-2.0-min', 'doubao-seedance-2.0-mini')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('720p')
    expect(r.droppedFields.some((d) => d.field === 'resolution')).toBe(true)
  })
})

describe('resolveVideoGatewayModelId', () => {
  it('rewrites seedance catalog id', () => {
    expect(resolveVideoGatewayModelId('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })
})
```

- [ ] **Step 2: Run test to verify fails**

Run: `pnpm --filter @lnkpi/shared test -- videoModelProfiles.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement profile module**

```typescript
// packages/shared/src/videoModelProfiles.ts — core exports
export type VideoRefWire =
  | 'none'
  | 'agnes_single_image'
  | 'agnes_keyframes'
  | 'apimart_multimodal'
  | 'apimart_first_last'
  | 'legacy_prompt_tags'

export type VideoSizeWire = 'pixel_frames' | 'ratio_duration'
export type VideoResponseMode = 'agnes_poll' | 'async_task'

export interface VideoModelProfile {
  refWire: VideoRefWire
  sizeWire: VideoSizeWire
  responseMode: VideoResponseMode
  gatewayModelId: string
  maxImageRefs: number
  maxVideoRefs: number
  maxAudioRefs: number
  minDuration: number
  maxDuration: number
  allowedAspectRatios: string[]
  allowedResolutions: string[]
  defaultGenerateAudio: boolean
  pollIntervalMs: number
  maxPollMs: number
}

const SEEDANCE_GATEWAY = 'doubao-seedance-2.0-mini'

function isSeedanceModel(modelKey: string, gatewayModelId: string): boolean {
  return (
    /^seedance-2\.0-min$/i.test(modelKey) ||
    /^doubao-seedance-/i.test(gatewayModelId)
  )
}

function isAgnesVideoModel(modelKey: string, gatewayModelId: string): boolean {
  return /^agnes-video-/i.test(modelKey) || /^agnes-video-/i.test(gatewayModelId)
}

export function resolveVideoGatewayModelId(modelKey: string, gatewayModelId: string): string {
  if (isSeedanceModel(modelKey, gatewayModelId)) return SEEDANCE_GATEWAY
  return gatewayModelId
}

export function resolveVideoModelProfile(
  modelKey: string,
  gatewayModelId: string,
  opts?: { channelBaseUrl?: string },
): VideoModelProfile {
  const gw = resolveVideoGatewayModelId(modelKey, gatewayModelId)
  if (isAgnesVideoModel(modelKey, gw)) {
    return {
      refWire: 'agnes_single_image',
      sizeWire: 'pixel_frames',
      responseMode: 'agnes_poll',
      gatewayModelId: gw,
      maxImageRefs: 8,
      maxVideoRefs: 0,
      maxAudioRefs: 0,
      minDuration: 5,
      maxDuration: 15,
      allowedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      allowedResolutions: ['480p', '720p', '1080p'],
      defaultGenerateAudio: false,
      pollIntervalMs: 5_000,
      maxPollMs: 600_000,
    }
  }
  if (isSeedanceModel(modelKey, gw) || opts?.channelBaseUrl?.includes('apimart.ai')) {
    return {
      refWire: 'apimart_multimodal',
      sizeWire: 'ratio_duration',
      responseMode: 'async_task',
      gatewayModelId: gw,
      maxImageRefs: 9,
      maxVideoRefs: 3,
      maxAudioRefs: 3,
      minDuration: 4,
      maxDuration: 15,
      allowedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
      allowedResolutions: ['480p', '720p', '1080p'],
      defaultGenerateAudio: true,
      pollIntervalMs: 8_000,
      maxPollMs: 600_000,
    }
  }
  return {
    refWire: 'legacy_prompt_tags',
    sizeWire: 'ratio_duration',
    responseMode: 'async_task',
    gatewayModelId: gw,
    maxImageRefs: 1,
    maxVideoRefs: 0,
    maxAudioRefs: 0,
    minDuration: 5,
    maxDuration: 15,
    allowedAspectRatios: ['16:9', '9:16', '1:1'],
    allowedResolutions: ['480p', '720p', '1080p'],
    defaultGenerateAudio: false,
    pollIntervalMs: 8_000,
    maxPollMs: 600_000,
  }
}

export function clampVideoGenerationInput(
  profile: VideoModelProfile,
  input: {
    duration?: number
    aspectRatio?: string
    resolution?: string
    referenceImages: string[]
    referenceVideos: string[]
    referenceAudios: string[]
  },
) {
  const droppedFields: Array<{ field: string; reason: string }> = []
  let duration = input.duration ?? 5
  let resolution = input.resolution ?? '720p'
  let aspectRatio = input.aspectRatio ?? '16:9'

  duration = Math.min(profile.maxDuration, Math.max(profile.minDuration, Math.round(duration)))
  if (!profile.allowedAspectRatios.includes(aspectRatio)) {
    droppedFields.push({ field: 'aspectRatio', reason: `fallback to 16:9` })
    aspectRatio = '16:9'
  }
  if (profile.gatewayModelId === SEEDANCE_GATEWAY && resolution === '1080p') {
    droppedFields.push({ field: 'resolution', reason: '1080p not on mini; use 720p' })
    resolution = '720p'
  }

  const referenceImages = input.referenceImages.slice(0, profile.maxImageRefs)
  const referenceVideos = input.referenceVideos.slice(0, profile.maxVideoRefs)
  const referenceAudios = input.referenceAudios.slice(0, profile.maxAudioRefs)

  if (input.referenceImages.length > profile.maxImageRefs) {
    droppedFields.push({ field: 'referenceImages', reason: `truncated to ${profile.maxImageRefs}` })
  }

  return { duration, aspectRatio, resolution, referenceImages, referenceVideos, referenceAudios, droppedFields }
}
```

- [ ] **Step 4: Update catalog**

```typescript
// packages/shared/src/studioModelCatalog.ts — seedance entry
{
  modelKey: 'seedance-2.0-min',
  displayName: 'Seedance 2.0 Min',
  gatewayModelId: 'doubao-seedance-2.0-mini',
  modality: 'video',
  providerBinding: 'gateway-openai-compat',
  params: {
    ...VIDEO_PARAMS,
    generateAudio: 'native',
    seed: 'native',
    refImages: 'native',
    refVideos: 'native',
    refAudios: 'native',
  },
}
```

Export new symbols from `packages/shared/src/index.ts`.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @lnkpi/shared test -- videoModelProfiles.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/videoModelProfiles.ts packages/shared/src/videoModelProfiles.test.ts packages/shared/src/studioModelCatalog.ts packages/shared/src/index.ts
git commit -m "feat(shared): add VideoModelProfile for agnes/seedance video"
```

---

### Task 2: ApimartVideoProvider + 路由（P3 — 解除 placeholder）

**Files:**
- Modify: `packages/agent/src/tools/video-provider.ts`
- Modify: `packages/agent/src/tools/video-provider.test.ts`

**Interfaces:**
- Consumes: `resolveVideoParams` (Agnes only), `VideoRefWire` from shared
- Produces: `ApimartVideoProvider`, extended `VideoProvider.generate` options, `createVideoProvider` apimart branch

- [ ] **Step 1: Write failing test — Apimart route**

```typescript
// packages/agent/src/tools/video-provider.test.ts
import { ApimartVideoProvider, createVideoProvider } from './video-provider'

describe('createVideoProvider apimart', () => {
  it('returns ApimartVideoProvider for apimart baseUrl', () => {
    const p = createVideoProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.apimart.ai/v1',
      model: 'doubao-seedance-2.0-mini',
    })
    expect(p).toBeInstanceOf(ApimartVideoProvider)
  })

  it('throws readable error for unknown BYOK instead of placeholder', async () => {
    const p = createVideoProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://unknown.example.com/v1',
    })
    await expect(p.generate('test')).rejects.toThrow(/unsupported video gateway/i)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/agent test -- video-provider.test.ts`
Expected: FAIL — ApimartVideoProvider not exported / still placeholder

- [ ] **Step 3: Implement ApimartVideoProvider**

关键实现（镜像 `image-provider.ts` poll 逻辑）：

```typescript
function isApimartBaseUrl(baseUrl?: string): boolean {
  return Boolean(baseUrl?.includes('apimart.ai'))
}

function extractApimartTaskId(json: unknown): string | undefined {
  const data = (json as { data?: unknown[] }).data
  const first = Array.isArray(data) ? data[0] : undefined
  return (first as { task_id?: string })?.task_id
}

function extractApimartVideoUrl(data: unknown): string | undefined {
  const result = (data as { result?: { video_url?: string; url?: string; videos?: Array<{ url?: string }> } }).result
  return (
    result?.video_url ??
    result?.url ??
    result?.videos?.[0]?.url ??
    (data as { url?: string }).url
  )
}

export class ApimartVideoProvider implements VideoProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.apimart.ai/v1',
    private pollIntervalMs = 8_000,
    private maxPollMs = 600_000,
  ) {}

  async generate(prompt: string, options?: VideoGenerateOptions): Promise<{ url: string; lastFrameUrl?: string }> {
    const root = this.baseUrl.replace(/\/$/, '')
    const body: Record<string, unknown> = {
      model: options?.model ?? 'doubao-seedance-2.0-mini',
      prompt,
      duration: options?.duration ?? 5,
      size: options?.aspectRatio ?? '16:9',
      resolution: options?.resolution ?? '720p',
      generate_audio: options?.generateAudio ?? true,
    }
    if (options?.seed != null) body.seed = options.seed
    if (options?.returnLastFrame) body.return_last_frame = true
    if (options?.imageWithRoles?.length) {
      body.image_with_roles = options.imageWithRoles
    } else if (options?.referenceImages?.length) {
      body.image_urls = options.referenceImages
    }
    if (options?.referenceVideos?.length) body.video_urls = options.referenceVideos
    if (options?.referenceAudios?.length) body.audio_urls = options.referenceAudios

    const createRes = await fetch(`${root}/videos/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    })
    if (!createRes.ok) throw new Error(`Apimart video create ${createRes.status}: ${await createRes.text()}`)

    const created = await createRes.json()
    const taskId = extractApimartTaskId(created)
    if (!taskId) throw new Error(`Apimart video missing task_id: ${JSON.stringify(created)}`)

    const deadline = Date.now() + (options?.maxPollMs ?? this.maxPollMs)
    while (Date.now() < deadline) {
      await sleep(options?.pollIntervalMs ?? this.pollIntervalMs)
      const pollRes = await fetch(`${root}/tasks/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (!pollRes.ok) continue
      const json = await pollRes.json()
      const data = (json as { data?: unknown }).data ?? json
      const status = (data as { status?: string }).status
      if (status === 'completed') {
        const url = extractApimartVideoUrl(data)
        if (!url) throw new Error(`Apimart video completed without url: ${JSON.stringify(data)}`)
        const lastFrameUrl = (data as { result?: { last_frame_url?: string } }).result?.last_frame_url
        return { url, lastFrameUrl }
      }
      if (status === 'failed') {
        throw new Error(`Apimart video failed: ${JSON.stringify((data as { error?: unknown }).error ?? data)}`)
      }
    }
    throw new Error(`Apimart video poll timeout (${options?.maxPollMs ?? this.maxPollMs}ms)`)
  }
}
```

更新 `createVideoProvider`：

```typescript
if (opts?.apiKey) {
  if (isAgnesBaseUrl(opts.baseUrl)) return new AgnesVideoProvider(...)
  if (isApimartBaseUrl(opts.baseUrl)) return new ApimartVideoProvider(opts.apiKey, opts.baseUrl)
  throw new Error(`unsupported video gateway: ${opts.baseUrl}`)
}
// platform env: same branching; remove OpenAIVideoProvider fallback when key present
```

- [ ] **Step 4: Mock async poll test**

```typescript
it('polls apimart task and returns video url', async () => {
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ task_id: 'task_1' }] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { status: 'completed', result: { video_url: 'https://cdn/v.mp4' } } }),
    })
  const provider = new ApimartVideoProvider('key', 'https://api.apimart.ai/v1', 0, 30_000)
  const { url } = await provider.generate('hello', { model: 'doubao-seedance-2.0-mini', duration: 5 })
  expect(url).toBe('https://cdn/v.mp4')
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).image_urls).toBeUndefined()
})
```

- [ ] **Step 5: Run tests — PASS**

Run: `pnpm --filter @lnkpi/agent test -- video-provider.test.ts`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(agent): add ApimartVideoProvider and fix BYOK video routing"
```

---

### Task 3: Video reference bundle + scenario（P1）

**Files:**
- Create: `packages/agent/src/studio/video-refs.ts`
- Create: `packages/agent/src/studio/video-refs.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces: `VideoReferenceItem`, `VideoReferenceBundle`, `VideoScenario`, `buildVideoReferenceBundle(refs, referenceImageUrl?)`, `inferVideoScenario(bundle, videoMode?)`

- [ ] **Step 1: Write failing tests**

```typescript
import { buildVideoReferenceBundle, inferVideoScenario } from './video-refs'

it('merges referenceImageUrl as I1 when refs empty', () => {
  const b = buildVideoReferenceBundle([], 'https://cdn/a.png')
  expect(b.images).toEqual([{ refKey: 'I1', url: 'https://cdn/a.png', label: '参考图' }])
  expect(inferVideoScenario(b, 'image_to_video')).toBe('S2')
})

it('detects S6 when video refs present', () => {
  const b = buildVideoReferenceBundle([
    { refKey: 'I1', mediaType: 'image', url: 'https://cdn/i.png' },
    { refKey: 'V1', mediaType: 'video', url: 'https://cdn/v.mp4' },
  ])
  expect(inferVideoScenario(b)).toBe('S6')
})

it('detects S5 first_last with two images and mode', () => {
  const b = buildVideoReferenceBundle([
    { refKey: 'I1', mediaType: 'image', url: 'https://cdn/1.png' },
    { refKey: 'I2', mediaType: 'image', url: 'https://cdn/2.png' },
  ])
  expect(inferVideoScenario(b, 'first_last_frame')).toBe('S5')
})
```

- [ ] **Step 2–5: Implement, test PASS, commit**

`inferVideoScenario` 规则（规格 §4.2）：

```typescript
export type VideoScenario = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8'

export function inferVideoScenario(
  bundle: VideoReferenceBundle,
  videoMode?: 'text_to_video' | 'image_to_video' | 'first_last_frame',
): VideoScenario {
  const { images, videos, audios } = bundle
  if (audios.length && !images.length && !videos.length) return 'S7' // will block upstream
  if (videos.length) return 'S6'
  if (audios.length && (images.length || videos.length)) return 'S7'
  if (videoMode === 'first_last_frame' && images.length === 2) return 'S5'
  if (images.length >= 2) return 'S4'
  if (images.length === 1 || videoMode === 'image_to_video') return 'S2'
  return 'S1'
}
```

Commit: `feat(agent): add video reference bundle and scenario inference`

---

### Task 4: generation-adapter 扩展（P2）

**Files:**
- Modify: `packages/agent/src/studio/generation-adapter.ts`
- Modify: `packages/agent/src/studio/generation-adapter.test.ts`

**Interfaces:**
- Consumes: `resolveVideoModelProfile`, `clampVideoGenerationInput`, `buildVideoReferenceBundle`, `inferVideoScenario`
- Produces: `ensureSeedanceRefTags`, `buildVideoRefConsistencyBlock`, `buildEffectiveVideoPrompt`, extended `buildVideoProviderOptions`, `buildVideoProviderGenerateOptions`

- [ ] **Step 1: Update failing tests — seedance native multimodal**

```typescript
it('uses native image_urls for seedance multi-ref', () => {
  const bundle = buildVideoReferenceBundle([
    { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
    { refKey: 'I2', mediaType: 'image', url: 'https://cdn/b.png' },
  ])
  const r = buildVideoProviderOptions({
    modelKey: 'seedance-2.0-min',
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    referenceBundle: bundle,
  })
  expect(r.meta.refImageMode).toBe('native')
  expect(r.meta.refWire).toBe('apimart_multimodal')
  expect(r.providerOptions.referenceImages).toEqual([
    'https://cdn/a.png',
    'https://cdn/b.png',
  ])
  expect(r.effectivePromptSuffix).toBeUndefined()
})

it('uses agnes keyframes for 2+ images on agnes', () => {
  const bundle = buildVideoReferenceBundle([
    { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
    { refKey: 'I2', mediaType: 'image', url: 'https://cdn/b.png' },
  ])
  const r = buildVideoProviderOptions({
    modelKey: 'agnes-video-v2.0',
    referenceBundle: bundle,
  })
  expect(r.meta.refWire).toBe('agnes_keyframes')
  expect(r.providerOptions.referenceImages).toHaveLength(2)
  expect(r.image).toBeUndefined()
})
```

- [ ] **Step 2–5: Implement adapter**

`ensureSeedanceRefTags` 核心：

```typescript
export function ensureSeedanceRefTags(prompt: string, bundle: VideoReferenceBundle): string {
  let out = prompt
  bundle.images.forEach((_, i) => {
    const tag = `@Image${i + 1}`
    if (!out.includes(tag) && !out.includes(`@图片${i + 1}`)) out += ` ${tag}`
  })
  bundle.videos.forEach((_, i) => {
    const tag = `@Video${i + 1}`
    if (!out.includes(tag)) out += ` ${tag}`
  })
  bundle.audios.forEach((_, i) => {
    const tag = `@Audio${i + 1}`
    if (!out.includes(tag)) out += ` ${tag}`
  })
  return out.trim()
}
```

`buildVideoProviderOptions` 变更要点：

- 入参改为 `referenceBundle: VideoReferenceBundle`（保留 `referenceImages: string[]`  overload deprecated 一层转 bundle 以免一次改完 server）
- 按 profile + image 数量选 `refWire`：`agnes_keyframes` / `apimart_multimodal` / `apimart_first_last`
- Seedance：`nativeParams.size = aspectRatio`（非 aspectRatio 字段名出站）
- 输出 `providerOptions` 供 server 直传

Commit: `feat(agent): native video refs for seedance and agnes keyframes`

---

### Task 5: AgnesVideoProvider 增强（P4）

**Files:**
- Modify: `packages/agent/src/tools/video-provider.ts`
- Modify: `packages/agent/src/tools/video-provider.test.ts`

- [ ] **Step 1: Test keyframes body**

```typescript
it('sends extra_body keyframes when referenceImages length >= 2', async () => {
  // mock fetch...
  await provider.generate('transition', {
    referenceImages: ['https://cdn/a.png', 'https://cdn/b.png'],
    refWire: 'agnes_keyframes',
  })
  const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
  expect(body.extra_body).toEqual({
    image: ['https://cdn/a.png', 'https://cdn/b.png'],
    mode: 'keyframes',
  })
  expect(body).not.toHaveProperty('image')
})
```

- [ ] **Step 2: Implement + poll metadata.url fallback**

```typescript
const result = (await pollRes.json()) as AgnesVideoPollResponse & { metadata?: { url?: string } }
const url = result.url ?? result.metadata?.url
if (result.status === 'completed' && url) return { url }
```

- [ ] **Step 3: Run tests, commit**

`feat(agent): agnes video keyframes and metadata.url poll`

---

### Task 6: Server 集成 Studio + Material（P5）

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/canvas/material.service.ts`

**Interfaces:**
- Consumes: `buildVideoReferenceBundle`, `buildVideoProviderOptions`, `buildEffectiveVideoPrompt`, `buildVideoProviderGenerateOptions` from `@lnkpi/agent`

- [ ] **Step 1: Replace extractReferenceImages-only path**

在 `resolveMergedPrompt` 之后：

```typescript
const referenceBundle = buildVideoReferenceBundle(refs, referenceImageUrlFromNode)
if (referenceBundle.audios.length && !referenceBundle.images.length && !referenceBundle.videos.length) {
  throw new BadRequestException('参考音频须配合参考图或视频')
}
const { mergedText, skippedMerge } = await mergeRefsToPrompt({
  ...
  downstreamType: 'video',
  imageRefs: referenceBundle.images.map(({ refKey, label }) => ({ refKey, label: label ?? refKey })),
})
const built = buildVideoProviderOptions({
  modelKey: resolved.modelName,
  duration, aspectRatio, resolution, crop,
  referenceBundle,
  videoMode: metaVideoMode,
  channelBaseUrl: resolved.credentials.baseUrl,
})
const effectivePrompt = buildEffectiveVideoPrompt(mergedText, built, referenceBundle)
const providerOptions = buildVideoProviderGenerateOptions(built)
// inline reference URLs in providerOptions.referenceImages/Videos/Audios
await createVideoProvider(providerOpts(resolved)).generate(effectivePrompt, providerOptions)
```

- [ ] **Step 2: Material runVideoGeneration — 同样改法**

- [ ] **Step 3: Update integration tests**

Run: `pnpm --filter @lnkpi/server test -- studio.integration.test.ts material.fallback.test.ts`
Expected: PASS（更新 mock 期望）

- [ ] **Step 4: Commit**

`feat(server): wire video reference bundle through studio and material`

---

### Task 7: merge-refs video imageRefs（P1 余）

**Files:**
- Modify: `packages/agent/src/refs/merge-refs.ts`
- Modify: `packages/agent/src/refs/merge-refs.test.ts`（若存在）

- [ ] **Step 1: Extend DOWNSTREAM_SYSTEM.video + buildImageRefSystemNote 复用于 video**

- [ ] **Step 2: Test merge with 2 imageRefs produces role-aware output**

- [ ] **Step 3: Commit**

`feat(agent): video merge-refs with imageRefs awareness`

---

### Task 8: 全量验证（P7）

- [ ] **Step 1: Run shared tests**

```bash
pnpm --filter @lnkpi/shared test
```

- [ ] **Step 2: Run agent tests**

```bash
pnpm --filter @lnkpi/agent test
```

- [ ] **Step 3: Run server tests**

```bash
pnpm --filter @lnkpi/server test
```

- [ ] **Step 4: Build monorepo**

```bash
pnpm build
```

Expected: all green

- [ ] **Step 5: Spec acceptance spot-check（§9.1）**

| 场景 | 验证方式 |
|---|---|
| S2 Seedance | unit: adapter `image_urls` + `@Image1` in prompt |
| S4 Agnes | unit: provider `extra_body` keyframes |
| S6 | unit: adapter `video_urls` |
| S7 block | unit/server: BadRequestException |
| S10 BYOK | unit: `ApimartVideoProvider` instance |

- [ ] **Step 6: Commit if any fixups**

`chore: verify seedance agnes video adapter tests and build`

---

## Spec Coverage Self-Review

| Spec § | Task |
|---|---|
| §2 参数分析 / clamp | Task 1 |
| §3 最佳实践 prompt / @ tags | Task 4 |
| §4 场景 S1–S10 | Task 3, 4, 6 |
| §5 VideoModelProfile | Task 1 |
| §6 Catalog | Task 1 |
| §7 clamp | Task 1, 4 |
| §8 metadata | Task 4, 6 |
| §9 验收 | Task 8 |
| §4.6 用户路径示例 | Task 6 行为对齐 |

**Deferred (P6 separate PR):** UI duration 4s、first_last_frame 模式、generate_audio 开关、lastFrameUrl 一键延续

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-08-seedance-agnes-video-adapter.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement tasks in this session with executing-plans checkpoints

**Which approach?**
