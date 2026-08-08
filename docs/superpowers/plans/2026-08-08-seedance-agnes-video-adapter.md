# Seedance / agnes-video 视频多模态对接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-08-08-seedance-agnes-video-adapter-design.md`

**Goal:** 打通 Agnes keyframes 与 Seedance APIMart 多模态视频（I*/V*/A* native wire + @ 占位符），消除 Seedance BYOK placeholder，Studio/Material 双路径共用 adapter。**（PR #174 已完成）** 续作：**§14 E-P0/E-P1** 修复 BYOK profile 误路由并补齐 Seedance 2.0 全变体 catalog/profile；**§15 E2.5** 仅 W1 脚手架（上游 GA 前 blocked）。

**Architecture:** 在 `@lnkpi/shared` 新增 `VideoModelProfile`（镜像 `imageModelProfiles.ts`）；`generation-adapter` 扩展 `buildVideoReferenceBundle` / `buildVideoProviderOptions` / `buildEffectiveVideoPrompt`；`video-provider` 新增 `ApimartVideoProvider` 并增强 `AgnesVideoProvider`；`studio.service` / `material.service` 统一引用 bundle 与 provider options。**扩展：** `resolveSeedance20Gateway` 精确映射 gateway id；`gatewayModelHint` 贯通 BYOK；per-variant `maxResolution` / `variantTag`；2.5 预留 profile + feature flag。

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
- 实施顺序：**P0 → P3 → P2 → P5 → P4 → P1 → P7**（P6 UI 可选后续 PR）— ✅ PR #174
- **扩展顺序：E-P0 → E-P1 → P6 → E-P2 →（上游 GA）E2.5-W1+**
- **取消** `resolveVideoGatewayModelId` 对所有 `doubao-seedance-*` 一律 rewrite mini
- BYOK `doubao-seedance-1.x-*` → `BadRequestException('Seedance 1.x 不支持，请使用 seedance-2.0-min / seedance-2.0 / seedance-2.0-fast')`
- per-variant `maxResolution`：mini/fast=720p，standard=4k，face=1080p
- metadata 扩展记录 `variantTag`（`mini|standard|fast|face`）
- Seedance 2.5：**W1 前零 Provider 改动**；`SEEDANCE_25_ENABLED=false` 默认关闭
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
| `deploy/prod-pr174-verify.py` | 生产回归（扩展 Task 12 更新） |

---

## Phase A — C3-video 首轮（Tasks 1–8）✅ PR #174 merged

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

`chore: verify seedance agnes video adapter tests and build`

---

## Phase B — C3-video-ext（§14 E-P0 + E-P1）

### Task 9: resolveSeedance20Gateway + 取消 rewrite mini（E-P0-1）

**Files:**
- Modify: `packages/shared/src/videoModelProfiles.ts`
- Modify: `packages/shared/src/videoModelProfiles.test.ts`
- Modify: `packages/shared/src/index.ts`（若导出新符号）

**Interfaces:**
- Consumes: 现有 `VideoModelProfile`, `resolveVideoModelProfile`, `clampVideoGenerationInput`
- Produces: `SeedanceVariantTag`, `SEEDANCE_20_GATEWAYS`, `isSeedance1x(gatewayModelId: string): boolean`, `resolveSeedance20Gateway(modelKey: string, gatewayModelId: string): string | null`, 更新后的 `resolveVideoGatewayModelId`, `resolveVideoModelProfile`（接受精确 gateway）

- [ ] **Step 1: Write failing tests — gateway 精确映射**

