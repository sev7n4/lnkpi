# Dock Studio 模型对接适配层（C1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 text/image/video/audio 的 Dock 模型目录与底部参数、T*/I* 芯片按能力表真实进入 OpenAI-compatible 网关；Audio 补齐模型选择与语音参数单卡；禁止静默丢弃。

**Architecture:** `packages/shared` 提供 `studioModelCatalog` + 字段能力表；`packages/agent` 提供 `StudioGenerationAdapter`（build*Request / promptPrefix / modelFallback）；`StudioService` 经适配层再调 provider；Web Dock 只选 modelKey，音色随 audio 模型切换。

**Tech Stack:** Vue 3, TypeScript, NestJS, Vitest, OpenAI-compatible gateway

**Spec:** `docs/superpowers/specs/2026-07-19-dock-studio-model-adapter-design.md`

## Global Constraints

- 范围仅 **C1**（不含 shot/scene composer、V* 抽帧、A* ASR）
- 只选模型；供应商由 catalog 映射；`providerBinding: gateway-openai-compat`
- 环境变量只提供默认 modelKey，不得静默覆盖用户选择
- 不支持字段：`native` | `promptPrefix` | `metadataOnly`，禁止第三种静默丢弃
- 参考图禁止 `blob:` 出站；先 `persistMediaUrl`
- 提交前：`pnpm --filter @lnkpi/agent test`；改 web 时 `pnpm --filter @lnkpi/web exec vue-tsc -b` 或 `pnpm build`
- 网关 `gatewayModelId` 实测结果只更新规格附录，不阻塞骨架合入

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `packages/shared/src/studioModelCatalog.ts` | 四模态模型目录、默认 key、voices、字段能力 |
| `packages/shared/src/studioModelCatalog.test.ts` | catalog / resolve / voices 单测 |
| `packages/shared/src/index.ts` | re-export |
| `packages/agent/src/studio/generation-adapter.ts` | buildAudio/Image/Video 请求、前缀、降级 |
| `packages/agent/src/studio/generation-adapter.test.ts` | 适配层单测 |
| `packages/agent/src/index.ts` | export adapter |
| `packages/agent/src/tools/audio-provider.ts` | 接受 model/speed/volume/pitch/emotion 等 options |
| `packages/agent/src/tools/image-provider.ts` | 确保 `modelId` 进请求（已有接口，补调用链） |
| `packages/agent/src/tools/video-provider.ts` | 确保 `options.image` / crop 按能力使用 |
| `apps/server/src/studio/studio.controller.ts` | Audio DTO 增加 volume/pitch；model 透传 |
| `apps/server/src/studio/studio.service.ts` | 经 adapter 再调 provider；metadata 写入 |
| `apps/web/src/constants/studioModels.ts` | 薄封装 re-export shared catalog（供 Dock） |
| `apps/web/src/constants/dockAudio.ts` | 默认 volume/pitch；按模型 voices helper |
| `apps/web/src/components/canvas/UniversalModelSelector.vue` | Dock 数据源改为 catalog |
| `apps/web/src/components/canvas/VoiceModelSelector.vue` | 接收 `voices` prop |
| `apps/web/src/components/canvas/AudioVoiceSettingsSelector.vue` | 单卡含 emotion/language/speed/volume/pitch |
| `apps/web/src/components/canvas/dock-studio/panels/AudioDockPanel.vue` | 模型选择器 + 随模型音色 + 参数卡 |
| `apps/web/src/components/canvas/dock-studio/panels/{Text,Image,Video}DockPanel.vue` | 默认 modelKey 对齐 catalog |
| `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue` / `VideoDockPanel.vue` | 参考图上传改持久化 |
| `apps/web/src/composables/useNodeGeneration.ts` | 传 audioVolume/audioPitch/audioModel；blob 校验 |
| `apps/web/src/services/studio-api.ts` | generateAudio 增加 volume/pitch |
| `apps/web/src/composables/useModelProviderSettings.ts` | defaults 对齐 catalog 默认 modelKey |

