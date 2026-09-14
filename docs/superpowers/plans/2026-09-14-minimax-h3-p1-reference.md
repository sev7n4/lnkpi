# MiniMax H3 P1 Reference-to-Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock 在官网 `minimax-h3` 上新增第四模式「参考生成」（`reference_to_video`），把图/视/音参考打成 MiniMax `reference_*` roles（≤9 图 / ≤3 视 / ≤3 音，合计 ≤12），并按锁表附加积分。

**Architecture:** 共享类型增加 `reference_to_video`；H3 profile 打开 `maxVideoRefs/maxAudioRefs`；新 `supportsReferenceToVideo` **只**给 `minimax_h3_content`。Adapter 按 `videoMode` 分支：参考模式走 `reference_*`，首尾帧仍 `first_frame/last_frame`，图生只发首张 `first_frame`。Provider `buildContent` 禁止混用 first/last 与 reference。Dock 复用 `DockRefStrip`，第四按钮仅 H3 出现。超限 Nest 400 + Dock 禁用。

**Tech Stack:** NestJS、Vitest、Vue 3 Dock、现有 `VideoProvider` / `generation-adapter` / `videoCreditsForModel`

**Spec:** [docs/superpowers/specs/2026-09-13-minimax-h3-full-video-design.md](../specs/2026-09-13-minimax-h3-full-video-design.md) §P1 + §4.6  
**Parent P0:** [2026-09-14-minimax-h3-p0-video.md](./2026-09-14-minimax-h3-p0-video.md)（已合并 #305；BYOK `/v1` #306）

## Global Constraints

- 仅官网 **MiniMax-H3** P1 Reference。禁止 fal 端点、Director、Context-IR、Regeneration、`MiniMax-H3-Max`。
- 产品 **A**：第四模式 `reference_to_video`，与 `first_last_frame` 互斥。实现 **C**：复用芯片，不新做参考 UI。
- `supportsReferenceToVideo` 仅 `refWire === 'minimax_h3_content' && maxVideoRefs > 0`。Seedance 即使 `supportsVideoRef` 也不出第四按钮。
- 参考模式 `content[].role` 只能是 `reference_image|reference_video|reference_audio`，禁止混入 `first_frame`/`last_frame`。
- 图生只发 **首张** `first_frame`；**只有** `first_last_frame` 才发 `last_frame`（废止 P0「两张图默认首尾帧」）。
- 参考模式 `ratio` 必填且不可 `adaptive`（与 T2V 相同）。
- 超限 **400**（图>9 / 视>3 / 音>3 / 合计>12 / 参考模式 0 文件 / prompt>7000）。不要静默 clamp 丢掉用户材料后照样提交。
- 附加积分只在 `videoMode === 'reference_to_video'`：前 5 张图免附加，第 6 张起 +5/张；每段参考视频 +15；音频 +0。BYOK 不另发明第三套。
- 鉴权仍 Bearer；`normalizeMiniMaxBaseUrl` 剥 `/v1` 已在 P0/#306，本 plan 不改。
- 不修改平台默认视频模型。禁止与 fal Max / P2 绑同一 PR。
- Commit per task；勿 `git add -A`；PR 前 `pnpm build` + 相关 vitest。

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/videoGeneration/types.ts` | `VideoGenerationMode` 加 `reference_to_video` |
| `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts` | 识别新 mode |
| `packages/shared/src/videoGeneration/minimaxH3Reference.ts` | 上限常量 + `assertMiniMaxH3ReferenceLimits` |
| `packages/shared/src/index.ts` | 导出新模块 |
| `packages/shared/src/videoModelProfiles.ts` | H3 `maxImageRefs=9` `maxVideoRefs=3` `maxAudioRefs=3` |
| `packages/shared/src/videoModelCapabilities.ts` | `supportsReferenceToVideo` |
| `packages/agent/src/studio/video-refs.ts` | `VideoMode` 联合同步 |
| `packages/agent/src/tools/minimax-h3-video-provider.ts` | 按 mode 组装 `content[]` |
| `packages/agent/src/studio/generation-adapter.ts` | H3 按 `videoMode` 填 `reference*` / `imageWithRoles` |
| `apps/server/src/points/video-credits.ts` | 参考附加点 |
| `apps/server/src/studio/studio.service.ts` | mode 联合 + 超限 400 |
| `apps/server/src/studio/video-generation-request.util.ts` | 识别新 mode |
| `apps/server/src/canvas/material.service.ts` | 同上 |
| `apps/web/src/composables/useUpstreamNodeContext.ts` | web 侧 `VideoGenerationMode` |
| `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` | 第四按钮 + 门禁文案 |
| `apps/web/src/components/canvas/dock-studio/shared/dockRefRoleLabels.ts` | 参考模式芯片文案 |

---

### Task 1: shared mode + H3 profile caps + `supportsReferenceToVideo`

**Files:**
- Modify: `packages/shared/src/videoGeneration/types.ts`
- Modify: `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts`
- Create: `packages/shared/src/videoGeneration/minimaxH3Reference.ts`
- Create: `packages/shared/src/videoGeneration/minimaxH3Reference.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/videoModelProfiles.ts`
- Modify: `packages/shared/src/videoModelProfiles.test.ts`
- Modify: `packages/shared/src/videoModelCapabilities.ts`
- Modify: `packages/shared/src/videoModelCapabilities.test.ts`
- Modify: `packages/agent/src/studio/video-refs.ts`（`VideoMode` 与 shared 对齐）

**Interfaces:**
- Produces: `VideoGenerationMode = 'text_to_video' \| 'image_to_video' \| 'first_last_frame' \| 'reference_to_video'`
- Produces: `MINIMAX_H3_REF_LIMITS`, `assertMiniMaxH3ReferenceLimits`
- Produces: H3 profile `maxImageRefs=9`, `maxVideoRefs=3`, `maxAudioRefs=3`
- Produces: `VideoModelCapabilities.supportsReferenceToVideo: boolean`

- [ ] **Step 1: 写失败单测**

`packages/shared/src/videoGeneration/minimaxH3Reference.ts`:

```ts
export const MINIMAX_H3_REF_LIMITS = {
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxFiles: 12,
  maxPromptChars: 7000,
} as const