```typescript
// packages/shared/src/videoModelProfiles.test.ts — append
import {
  isSeedance1x,
  resolveSeedance20Gateway,
  resolveVideoGatewayModelId,
  resolveVideoModelProfile,
} from './videoModelProfiles'

describe('resolveSeedance20Gateway', () => {
  it('maps catalog modelKey seedance-2.0-min to mini gateway', () => {
    expect(resolveSeedance20Gateway('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })

  it('maps BYOK gateway id doubao-seedance-2.0-fast without catalog entry', () => {
    expect(resolveSeedance20Gateway('doubao-seedance-2.0-fast', 'doubao-seedance-2.0-fast')).toBe(
      'doubao-seedance-2.0-fast',
    )
  })

  it('returns null for non-seedance models', () => {
    expect(resolveSeedance20Gateway('agnes-video-v2.0', 'agnes-video-v2.0')).toBeNull()
  })
})

describe('isSeedance1x', () => {
  it('detects legacy 1.0 gateway ids', () => {
    expect(isSeedance1x('doubao-seedance-1-0-lite-i2v-250428')).toBe(true)
    expect(isSeedance1x('doubao-seedance-2.0-fast')).toBe(false)
  })
})

describe('resolveVideoGatewayModelId (extended)', () => {
  it('preserves fast gateway instead of rewriting to mini', () => {
    expect(
      resolveVideoGatewayModelId('seedance-2.0-fast', 'doubao-seedance-2.0-fast'),
    ).toBe('doubao-seedance-2.0-fast')
  })

  it('still maps seedance-2.0-min catalog key to mini', () => {
    expect(resolveVideoGatewayModelId('seedance-2.0-min', 'seedance-2.0-min')).toBe(
      'doubao-seedance-2.0-mini',
    )
  })
})

describe('resolveVideoModelProfile BYOK fast hint', () => {
  it('uses apimart_multimodal for BYOK fast gateway hint', () => {
    const p = resolveVideoModelProfile(
      'doubao-seedance-2.0-fast',
      'doubao-seedance-2.0-fast',
      { channelBaseUrl: 'https://api.apimart.ai/v1' },
    )
    expect(p.refWire).toBe('apimart_multimodal')
    expect(p.gatewayModelId).toBe('doubao-seedance-2.0-fast')
    expect(p.variantTag).toBe('fast')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/shared test -- videoModelProfiles.test.ts`
Expected: FAIL — `resolveSeedance20Gateway` / `isSeedance1x` / `variantTag` not defined

- [ ] **Step 3: Implement gateway resolver + profile fields**

```typescript
// packages/shared/src/videoModelProfiles.ts — key additions
export type SeedanceVariantTag = 'mini' | 'standard' | 'fast' | 'face'

export const SEEDANCE_20_GATEWAYS = {
  mini: 'doubao-seedance-2.0-mini',
  standard: 'doubao-seedance-2.0',
  fast: 'doubao-seedance-2.0-fast',
  face: 'doubao-seedance-2.0-face',
} as const

const GATEWAY_TO_VARIANT: Record<string, SeedanceVariantTag> = {
  [SEEDANCE_20_GATEWAYS.mini]: 'mini',
  [SEEDANCE_20_GATEWAYS.standard]: 'standard',
  [SEEDANCE_20_GATEWAYS.fast]: 'fast',
  [SEEDANCE_20_GATEWAYS.face]: 'face',
}

const RESOLUTION_RANK: Record<string, number> = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4 }

export interface VideoModelProfile {
  // ...existing fields...
  variantTag?: SeedanceVariantTag
  maxResolution?: '480p' | '720p' | '1080p' | '4k'
  supportsAssetUrl?: boolean
}

export function isSeedance1x(gatewayModelId: string): boolean {
  return /^doubao-seedance-1[.-]/i.test(gatewayModelId)
}

export function resolveSeedance20Gateway(
  modelKey: string,
  gatewayModelId: string,
): string | null {
  const catalogGw = Object.values(SEEDANCE_20_GATEWAYS).find((gw) =>
    [modelKey, gatewayModelId].some((v) => v.toLowerCase() === gw.toLowerCase()),
  )
  if (catalogGw) return catalogGw
  if (/^seedance-2\.0-min$/i.test(modelKey)) return SEEDANCE_20_GATEWAYS.mini
  if (/^seedance-2\.0-fast$/i.test(modelKey)) return SEEDANCE_20_GATEWAYS.fast
  if (/^seedance-2\.0-face$/i.test(modelKey)) return SEEDANCE_20_GATEWAYS.face
  if (/^seedance-2\.0$/i.test(modelKey)) return SEEDANCE_20_GATEWAYS.standard
  if (isSeedance1x(gatewayModelId)) return null
  if (/^doubao-seedance-2\.0/i.test(gatewayModelId)) {
    const exact = Object.values(SEEDANCE_20_GATEWAYS).find(
      (gw) => gw.toLowerCase() === gatewayModelId.toLowerCase(),
    )
    return exact ?? null
  }
  return null
}

export function resolveVideoGatewayModelId(modelKey: string, gatewayModelId: string): string {
  return resolveSeedance20Gateway(modelKey, gatewayModelId) ?? gatewayModelId
}

function buildSeedance20Profile(gatewayModelId: string): VideoModelProfile {
  const variantTag = GATEWAY_TO_VARIANT[gatewayModelId] ?? 'mini'
  const maxResolution =
    variantTag === 'standard' ? '4k' : variantTag === 'face' ? '1080p' : '720p'
  const allowedResolutions =
    variantTag === 'standard'
      ? ['480p', '720p', '1080p', '4k']
      : variantTag === 'face'
        ? ['480p', '720p', '1080p']
        : ['480p', '720p']
  return {
    refWire: 'apimart_multimodal',
    sizeWire: 'ratio_duration',
    responseMode: 'async_task',
    gatewayModelId,
    variantTag,
    maxResolution,
    supportsAssetUrl: variantTag === 'standard' || variantTag === 'fast',
    maxImageRefs: 9,
    maxVideoRefs: 3,
    maxAudioRefs: 3,
    minDuration: 4,
    maxDuration: 15,
    allowedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    allowedResolutions,
    defaultGenerateAudio: true,
    pollIntervalMs: 8_000,
    maxPollMs: 600_000,
  }
}
```