---

### Task 1: shared `studioModelCatalog`

**Files:**
- Create: `packages/shared/src/studioModelCatalog.ts`
- Create: `packages/shared/src/studioModelCatalog.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type StudioModality = 'text' | 'image' | 'video' | 'audio'
export type ParamDisposition = 'native' | 'promptPrefix' | 'metadataOnly'

export interface StudioVoiceOption {
  id: string
  label: string
}

export interface StudioModelEntry {
  modelKey: string
  displayName: string
  gatewayModelId: string
  modality: StudioModality
  providerBinding: 'gateway-openai-compat'
  voices?: StudioVoiceOption[]
  /** 字段名 → 处置；未列出的生成参数默认 metadataOnly */
  params: Record<string, ParamDisposition>
  defaults?: Record<string, string | number>
}

export declare const STUDIO_MODEL_CATALOG: StudioModelEntry[]
export declare function listModels(modality: StudioModality): StudioModelEntry[]
export declare function getModelEntry(modelKey: string): StudioModelEntry | undefined
export declare function resolveModelKey(modality: StudioModality, requested?: string | null): {
  modelKey: string
  entry: StudioModelEntry
  fallback: boolean
}
export declare function defaultModelKey(modality: StudioModality): string
```

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/studioModelCatalog.test.ts
import { describe, expect, it } from 'vitest'
import {
  listModels,
  resolveModelKey,
  defaultModelKey,
  getModelEntry,
} from './studioModelCatalog'