export const MINIMAX_H3_REF_IMAGE_FREE = 5
export const MINIMAX_H3_REF_IMAGE_EXTRA_POINTS = 5
export const MINIMAX_H3_REF_VIDEO_POINTS = 15

export function assertMiniMaxH3ReferenceLimits(input: {
  imageCount: number
  videoCount: number
  audioCount: number
  promptLength: number
}): void
```

测试（`minimaxH3Reference.test.ts`）：

```ts
it('accepts 1 video + 2 images', () => {
  expect(() =>
    assertMiniMaxH3ReferenceLimits({
      imageCount: 2,
      videoCount: 1,
      audioCount: 0,
      promptLength: 10,
    }),
  ).not.toThrow()
})

it('rejects over image/video/audio/file/prompt limits and zero files', () => {
  expect(() =>
    assertMiniMaxH3ReferenceLimits({ imageCount: 10, videoCount: 0, audioCount: 0, promptLength: 1 }),
  ).toThrow(/9/)
  expect(() =>
    assertMiniMaxH3ReferenceLimits({ imageCount: 0, videoCount: 4, audioCount: 0, promptLength: 1 }),
  ).toThrow(/3/)
  expect(() =>
    assertMiniMaxH3ReferenceLimits({ imageCount: 9, videoCount: 3, audioCount: 1, promptLength: 1 }),
  ).toThrow(/12/)
  expect(() =>
    assertMiniMaxH3ReferenceLimits({ imageCount: 0, videoCount: 0, audioCount: 0, promptLength: 1 }),
  ).toThrow(/至少/)
  expect(() =>
    assertMiniMaxH3ReferenceLimits({
      imageCount: 1,
      videoCount: 0,
      audioCount: 0,
      promptLength: 7001,
    }),
  ).toThrow(/7000/)
})
```

`videoModelProfiles.test.ts` 把 `maxImageRefs`/`maxVideoRefs`/`maxAudioRefs` 期望改为 `9/3/3`。

`videoModelCapabilities.test.ts`：

```ts
it('official H3 P1 exposes reference-to-video and Seedance does not', () => {
  const h3 = resolveVideoModelCapabilities('minimax-h3')
  expect(h3.supportsVideoRef).toBe(true)
  expect(h3.supportsAudioRef).toBe(true)
  expect(h3.supportsReferenceToVideo).toBe(true)
  expect(h3.maxImageRefs).toBe(9)
  expect(h3.maxVideoRefs).toBe(3)
  expect(h3.maxAudioRefs).toBe(3)

  const seedance = resolveVideoModelCapabilities('seedance-2.0-min')
  expect(seedance.supportsVideoRef).toBe(true)
  expect(seedance.supportsReferenceToVideo).toBe(false)

  const fal = resolveVideoModelCapabilities('h3-max-turbo')
  expect(fal.supportsReferenceToVideo).toBe(false)
  expect(fal.supportsVideoRef).toBe(false)
})
```

`resolveCanonicalVideoRequest.test.ts`（若无则追加）：explicit `videoMode: 'reference_to_video'` 原样返回。

Run: `pnpm --filter @lnkpi/shared exec vitest run src/videoGeneration/minimaxH3Reference.test.ts src/videoModelProfiles.test.ts src/videoModelCapabilities.test.ts src/videoGeneration/resolveCanonicalVideoRequest.test.ts`  
Expected: FAIL（新文件/新断言）

- [ ] **Step 2: 实现**

`types.ts`：

```ts
export type VideoGenerationMode =
  | 'text_to_video'
  | 'image_to_video'
  | 'first_last_frame'
  | 'reference_to_video'