在 `resolveVideoModelProfile` 内：若 `resolveSeedance20Gateway(modelKey, gatewayModelId)` 非 null → 返回 `buildSeedance20Profile(resolvedGw)`；**删除**旧 `isSeedanceModel → 恒 mini` 分支。

更新 `clampVideoGenerationInput`：

```typescript
function clampResolution(
  resolution: string,
  profile: VideoModelProfile,
  droppedFields: Array<{ field: string; reason: string }>,
): string {
  const cap = profile.maxResolution ?? '1080p'
  if ((RESOLUTION_RANK[resolution] ?? 0) > (RESOLUTION_RANK[cap] ?? 0)) {
    droppedFields.push({
      field: 'resolution',
      reason: `${resolution} not on ${profile.variantTag ?? 'model'}; use ${cap}`,
    })
    return cap
  }
  return resolution
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm --filter @lnkpi/shared test -- videoModelProfiles.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/videoModelProfiles.ts packages/shared/src/videoModelProfiles.test.ts packages/shared/src/index.ts
git commit -m "fix(shared): resolve Seedance 2.0 gateways per variant instead of forcing mini"
```

---

### Task 10: gatewayModelHint + 1.x 阻断（E-P0-2 / E-P0-3）

**Files:**
- Modify: `packages/agent/src/studio/generation-adapter.ts`
- Modify: `packages/agent/src/studio/generation-adapter.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/studio/studio.integration.test.ts`
- Modify: `apps/server/src/canvas/material.service.test.ts`

**Interfaces:**
- Consumes: `isSeedance1x`, `resolveVideoModelProfile` from `@lnkpi/shared`
- Produces: `buildVideoProviderOptions` 新入参 `gatewayModelHint?: string`；抛出 `Seedance1xUnsupportedError`（message 含中文提示）

- [ ] **Step 1: Write failing adapter test — BYOK fast hint**