describe('studioModelCatalog', () => {
  it('lists fixed product models per modality', () => {
    expect(listModels('text').map((m) => m.modelKey)).toEqual([
      'gemini-3.1-flash',
      'deepseek-v4',
      'gpt-5.5',
    ])
    expect(listModels('image')).toHaveLength(4)
    expect(listModels('video')).toHaveLength(3)
    expect(listModels('audio').map((m) => m.modelKey)).toEqual([
      'seed-audio-1.0',
      'minimax-speech-2.8-hd',
    ])
  })

  it('falls back unknown modelKey and sets fallback flag', () => {
    const r = resolveModelKey('image', 'not-a-real-model')
    expect(r.fallback).toBe(true)
    expect(r.modelKey).toBe(defaultModelKey('image'))
  })

  it('exposes voices for audio models', () => {
    const mini = getModelEntry('minimax-speech-2.8-hd')
    expect(mini?.voices?.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/studioModelCatalog.test.ts`  
（若 shared 无 vitest，则把测试放到 `packages/agent` 并 import `@lnkpi/shared`，或给 shared 加 vitest script；优先与现有 shared 测试方式一致。）

Expected: FAIL module not found

- [ ] **Step 3: Implement catalog**

在 `studioModelCatalog.ts` 写入规格 §3 全部条目：

- audio `minimax-speech-2.8-hd`：`params` 含 `voice/speed/volume/pitch` → `native`；`emotion` → `native` 或 `promptPrefix`；`language` → `promptPrefix`（或 native 若打算映射 language_boost）
- audio `seed-audio-1.0`：保守 — `voice/speed` native；其余 promptPrefix/metadataOnly
- image/video/text：至少 `model` native；image 另含文档化的多图策略由 adapter 处理
- 每个 entry `providerBinding: 'gateway-openai-compat'`
- `gatewayModelId` 初值按规格附录（minimax 可用 `speech-2.8-hd`）
- `defaultModelKey`：text=`gemini-3.1-flash`，image=`seedream-5.0-pro`，video=`seedance-2.0-min`，audio=`minimax-speech-2.8-hd`

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/studioModelCatalog.ts packages/shared/src/studioModelCatalog.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add studio model catalog and capabilities table"
```

---

### Task 2: `StudioGenerationAdapter`（agent）

**Files:**
- Create: `packages/agent/src/studio/generation-adapter.ts`
- Create: `packages/agent/src/studio/generation-adapter.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: `resolveModelKey`, `getModelEntry` from `@lnkpi/shared`
- Produces:

```ts
export interface AdapterMeta {
  modelKey: string
  gatewayModelId: string
  nativeParams: Record<string, unknown>
  promptPrefixApplied?: string
  droppedFields: Array<{ field: string; reason: string }>
  refImageMode?: 'native' | 'primary_image' | 'prompt_url_tags' | 'none'
  referenceImageCount?: number
  modelFallback?: boolean
}

export interface BuiltAudioRequest {
  text: string
  options: {
    model: string
    voice?: string
    speed?: number
    volume?: number
    pitch?: number
    emotion?: string
  }
  meta: AdapterMeta
}

export declare function buildAudioRequest(input: {
  mergedText: string
  modelKey?: string
  voice?: string
  emotion?: string
  language?: string
  speed?: number
  volume?: number
  pitch?: number
}): BuiltAudioRequest

export declare function buildImageProviderOptions(input: {
  modelKey?: string
  size: string
  n: number
  referenceImages: string[]
}): { modelId: string; size: string; n: number; referenceImages: string[]; meta: AdapterMeta }

export declare function buildVideoProviderOptions(input: {
  modelKey?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  referenceImages: string[]
}): {
  model: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  image?: string
  effectivePromptSuffix?: string
  meta: AdapterMeta
}
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildAudioRequest, buildVideoProviderOptions, buildImageProviderOptions } from './generation-adapter'

describe('buildAudioRequest', () => {
  it('maps native speed/volume/pitch for minimax and prefixes language when needed', () => {
    const r = buildAudioRequest({
      mergedText: '你好世界',
      modelKey: 'minimax-speech-2.8-hd',
      voice: 'female-tender',
      emotion: 'happy',
      language: 'zh',
      speed: 1.2,
      volume: 1,
      pitch: 0,
    })
    expect(r.options.model).toBeTruthy()
    expect(r.options.speed).toBe(1.2)
    expect(r.meta.droppedFields.every((d) => d.reason)).toBe(true)
    // language 若为 promptPrefix：
    if (r.meta.promptPrefixApplied) {
      expect(r.text.startsWith(r.meta.promptPrefixApplied) || r.text.includes('中文')).toBe(true)
    }
  })

  it('records modelFallback for unknown audio model', () => {
    const r = buildAudioRequest({ mergedText: 'hi', modelKey: 'nope' })
    expect(r.meta.modelFallback).toBe(true)
  })
})

describe('buildVideoProviderOptions', () => {
  it('puts first reference image into options.image', () => {
    const r = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      referenceImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
    })
    expect(r.image).toBe('https://cdn.example/a.png')
    expect(r.meta.refImageMode).toBe('primary_image')
    expect(r.meta.referenceImageCount).toBe(2)
  })
})

describe('buildImageProviderOptions', () => {
  it('passes modelId size n and keeps all reference URLs in meta', () => {
    const r = buildImageProviderOptions({
      modelKey: 'seedream-5.0-pro',
      size: '1024x1024',
      n: 2,
      referenceImages: ['https://cdn.example/a.png'],
    })
    expect(r.modelId).toBeTruthy()
    expect(r.n).toBe(2)
    expect(r.meta.referenceImageCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @lnkpi/agent exec vitest run src/studio/generation-adapter.test.ts`

- [ ] **Step 3: Implement adapter**

规则：

- `buildAudioRequest`：按 entry.params 分流；promptPrefix 模板示例：`【朗读设定】情绪={emotion}；语言={language}\n`
- 无效 voice：回退 `entry.voices[0].id`，记 dropped/replaced
- `buildVideoProviderOptions`：`image = referenceImages[0]`；其余 URL 可放 `effectivePromptSuffix`（`[ref-image:...]`）供 service 拼进 prompt；crop 非 native 则进 droppedFields，不传 crop
- `buildImageProviderOptions`：`modelId = entry.gatewayModelId`；referenceImages 全量进返回值供后续扩展；meta.refImageMode 暂标 `native` 若 length>0 否则 `none`（真正多模态进 vision 由 image provider 后续任务接）

- [ ] **Step 4: PASS + Commit**

```bash
git add packages/agent/src/studio packages/agent/src/index.ts
git commit -m "feat(agent): add studio generation adapter for model params"
```

---

### Task 3: Audio / Image / Video providers 吃透传参数

**Files:**
- Modify: `packages/agent/src/tools/audio-provider.ts`
- Modify: `packages/agent/src/tools/image-provider.ts`（确认 modelId）
- Modify: `packages/agent/src/tools/video-provider.ts`（image 已在类型中，确认 Agnes body）
- Test: 扩展或新增 provider 单测（可 mock fetch）

**Interfaces:**
- Consumes: adapter 产出的 options
- Produces: provider 请求体含 model + native 字段

- [ ] **Step 1: 扩展 AudioProvider 接口**

```ts
export interface AudioGenerateOptions {
  model?: string
  voice?: string
  speed?: number
  volume?: number
  pitch?: number
  emotion?: string
}

export interface AudioProvider {
  generate(text: string, options?: AudioGenerateOptions): Promise<{ url: string }>
}
```

将现有 `generate(text, voice?)` 改为 options 对象（保留对旧 `voice` 字符串调用的兼容 overload 可选，但本仓调用点一并改掉）。

OpenAI/兼容 TTS body 示例：

```ts
body: JSON.stringify({
  model: options?.model ?? this.model,
  input: text.slice(0, 4096),
  voice: options?.voice ?? 'alloy',
  speed: options?.speed,
  // 若网关支持则附加：
  ...(options?.volume != null ? { volume: options.volume } : {}),
  ...(options?.pitch != null ? { pitch: options.pitch } : {}),
  ...(options?.emotion ? { emotion: options.emotion } : {}),
})
```

- [ ] **Step 2: Image** — `createImageProvider().generate(prompt, { size, n, modelId })` 路径由 Task 4 service 保证；本任务确认 `OpenAIImageProvider` 已使用 `options?.modelId`。

- [ ] **Step 3: Video** — `AgnesVideoProvider.generate` 已有 `if (options?.image) body.image = options.image`；确认 crop 不进 body 除非未来支持；单测或手工注释覆盖。

- [ ] **Step 4: `pnpm --filter @lnkpi/agent test` PASS + Commit**

```bash
git commit -am "feat(agent): pass model and voice params through audio/image/video providers"
```

---

### Task 4: StudioService / Controller 接入 adapter

**Files:**
- Modify: `apps/server/src/studio/studio.controller.ts`
- Modify: `apps/server/src/studio/studio.service.ts`

**Interfaces:**
- Consumes: `buildAudioRequest`, `buildImageProviderOptions`, `buildVideoProviderOptions`
- Produces: GenerationRecord.metadata 含 AdapterMeta 字段

- [ ] **Step 1: DTO**

`GenerateAudioDto` 增加：

```ts
@IsOptional() @IsNumber() volume?: number
@IsOptional() @IsNumber() pitch?: number
// model 字段若已有则复用；确保 controller 传入 service
```

controller `generateAudio` 传入 `volume`/`pitch`/`model`。

- [ ] **Step 2: `generateAudio`**

```ts
const { mergedText, skippedMerge } = await this.resolveMergedPrompt(...)
const built = buildAudioRequest({
  mergedText,
  modelKey: model ?? options 对应,
  voice, emotion, language, speed, volume, pitch,
})
const { url } = await createAudioProvider().generate(built.text, built.options)
// metadata: { ...built.meta, skippedMerge, emotion, language, ... }
```

- [ ] **Step 3: `generateImage`**

```ts
const built = buildImageProviderOptions({ modelKey: model, size, n, referenceImages })
const { url, urls } = await createImageProvider().generate(effectivePrompt, {
  size: built.size,
  n: built.n,
  modelId: built.modelId,
})
// 若仍用 buildPromptWithRefImage，与 built.meta.refImageMode 对齐；优先保留多图 URL 在 metadata
```

停止「只传 `{ size, n }` 丢掉 model」的现状。

- [ ] **Step 4: `generateVideo` / `completeVideo`**

```ts
const built = buildVideoProviderOptions({ modelKey: model, duration, aspectRatio, resolution, crop, referenceImages })
const effectivePrompt = [mergedText, built.effectivePromptSuffix].filter(Boolean).join('\n')
// completeVideo(..., { model: built.model, duration, aspectRatio, resolution, crop: built.crop, image: built.image })
```

- [ ] **Step 5: `pnpm --filter @lnkpi/server build`（或 root `pnpm build` 的 server 部分）+ Commit**

```bash
git commit -am "feat(server): wire studio generation adapter into studio service"
```

---

### Task 5: Web catalog 驱动模型选择器 + defaults

**Files:**
- Create: `apps/web/src/constants/studioModels.ts`
- Modify: `apps/web/src/components/canvas/UniversalModelSelector.vue`
- Modify: `apps/web/src/composables/useModelProviderSettings.ts`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/TextDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/PromptDockPanel.vue`（文本目录）

- [ ] **Step 1: `studioModels.ts`**

```ts
export {
  listModels,
  defaultModelKey,
  resolveModelKey,
  getModelEntry,
  type StudioModality,
  type StudioModelEntry,
} from '@lnkpi/shared'

export function modelsAsSelectorOptions(modality: StudioModality) {
  return listModels(modality).map((m) => ({ id: m.modelKey, name: m.displayName, provider: 'catalog' }))
}
```

- [ ] **Step 2: UniversalModelSelector**

优先使用 catalog：

```ts
import { modelsAsSelectorOptions } from '@/constants/studioModels'
const models = computed(() => modelsAsSelectorOptions(props.type as StudioModality))
```

可移除对 `useCapabilities` 的依赖（设置页若仍用 capabilities，保持不动）。为 audio 扩展 `type`：若 `GenerationType` 无 audio，增加 prop `modality?: StudioModality` 或让 Audio 用独立选择器复用同一列表函数。

- [ ] **Step 3: defaults**

`useModelProviderSettings` defaults.model 改为 `defaultModelKey(...)`。

各 DockPanel `ref(getConfig(...).model)` 同步；非法旧值在 syncFromNode 时 `resolveModelKey` 纠正。

- [ ] **Step 4: vue-tsc / 页面冒烟 + Commit**

```bash
git commit -am "feat(web): drive dock model selectors from studio catalog"
```

---

### Task 6: Audio Dock — 模型选择 + 随模型音色 + 参数单卡

**Files:**
- Modify: `apps/web/src/constants/dockAudio.ts`
- Modify: `apps/web/src/components/canvas/VoiceModelSelector.vue`
- Modify: `apps/web/src/components/canvas/AudioVoiceSettingsSelector.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/AudioDockPanel.vue`
- Modify: `apps/web/src/services/studio-api.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`

- [ ] **Step 1: 扩展 `AudioVoiceSettings`**

```ts
export interface AudioVoiceSettings {
  emotion: AudioEmotion
  language: AudioLanguage
  speed: number
  volume: number
  pitch: number
}
export const DEFAULT_AUDIO_VOLUME = 1
export const DEFAULT_AUDIO_PITCH = 0
```

UI：同一弹层/卡片内展示 emotion、language、speed、volume、pitch（volume/pitch 用 +/- 或 slider，范围 volume 0.1–2 先做保守 UI，pitch -12..12；具体 clamp 与 catalog 注释一致）。

- [ ] **Step 2: VoiceModelSelector**

```ts
voices?: StudioVoiceOption[]  // prop，默认 getModelEntry(audioModel)?.voices
```

- [ ] **Step 3: AudioDockPanel**

- 增加模型选择（UniversalModelSelector 或专用，options=`listModels('audio')`）
- `watch(audioModel)`：若当前 voice 不在新模型 voices 内，重置为 voices[0]
- `onGenerate` / patch 写入 `audioModel`, `audioVolume`, `audioPitch` 等

- [ ] **Step 4: studio-api + useNodeGeneration**

```ts
generateAudio(text, { voice, emotion, language, speed, volume, pitch, model }, refs, mentionedKeys)
```

```ts
await studioApi.generateAudio(local, {
  model: String(data.audioModel ?? defaultModelKey('audio')),
  voice: ...,
  emotion: ...,
  language: ...,
  speed: ...,
  volume: typeof data.audioVolume === 'number' ? data.audioVolume : 1,
  pitch: typeof data.audioPitch === 'number' ? data.audioPitch : 0,
}, refs, mentionedKeys)
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): audio dock model selector and voice params card"
```

---

### Task 7: 参考图持久化 + 生成前 blob 拦截

**Files:**
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- 复用: `apps/web/src/composables/useMediaUpload.ts`（`persistMediaUrl` / `fileToPersistedPayload`）

- [ ] **Step 1: 替换 `URL.createObjectURL` 上传路径**

`onRefFileChange`：先 persist，再写入 `referenceImageUrl` / localRefs；失败 toast/提示。

- [ ] **Step 2: `generateForNode` 护栏**

若 `refs` 或 `referenceImageUrl` 含 `blob:`，`patchNodeData` error 并 return。

- [ ] **Step 3: Commit**

```bash
git commit -am "fix(web): persist dock reference uploads and block blob URLs"
```

---

### Task 8: 回归验证与规格附录状态

**Files:**
- Modify（可选）: `docs/superpowers/specs/2026-07-19-dock-studio-model-adapter-design.md` 状态栏 → 实现中/完成
- 不改附录 gateway 实测除非真测了

- [ ] **Step 1: 自动化**

```bash
pnpm --filter @lnkpi/agent test
pnpm --filter @lnkpi/shared exec vitest run src/studioModelCatalog.test.ts  # 或等价
pnpm build
```

Expected: all green

- [ ] **Step 2: 手工清单（写进 PR body）**

- [ ] Text/Image/Video/Audio 切换目录内模型可发起生成  
- [ ] Audio 参数卡默认值；换模型音色列表变  
- [ ] Image model 出现在服务端 metadata.gatewayModelId  
- [ ] Video 带参考图时 metadata.refImageMode=primary_image  
- [ ] 上传参考图非 blob  
- [ ] 确认未把 shot/composer 纳入本 PR 验收  

- [ ] **Step 3: Commit（若有文档状态更新）+ 开 PR**

---

## Spec coverage checklist

| 规格要求 | Task |
|----------|------|
| 模型目录四模态 | T1, T5 |
| 只选模型 | T5, T6 |
| 适配层 + 能力表 | T1, T2 |
| Audio 参数卡 + 模型 + 随模型音色 | T6 |
| Audio native/prefix | T2, T3, T4 |
| Image modelId + size + n | T2, T3, T4 |
| Video options.image | T2, T3, T4 |
| 多图 meta / 降级可观测 | T2, T4 |
| blob 持久化 | T7 |
| 网关追踪附录 | T8（不阻塞） |
| 不含 C2/C3/C4 | Global Constraints |

## Self-review notes

- 无 TBD 步骤；接口名在 Task 1–2 已固定，后续任务引用一致。  
- `UniversalModelSelector` 与 audio 的 GenerationType 缺口在 Task 5 用 `modality` 或专用入口解决。  
- Happyhose / gateway id 仅 catalog 字段，不在代码写死业务分支。  