```

`resolveCanonicalVideoRequest.ts` 的 `inferVideoMode` 白名单加上 `'reference_to_video'`。

`minimaxH3Reference.ts`：计数超限抛 `Error`，中文消息含上限数字（`图最多 9 张` / `视频最多 3 段` / `音频最多 3 段` / `参考文件合计最多 12 个` / `参考生成至少需要 1 个参考文件` / `提示词最多 7000 字`）。

`index.ts`：`export * from './videoGeneration/minimaxH3Reference'`

`MINIMAX_H3_VIDEO_PROFILE`：`maxImageRefs: 9, maxVideoRefs: 3, maxAudioRefs: 3`

`videoModelCapabilities.ts`：

```ts
supportsReferenceToVideo: isOfficialH3 && profile.maxVideoRefs > 0,
```

`packages/agent/src/studio/video-refs.ts`：`VideoMode` 同步四值（adapter 的 `videoMode` 参数类型）。

- [ ] **Step 3: 单测 PASS + Commit**

```bash
git add packages/shared/src/videoGeneration packages/shared/src/index.ts \
  packages/shared/src/videoModelProfiles.ts packages/shared/src/videoModelProfiles.test.ts \
  packages/shared/src/videoModelCapabilities.ts packages/shared/src/videoModelCapabilities.test.ts \
  packages/agent/src/studio/video-refs.ts
git commit -m "$(cat <<'EOF'
feat(shared): MiniMax H3 reference-to-video mode and ref caps