```typescript
// packages/agent/src/studio/generation-adapter.test.ts — append
it('uses apimart_multimodal for BYOK doubao-seedance-2.0-fast gateway hint', () => {
  const r = buildVideoProviderOptions({
    modelKey: 'doubao-seedance-2.0-fast',
    gatewayModelHint: 'doubao-seedance-2.0-fast',
    channelBaseUrl: 'https://api.apimart.ai/v1',
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
  })
  expect(r.meta.refWire).toBe('apimart_multimodal')
  expect(r.meta.gatewayModelId).toBe('doubao-seedance-2.0-fast')
  expect(r.meta.variantTag).toBe('fast')
})

it('throws for seedance 1.x gateway hint', () => {
  expect(() =>
    buildVideoProviderOptions({
      modelKey: 'doubao-seedance-1-0-lite-i2v-250428',
      gatewayModelHint: 'doubao-seedance-1-0-lite-i2v-250428',
      channelBaseUrl: 'https://api.apimart.ai/v1',
    }),
  ).toThrow(/Seedance 1\.x 不支持/)
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/agent test -- generation-adapter.test.ts`

- [ ] **Step 3: Implement gatewayModelHint in adapter**

```typescript
// packages/agent/src/studio/generation-adapter.ts
import { isSeedance1x, resolveVideoModelProfile } from '@lnkpi/shared'

export class Seedance1xUnsupportedError extends Error {
  constructor() {
    super('Seedance 1.x 不支持，请使用 seedance-2.0-min / seedance-2.0 / seedance-2.0-fast')
    this.name = 'Seedance1xUnsupportedError'
  }
}

export function buildVideoProviderOptions(input: {
  modelKey?: string
  gatewayModelHint?: string
  // ...existing fields...
}): BuiltVideoProviderOptions {
  const catalogResolved = resolveModelKey('video', input.modelKey)
  const gatewayHint =
    input.gatewayModelHint ??
    (catalogResolved.fallback ? undefined : catalogResolved.entry.gatewayModelId)

  if (gatewayHint && isSeedance1x(gatewayHint)) {
    throw new Seedance1xUnsupportedError()
  }

  const profileKey = catalogResolved.fallback
    ? (gatewayHint ?? catalogResolved.modelKey)
    : catalogResolved.modelKey
  const profileGw = gatewayHint ?? catalogResolved.entry.gatewayModelId

  const profile = resolveVideoModelProfile(profileKey, profileGw, {
    channelBaseUrl: input.channelBaseUrl,
  })
  // ...rest unchanged; meta includes variantTag + gatewayModelId from profile...
}
```

- [ ] **Step 4: Wire server — pass gatewayModelHint + map error**

```typescript
// apps/server/src/studio/studio.service.ts — inside generateVideo
import { Seedance1xUnsupportedError } from '@lnkpi/agent'

let built
try {
  built = buildVideoProviderOptions({
    modelKey: resolved.modelName,
    gatewayModelHint: resolved.source === 'user' ? resolved.modelName : undefined,
    duration,
    aspectRatio,
    resolution,
    crop,
    referenceBundle,
    videoMode: referenceBundle.images.length ? 'image_to_video' : 'text_to_video',
    channelBaseUrl: resolved.credentials.baseUrl,
  })
} catch (err) {
  if (err instanceof Seedance1xUnsupportedError) {
    throw new BadRequestException(err.message)
  }
  throw err
}
```

`material.service.ts` 同样改法。

- [ ] **Step 5: Server integration test — 1.x blocked**

```typescript
// apps/server/src/studio/studio.integration.test.ts — append
it('rejects seedance 1.x BYOK models', async () => {
  await expect(
    svc.generateVideo('u1', 'walk', 'ch_user::doubao-seedance-1-0-lite-i2v-250428', 5),
  ).rejects.toThrow('Seedance 1.x 不支持')
})
```

- [ ] **Step 6: Run tests**

Run:
```bash
pnpm --filter @lnkpi/agent test -- generation-adapter.test.ts
pnpm --filter @lnkpi/server test -- studio.integration.test.ts material.service.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(agent,server): gatewayModelHint for BYOK seedance and block 1.x"
```

---

### Task 11: Catalog 三变体 + per-variant clamp + variantTag metadata（E-P1）

**Files:**
- Modify: `packages/shared/src/studioModelCatalog.ts`
- Modify: `packages/shared/src/videoModelProfiles.test.ts`
- Modify: `packages/agent/src/studio/generation-adapter.ts`（meta.variantTag 写入）
- Modify: `apps/server/src/studio/studio.integration.test.ts`

**Interfaces:**
- Consumes: Task 9 `buildSeedance20Profile`, Task 10 `gatewayModelHint`
- Produces: catalog entries `seedance-2.0`, `seedance-2.0-fast`, `seedance-2.0-face`；metadata `variantTag`

- [ ] **Step 1: Write failing tests — standard 1080p / fast clamp**

```typescript
// packages/shared/src/videoModelProfiles.test.ts — append
describe('per-variant resolution clamp', () => {
  it('allows 1080p on seedance-2.0 standard', () => {
    const profile = resolveVideoModelProfile('seedance-2.0', 'doubao-seedance-2.0')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      aspectRatio: '16:9',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('1080p')
    expect(r.droppedFields).toHaveLength(0)
  })

  it('clamps 1080p to 720p on seedance-2.0-fast', () => {
    const profile = resolveVideoModelProfile('seedance-2.0-fast', 'doubao-seedance-2.0-fast')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      aspectRatio: '16:9',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('720p')
    expect(r.droppedFields.some((d) => d.field === 'resolution')).toBe(true)
  })

  it('regresses mini 1080p clamp to 720p', () => {
    const profile = resolveVideoModelProfile('seedance-2.0-min', 'doubao-seedance-2.0-mini')
    const r = clampVideoGenerationInput(profile, {
      duration: 5,
      resolution: '1080p',
      aspectRatio: '16:9',
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    })
    expect(r.resolution).toBe('720p')
  })
})
```

- [ ] **Step 2: Add catalog entries**

```typescript
// packages/shared/src/studioModelCatalog.ts — after seedance-2.0-min block
{
  modelKey: 'seedance-2.0',
  displayName: 'Seedance 2.0',
  gatewayModelId: 'doubao-seedance-2.0',
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
  defaults: { duration: 5, generateAudio: true, resolution: '720p' },
},
{
  modelKey: 'seedance-2.0-fast',
  displayName: 'Seedance 2.0 Fast',
  gatewayModelId: 'doubao-seedance-2.0-fast',
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
  defaults: { duration: 5, generateAudio: true, resolution: '720p' },
},
{
  modelKey: 'seedance-2.0-face',
  displayName: 'Seedance 2.0 Face',
  gatewayModelId: 'doubao-seedance-2.0-face',
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
  defaults: { duration: 5, generateAudio: true, resolution: '720p' },
},
```

- [ ] **Step 3: Ensure adapter meta includes variantTag**

```typescript
// generation-adapter.ts — in buildVideoProviderOptions return meta
meta: {
  modelKey: catalogResolved.fallback ? profileKey : catalogResolved.modelKey,
  gatewayModelId: profile.gatewayModelId,
  variantTag: profile.variantTag,
  refWire,
  // ...
}
```

- [ ] **Step 4: Integration test — standard multimodal**

```typescript
// studio.integration.test.ts
it('passes 1080p and apimart_multimodal for seedance-2.0 standard', async () => {
  await svc.generateVideo(
    'u1',
    'walk @Image1',
    'seedance-2.0',
    5,
    '16:9',
    [{ refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref.png' }],
    [],
    '1080p',
  )
  await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
  expect(videoGenerate.mock.calls[0]?.[1]).toMatchObject({
    model: 'doubao-seedance-2.0',
    resolution: '1080p',
    referenceImages: ['https://example.com/ref.png'],
  })
})
```

- [ ] **Step 5: Run tests + build**

```bash
pnpm --filter @lnkpi/shared test -- videoModelProfiles.test.ts
pnpm --filter @lnkpi/agent test -- generation-adapter.test.ts
pnpm --filter @lnkpi/server test -- studio.integration.test.ts
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(shared): add Seedance 2.0 standard/fast/face catalog and variant profiles"
```