EOF
)"
```

---

### Task 2: MiniMaxH3VideoProvider 按 mode 组装 reference content

**Files:**
- Modify: `packages/agent/src/tools/minimax-h3-video-provider.ts`
- Modify: `packages/agent/src/tools/minimax-h3-video-provider.test.ts`

**Interfaces:**
- Consumes: `VideoGenerateOptions.videoMode` — **当前 options 没有 `videoMode`**。本任务给 `VideoGenerateOptions` 增加可选 `videoMode?: VideoGenerationMode`（从 `@lnkpi/shared` 导入）。
- Produces: `generate()` POST body `content[]` 在 `videoMode === 'reference_to_video'` 时使用 `reference_*` roles。

- [ ] **Step 1: 写失败单测**

在 `minimax-h3-video-provider.test.ts` 追加（沿用现有 `mockCreateAndSucceed`）：

```ts
it('reference_to_video posts reference_* roles and required ratio', async () => {
  mockCreateAndSucceed()
  const p = new MiniMaxH3VideoProvider('mm-key', 'https://api.minimax.io', 'minimax-h3')
  await p.generate('keep identity', {
    videoMode: 'reference_to_video',
    duration: 5,
    aspectRatio: '16:9',
    resolution: '768p',
    referenceImages: ['https://cdn/a.png', 'https://cdn/b.png'],
    referenceVideos: ['https://cdn/v.mp4'],
    referenceAudios: ['https://cdn/a.mp3'],
    pollIntervalMs: 0,
  })
  const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
  expect(body.ratio).toBe('16:9')
  expect(body.ratio).not.toBe('adaptive')
  expect(body.content).toEqual([
    { type: 'text', text: 'keep identity' },
    { type: 'image_url', image_url: { url: 'https://cdn/a.png' }, role: 'reference_image' },
    { type: 'image_url', image_url: { url: 'https://cdn/b.png' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://cdn/v.mp4' }, role: 'reference_video' },
    { type: 'audio_url', audio_url: { url: 'https://cdn/a.mp3' }, role: 'reference_audio' },
  ])
  const roles = (body.content as Array<{ role?: string }>).map((c) => c.role).filter(Boolean)
  expect(roles).not.toContain('first_frame')
  expect(roles).not.toContain('last_frame')
})

it('I2V still uses first_frame only (not reference_image)', async () => {
  mockCreateAndSucceed()
  const p = new MiniMaxH3VideoProvider('mm-key')
  await p.generate('walk', {
    videoMode: 'image_to_video',
    image: 'https://cdn/first.png',
    referenceImages: ['https://cdn/first.png', 'https://cdn/extra.png'],
    pollIntervalMs: 0,
  })
  const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
  expect(body.content).toEqual([
    { type: 'text', text: 'walk' },
    { type: 'image_url', image_url: { url: 'https://cdn/first.png' }, role: 'first_frame' },
  ])
  expect(body.ratio).toBeUndefined()
})

it('first_last_frame uses first_frame + last_frame', async () => {
  mockCreateAndSucceed()
  const p = new MiniMaxH3VideoProvider('mm-key')
  await p.generate('walk', {
    videoMode: 'first_last_frame',
    imageWithRoles: [
      { url: 'https://cdn/a.png', role: 'first_frame' },
      { url: 'https://cdn/b.png', role: 'last_frame' },
    ],
    pollIntervalMs: 0,
  })
  const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
  expect(body.content).toEqual([
    { type: 'text', text: 'walk' },
    { type: 'image_url', image_url: { url: 'https://cdn/a.png' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'https://cdn/b.png' }, role: 'last_frame' },
  ])
})
```

Run: `pnpm --filter @lnkpi/agent exec vitest run src/tools/minimax-h3-video-provider.test.ts`  
Expected: FAIL（`videoMode` 不存在 / content 仍 first_frame）

- [ ] **Step 2: 实现**

`video-provider.ts` `VideoGenerateOptions` 增加：

```ts
import type { VideoGenerationMode } from '@lnkpi/shared'
// ...
videoMode?: VideoGenerationMode
```

`minimax-h3-video-provider.ts` 把 `buildContent` 换成按 mode 分支：

```ts
function buildContent(
  prompt: string,
  options?: VideoGenerateOptions,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  if (options?.videoMode === 'reference_to_video') {
    for (const url of options.referenceImages ?? []) {
      const u = url.trim()
      if (u) content.push({ type: 'image_url', image_url: { url: u }, role: 'reference_image' })
    }
    for (const url of options.referenceVideos ?? []) {
      const u = url.trim()
      if (u) content.push({ type: 'video_url', video_url: { url: u }, role: 'reference_video' })
    }
    for (const url of options.referenceAudios ?? []) {
      const u = url.trim()
      if (u) content.push({ type: 'audio_url', audio_url: { url: u }, role: 'reference_audio' })
    }
    return content
  }
  const startImage = resolveStartImage(options)
  const endImage =
    options?.videoMode === 'first_last_frame' ? resolveEndImage(options) : undefined
  if (startImage) {
    content.push({ type: 'image_url', image_url: { url: startImage }, role: 'first_frame' })
  }
  if (endImage) {
    content.push({ type: 'image_url', image_url: { url: endImage }, role: 'last_frame' })
  }
  return content
}
```

`generate()`：`isImageMode = videoMode === 'image_to_video' || videoMode === 'first_last_frame' || (无 videoMode 且有 startImage)`。`reference_to_video` 与 T2V 一样写 `ratio`（缺省 `'16:9'`，拒绝 `'adaptive'`）。

现有 T2V/I2V 单测必须继续绿：未传 `videoMode` 时 I2V（有 `image`）行为与 P0 相同。

- [ ] **Step 3: PASS + Commit**

```bash
git add packages/agent/src/tools/video-provider.ts \
  packages/agent/src/tools/minimax-h3-video-provider.ts \
  packages/agent/src/tools/minimax-h3-video-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): map MiniMax H3 reference_to_video content roles

EOF
)"
```

---

### Task 3: generation-adapter 按 videoMode 接线

**Files:**
- Modify: `packages/agent/src/studio/generation-adapter.ts`（`minimax_h3_content` 分支，约 835–865 行）
- Modify: `packages/agent/src/studio/generation-adapter.test.ts`

**Interfaces:**
- Consumes: `videoMode` on adapter input（已有）
- Produces: `providerOptions.videoMode`、`referenceImages/Videos/Audios` 或 `imageWithRoles`；`droppedFields` 仅在非参考模式丢 V/A

- [ ] **Step 1: 改失败单测**

**删除或改写** `wires minimax_h3_content two refs as first/last even without first_last_frame mode`：

```ts
it('image_to_video uses only the first image as first_frame', () => {
  const r = buildVideoProviderOptions({
    modelKey: 'minimax-h3',
    videoMode: 'image_to_video',
    referenceImages: ['https://cdn/a.png', 'https://cdn/b.png', 'https://cdn/c.png'],
  })
  expect(r.providerOptions.image).toBe('https://cdn/a.png')
  expect(r.providerOptions.referenceImages).toEqual(['https://cdn/a.png'])
  expect(r.providerOptions.imageWithRoles).toEqual([
    { url: 'https://cdn/a.png', role: 'first_frame' },
  ])
})
```

**改写** `drops video and audio refs as metadata_only`：无 `videoMode` / 图生时仍 drop V/A。

**新增**：

```ts
it('reference_to_video passes image/video/audio refs natively', () => {
  const bundle = buildVideoReferenceBundle([
    { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
    { refKey: 'I2', mediaType: 'image', url: 'https://cdn/b.png' },
    { refKey: 'V1', mediaType: 'video', url: 'https://cdn/v.mp4' },
    { refKey: 'A1', mediaType: 'audio', url: 'https://cdn/a.mp3' },
  ])
  const r = buildVideoProviderOptions({
    modelKey: 'minimax-h3',
    videoMode: 'reference_to_video',
    referenceBundle: bundle,
  })
  expect(r.providerOptions.videoMode).toBe('reference_to_video')
  expect(r.providerOptions.referenceImages).toEqual(['https://cdn/a.png', 'https://cdn/b.png'])
  expect(r.providerOptions.referenceVideos).toEqual(['https://cdn/v.mp4'])
  expect(r.providerOptions.referenceAudios).toEqual(['https://cdn/a.mp3'])
  expect(r.providerOptions.imageWithRoles).toBeUndefined()
  expect(r.meta.refVideoMode).toBe('native')
  expect(r.meta.refAudioMode).toBe('native')
  expect(r.meta.droppedFields).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'referenceVideos' }),
    ]),
  )
})
```

`first_last_frame` 现有用例保持。fal `h3-max` 两图仍可按原 fal 逻辑（本任务不要改 `fal_h3_max` 分支）。

Run: `pnpm --filter @lnkpi/agent exec vitest run src/studio/generation-adapter.test.ts`  
Expected: FAIL

- [ ] **Step 2: 实现**

把 `profile.refWire === 'fal_h3_max' || profile.refWire === 'minimax_h3_content'` **拆开**。fal 分支保持 P0。H3：

```ts
} else if (profile.refWire === 'minimax_h3_content') {
  providerOptions.videoMode = videoMode
  if (videoMode === 'reference_to_video') {
    if (imageCount) {
      providerOptions.referenceImages = bundle.images.map((ref) => ref.url)
      nativeParams.reference_images = providerOptions.referenceImages
      refImageMode = 'native'
    }
    if (videoCount) {
      providerOptions.referenceVideos = bundle.videos.map((ref) => ref.url)
      nativeParams.reference_videos = providerOptions.referenceVideos
      refVideoMode = 'native'
    }
    if (audioCount) {
      providerOptions.referenceAudios = bundle.audios.map((ref) => ref.url)
      nativeParams.reference_audios = providerOptions.referenceAudios
      refAudioMode = 'native'
    }
  } else if (videoMode === 'first_last_frame' && imageCount >= 2) {
    const imageUrls = clamped.referenceImages.slice(0, 2)
    image = imageUrls[0]
    providerOptions.image = image
    providerOptions.referenceImages = imageUrls
    providerOptions.imageWithRoles = [
      { url: imageUrls[0], role: 'first_frame' },
      { url: imageUrls[1], role: 'last_frame' },
    ]
    nativeParams.image_with_roles = providerOptions.imageWithRoles
    refImageMode = 'native'
    // drop V/A as metadata_only（复制现网 first_last 文案）
  } else if (imageCount) {
    image = clamped.referenceImages[0]
    providerOptions.image = image
    providerOptions.referenceImages = [image]
    providerOptions.imageWithRoles = [{ url: image, role: 'first_frame' }]
    nativeParams.image = image
    refImageMode = 'native'
    // drop V/A as metadata_only
  } else {
    // T2V: drop V/A if present
  }
}
```

`clampVideoGenerationInput` 对 H3 现已按 profile 上限切片。参考模式超限由 Task 5 在 Nest 400；adapter 仍可 clamp 作第二道保险，但 **参考模式不要把 10 张静默变成 9 张还标 success**——若 `sourceBundle.images.length > profile.maxImageRefs` 且 `videoMode === 'reference_to_video'`，可 throw（与 assert 同一文案）。更干净：adapter 调用 `assertMiniMaxH3ReferenceLimits`。

- [ ] **Step 3: PASS + Commit**

```bash
git add packages/agent/src/studio/generation-adapter.ts \
  packages/agent/src/studio/generation-adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): wire MiniMax H3 adapter for reference_to_video

EOF
)"
```

---

### Task 4: 参考附加积分

**Files:**
- Modify: `apps/server/src/points/video-credits.ts`
- Modify: `apps/server/src/points/video-credits.test.ts`
- 导演台 / studio / material 里所有 `videoCreditsForModel(...)` 调用：补 `videoMode` + ref counts（搜 `videoCreditsForModel(`）

**Interfaces:**
- Consumes: `MINIMAX_H3_REF_IMAGE_FREE` 等常量
- Produces: `videoCreditsForModel` 扩展字段

```ts
export function videoCreditsForModel(input: {
  duration: number
  modelKey?: string
  resolution?: string
  videoMode?: string
  referenceImageCount?: number
  referenceVideoCount?: number
}): number
```

- [ ] **Step 1: 写失败单测**

```ts
it('reference_to_video adds +5 per image after 5 and +15 per ref video', () => {
  // 5s 768P base×1.2 = 36
  expect(
    videoCreditsForModel({
      duration: 5,
      modelKey: 'minimax-h3',
      resolution: '768p',
      videoMode: 'reference_to_video',
      referenceImageCount: 2,
      referenceVideoCount: 1,
    }),
  ).toBe(36 + 15) // 2 张图未超过 5

  expect(
    videoCreditsForModel({
      duration: 5,
      modelKey: 'minimax-h3',
      resolution: '768p',
      videoMode: 'reference_to_video',
      referenceImageCount: 7,
      referenceVideoCount: 0,
    }),
  ).toBe(36 + 5 * 2) // 第 6、7 张

  expect(
    videoCreditsForModel({
      duration: 5,
      modelKey: 'minimax-h3',
      resolution: '768p',
      videoMode: 'image_to_video',
      referenceImageCount: 7,
      referenceVideoCount: 1,
    }),
  ).toBe(36) // 非参考模式不加
})

it('fal h3-max ignores reference add-on fields', () => {
  expect(
    videoCreditsForModel({
      duration: 5,
      modelKey: 'h3-max-turbo',
      resolution: '768p',
      videoMode: 'reference_to_video',
      referenceImageCount: 9,
      referenceVideoCount: 3,
    }),
  ).toBe(36)
})
```

Run: `pnpm --filter @lnkpi/server exec vitest run src/points/video-credits.test.ts`  
Expected: FAIL

- [ ] **Step 2: 实现**

在官方 H3 系数之后：

```ts
if (input.videoMode === 'reference_to_video' && isOfficialH3) {
  const extraImages = Math.max(0, (input.referenceImageCount ?? 0) - MINIMAX_H3_REF_IMAGE_FREE)
  points += extraImages * MINIMAX_H3_REF_IMAGE_EXTRA_POINTS
  points += (input.referenceVideoCount ?? 0) * MINIMAX_H3_REF_VIDEO_POINTS
}
```

把 `const factor ... return Math.ceil(base * factor)` 改成先算 `let points = Math.ceil(base * factor)` 再加附加。

找到 studio/material/scene-composer 调用点，传入：

```ts
videoCreditsForModel({
  duration,
  modelKey,
  resolution,
  videoMode,
  referenceImageCount: bundle.images.length,
  referenceVideoCount: bundle.videos.length,
})
```

BYOK 路径若本来就不走 `videoCreditsForModel` 扣点，保持不动。

- [ ] **Step 3: PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): bill MiniMax H3 reference extras

EOF
)"
```

---

### Task 5: Nest 超限 400 + Dock 第四模式

**Files:**
- Modify: `apps/server/src/studio/video-generation-request.util.ts`
- Modify: `apps/server/src/studio/studio.service.ts`（`resolveStudioVideoMode` + generate 前 assert）
- Modify: `apps/server/src/canvas/material.service.ts`（mode 联合 + 同一 assert）
- Modify: `apps/web/src/composables/useUpstreamNodeContext.ts`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/shared/dockRefRoleLabels.ts`
- Modify: `apps/web/src/components/canvas/dock-studio/shared/dockRefRoleLabels.test.ts`
- Modify: `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.test.ts`（若 Task 1 未覆盖）

**Interfaces:**
- Consumes: `assertMiniMaxH3ReferenceLimits`, `supportsReferenceToVideo`
- Produces: Dock 第四按钮；H3+V/A 且非参考模式的提示文案

- [ ] **Step 1: 角色标签单测**

`dockRefRoleLabels.test.ts`：

```ts
it('reference_to_video labels image/video/audio as 参考图/参考视频/参考音频', () => {
  const refs = [
    { mediaType: 'image', stale: false, payload: { url: 'https://a' }, refId: '1' },
    { mediaType: 'video', stale: false, payload: { url: 'https://v' }, refId: '2' },
    { mediaType: 'audio', stale: false, payload: { url: 'https://a2' }, refId: '3' },
  ] as NodeRef[]
  expect(resolveRefRoleLabel(refs[0], refs, 'reference_to_video')).toBe('参考图')
  expect(resolveRefRoleLabel(refs[1], refs, 'reference_to_video')).toBe('参考视频')
  expect(resolveRefRoleLabel(refs[2], refs, 'reference_to_video')).toBe('参考音频')
})
```

现网 video→「运镜」、audio→「音频」仅在 **非** `reference_to_video` 时保留。

- [ ] **Step 2: Dock**

`useUpstreamNodeContext.ts` 的 `VideoGenerationMode` 与 `resolveVideoMode` 白名单加 `'reference_to_video'`。

`VideoDockPanel.vue`：

- 在首尾帧按钮旁增加：

```vue
<button
  v-if="capabilities.supportsReferenceToVideo"
  type="button"
  class="dock-seg-btn rounded-md px-1.5 py-1 text-[10px]"
  :class="{ 'is-on': videoMode === 'reference_to_video' }"
  :disabled="readonly"
  title="参考生成"
  @click="setVideoMode('reference_to_video')"
>
  参考生成
</button>
```

- `generateDisabled`：`reference_to_video` 且（无任何图/视/音 URL，或 `assert` 会抛）→ disabled。
- `unsupportedMediaRefs` 警告：若 `supportsReferenceToVideo && (hasVideo || hasAudio) && videoMode !== 'reference_to_video'`，文案改为「请切到参考生成」。若 `!supportsReferenceToVideo && !supportsVideoRef`，保持「请换 Seedance」。
- 切到 `first_last_frame` 时不要停留在 `reference_to_video`（互斥已由单选按钮保证）。
- 切模型到非 H3 且当前是 `reference_to_video` → `setVideoMode('text_to_video')` 或 `image_to_video`（有图则图生）。放在现有 `if (!caps.supportsFirstLastFrame && videoMode === 'first_last_frame')` 旁边。

`dockRefRoleLabels.ts`：`reference_to_video` 分支最先返回「参考图/参考视频/参考音频」。

- [ ] **Step 3: Nest**

三处 mode 白名单加 `'reference_to_video'`：`video-generation-request.util.ts`、`studio.service.ts` `resolveStudioVideoMode`、`material.service.ts`。

在 studio/material **扣点之前**，当 `resolveVideoModelProfile` 为 `minimax_h3_content` 且 `videoMode === 'reference_to_video'`：

```ts
try {
  assertMiniMaxH3ReferenceLimits({
    imageCount: bundle.images.length,
    videoCount: bundle.videos.length,
    audioCount: bundle.audios.length,
    promptLength: prompt.length,
  })
} catch (err) {
  throw new BadRequestException((err as Error).message)
}
```

（若该文件用自定义 400 helper，跟现网空 prompt 同一模式，不要引入新 HTTP 框架。）

- [ ] **Step 4: PASS + Commit**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/dock-studio/shared/dockRefRoleLabels.test.ts
pnpm --filter @lnkpi/server exec vitest run src/studio/video-generation.integration.test.ts
```

```bash
git commit -m "$(cat <<'EOF'
feat(web): MiniMax H3 reference-to-video Dock mode

EOF
)"
```

（若 web/server 必须拆两个 commit，web 一笔、server 一笔，消息分别 `feat(web): ...` / `fix(server): reject over-limit MiniMax H3 reference payloads`。）

---

### Task 6: 验收 + PR

- [ ] **Step 1: 跑测**

```bash
pnpm --filter @lnkpi/shared exec vitest run \
  src/videoGeneration/minimaxH3Reference.test.ts \
  src/videoModelProfiles.test.ts \
  src/videoModelCapabilities.test.ts \
  src/videoGeneration/resolveCanonicalVideoRequest.test.ts
pnpm --filter @lnkpi/agent exec vitest run \
  src/tools/minimax-h3-video-provider.test.ts \
  src/studio/generation-adapter.test.ts
pnpm --filter @lnkpi/server exec vitest run \
  src/points/video-credits.test.ts \
  src/studio/video-generation.integration.test.ts
pnpm --filter @lnkpi/web exec vitest run \
  src/components/canvas/dock-studio/shared/dockRefRoleLabels.test.ts
pnpm build
```

Expected: 全绿。

- [ ] **Step 2: 规格勾选**

在 `2026-09-13-minimax-h3-full-video-design.md` §7 P1 行旁加实现状态（单测证明的勾上；live 参考出片注明未打）。

- [ ] **Step 3: PR** `feature/minimax-h3-p1-reference`

Title: `feat: MiniMax H3 reference-to-video in Dock`  
Body：链规格 §4.6；说明第四模式仅官网 H3、不是 fal Max、不是 Seedance 多参考；Test plan：

- [ ] 选 MiniMax H3 出现「参考生成」；选 fal Max / Seedance 不出现
- [ ] 参考生成：2 图 + 1 视，请求 `reference_*`，无 first_frame
- [ ] 图生 2 图：只 first_frame
- [ ] 严格首尾帧：first+last
- [ ] 10 张图 → 400 / Dock 禁用
- [ ] 积分：2 图 1 视 5s 768P = 51
- [ ] Agnes / Seedance / fal Max 回归

---

## Spec coverage (P1)

| Spec § | Task |
|--------|------|
| `reference_to_video` 第四模式 A | T1 + T5 |
| 复用芯片 C | T5（无新 strip） |
| `content[]` reference roles | T2 + T3 |
| ≤9/3/3/12 + 超限 400 | T1 assert + T5 Nest/Dock |
| 验收「1 视 + 2 图」 | T2/T3 单测 |
| 参考附加积分 | T4 |
| Seedance/fal 不出第四模式 | T1 capabilities + T5 `v-if` |
| P2 IR / Regen / P3 官网 Max | **不在本 plan** |
| live 出片 | **不在本 plan**（与 P0 相同，单测 mock） |

## Self-review notes

- 不要把 `fal_h3_max` 与 H3 继续绑在同一个 adapter `if`。  
- 废止「两张图默认首尾帧」会改 P0 adapter 测试，这是规格 §4.6 明确要求。  
- `supportsVideoRef` 不能单独当第四按钮条件。  
- 参考模式必须带 `ratio`。  
- 输入视频时长未知 → 每段固定 15 点，不要发明 `refVideoPointsPerSec` 估算。  
- 边长/文件体积（256–5760、≤30MB 等）P0 也未做客户端预检，P1 仍交给上游 400；本 plan 只锁数量与 prompt 长度。