---

### Task 12: 生产验证脚本更新 + 全量回归（E-P0/E-P1 验收）

**Files:**
- Modify: `deploy/prod-pr174-verify.py`

**Interfaces:**
- Consumes: 生产 API `POST /studio/video/generate`
- Produces: 覆盖 E0-1/E0-2/E1-2/E1-3 断言

- [ ] **Step 1: Extend prod verify — BYOK fast refWire + 1.x block**

```python
# deploy/prod-pr174-verify.py — append after Seedance BYOK section

def test_byok_fast_refwire(tok: str) -> None:
    seedance = pick_seedance_model(tok, prefer="fast")  # helper: match '2.0-fast' in name
    if not seedance:
        record("BYOK fast refWire", False, "no BYOK fast channel", skip=True)
        return
    # start generation, poll metadata — assert refWire == apimart_multimodal, variantTag == fast

def test_seedance_1x_blocked(tok: str) -> None:
    st, payload = http_json_expect(
        "POST",
        "/studio/video/generate",
        {
            "prompt": "test",
            "model": "USER_CHANNEL_ID::doubao-seedance-1-0-lite-i2v-250428",  # skip if channel unknown
            "duration": 5,
        },
        tok,
        expect_status=400,
    )
    # skip if channel not configured; else assert 400 + 1.x message
```

- [ ] **Step 2: Add standard 1080p smoke (optional BYOK/platform)**

若平台配置了 `seedance-2.0` 或 BYOK standard channel，断言 `resolution` 未 downgrade。

- [ ] **Step 3: Run local test suite**

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/agent test
pnpm --filter @lnkpi/server test
pnpm build
```

- [ ] **Step 4: Run prod verify (manual / CI optional)**

```bash
python3 deploy/prod-pr174-verify.py
```

Expected: E0/E1 cases PASS；mini 回归仍绿

- [ ] **Step 5: Commit**

```bash
git add deploy/prod-pr174-verify.py
git commit -m "test(deploy): extend prod verify for Seedance 2.0 variants"
```

---

## Phase C — Seedance 2.5 演进（§15，blocked until upstream GA）

> **Do not start Task 13 until §15.4 W0→W1 三条件全部满足。**

### Task 13: E2.5-W1 脚手架（feature flag + 预留 profile）— BLOCKED

**Trigger（须全部满足）：**
1. APIMart 文档出现可调用 `doubao-seedance-2.5`（或公布最终 model id）
2. 请求/响应 schema diff 发布
3. 测试 API key t2v 5s 冒烟成功

**Files:**
- Modify: `packages/shared/src/videoModelProfiles.ts`
- Modify: `packages/shared/src/studioModelCatalog.ts`
- Modify: `packages/shared/src/videoModelProfiles.test.ts`
- Create: `docs/superpowers/specs/seedance-2.5-upstream-changelog.md`（粘贴 APIMart GA 参数快照）

**Interfaces:**
- Produces: `SEEDANCE_25_ENABLED` env（默认 `false`）；catalog entry `seedance-2.5`（`hidden: true` 或 UI 灰显）；profile `maxDuration: 30`, `maxImageRefs: 50`, `maxPollMs: 900_000`

- [ ] **Step 1: Write failing test — profile exists but disabled**

```typescript
it('returns seedance 2.5 profile when SEEDANCE_25_ENABLED=true', () => {
  process.env.SEEDANCE_25_ENABLED = 'true'
  const p = resolveVideoModelProfile('seedance-2.5', 'doubao-seedance-2.5')
  expect(p.maxDuration).toBe(30)
  expect(p.maxImageRefs).toBe(50)
  delete process.env.SEEDANCE_25_ENABLED
})

it('throws when seedance-2.5 requested but flag off', () => {
  expect(() => resolveVideoModelProfile('seedance-2.5', 'doubao-seedance-2.5')).toThrow(
    /not enabled/i,
  )
})
```

- [ ] **Step 2: Implement gated profile + hidden catalog entry**

```typescript
function isSeedance25Enabled(): boolean {
  return process.env.SEEDANCE_25_ENABLED === 'true'
}

// resolveVideoModelProfile — before legacy fallback
if (/^seedance-2\.5$/i.test(modelKey) || /^doubao-seedance-2\.5/i.test(gatewayModelId)) {
  if (!isSeedance25Enabled()) {
    throw new Error('Seedance 2.5 is not enabled yet')
  }
  return {
    refWire: 'apimart_multimodal',
    gatewayModelId: 'doubao-seedance-2.5', // update when GA id known
    variantTag: undefined,
    maxDuration: 30,
    maxImageRefs: 50,
    maxVideoRefs: 50,
    maxAudioRefs: 50,
    maxResolution: '4k',
    pollIntervalMs: 10_000,
    maxPollMs: 900_000,
    // ...fill remaining required VideoModelProfile fields same as 2.0 standard...
  }
}
```

- [ ] **Step 3: Document upstream snapshot**

创建 `docs/superpowers/specs/seedance-2.5-upstream-changelog.md`，记录 GA 日 model id、参数 diff、定价。

- [ ] **Step 4: Tests PASS, commit**

```bash
git commit -m "chore(shared): scaffold gated Seedance 2.5 profile (disabled by default)"
```

### Task 14: E2.5-W2+ 实施清单（plan-only，GA 后拆独立 plan）

| 子阶段 | 工作项 | 文件 |
|---|---|---|
| W2 | Provider 白名单 + duration/refs clamp 50/30s | `video-provider.ts`, `videoModelProfiles.ts` |
| W3 | UI 30s / 4K 控件（extends P6） | `VideoDockPanel.vue`, `VideoSettingsSelector.vue` |
| W3 | 区域编辑 API 字段（若上游暴露 `region`/`mask`） | `generation-adapter.ts` |
| W4 | `deploy/prod-seedance-25-verify.py` | `deploy/` |

**W2 验收：** t2v/i2v 30s 请求不被 clamp 到 15s；metadata `maxDuration=30`。  
**W4 验收：** 生产 30s 片源生成 poll 成功或明确上游 error（非 adapter bug）。

---

## Spec Coverage Self-Review

| Spec § | Task |
|---|---|
| §2 参数分析 / clamp | Task 1, **Task 9, 11** |
| §3 最佳实践 prompt / @ tags | Task 4 |
| §4 场景 S1–S10 | Task 3, 4, 6, **11** |
| §5 VideoModelProfile | Task 1, **Task 9, 11, 13** |
| §6 Catalog | Task 1, **Task 11, 13** |
| §7 clamp | Task 1, 4, **Task 9, 11** |
| §8 metadata | Task 4, 6, **Task 11** |
| §9 验收 | Task 8, **Task 12** |
| §4.6 用户路径示例 | Task 6 行为对齐 |
| **§14 E-P0** | **Task 9, 10, 12** |
| **§14 E-P1** | **Task 11, 12** |
| **§14 E-P2** | deferred（asset:// 独立 PR） |
| **§15 E2.5** | **Task 13 (W1), Task 14 (W2–W4 plan-only)** |

**Completed (PR #174):** Tasks 1–8  
**Deferred (P6 separate PR):** UI duration 4s、first_last_frame 模式、generate_audio 开关、lastFrameUrl 一键延续  
**Deferred (E-P2):** `asset://` inline + 4K UI  
**Blocked (E2.5):** Task 13 until upstream GA

---

## Execution Handoff

Plan updated with **Phase B (Tasks 9–12)** and **Phase C (Tasks 13–14 blocked)** in `docs/superpowers/plans/2026-08-08-seedance-agnes-video-adapter.md`.

**PR #174（Tasks 1–8）已合并。** 下一步执行扩展：

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per Task 9→12, review between tasks  
2. **Inline Execution** — implement Tasks 9–12 in this session with executing-plans checkpoints

**Recommended order:** Task 9 → Task 10 → Task 11 → Task 12（Task 13 等 APIMart 2.5 GA）

**Which approach?**
