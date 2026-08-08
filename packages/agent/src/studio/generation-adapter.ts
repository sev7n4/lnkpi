import {
  clampImageGenerationInput,
  clampVideoGenerationInput,
  formatImageResolutionForProvider,
  resolveImageGatewayModelId,
  resolveImageModelProfile,
  resolveVideoModelProfile,
  usesNativeImageRefs,
  isApimartBackedImageModel,
  SUPPORTED_ASPECT_RATIOS,
  type ImageRefWire,
  type ImageResolutionTier,
  type ImageResponseMode,
  type VideoRefWire,
  type VideoResponseMode,
  resolveModelKey,
  resolveImageSize,
  type StudioModelEntry,
  isSeedance1x,
} from '@lnkpi/shared'
import {
  buildVideoReferenceBundle,
  inferVideoScenario,
  type VideoMode,
  type VideoReferenceBundle,
  type VideoScenario,
} from './video-refs'

export interface AdapterMeta {
  modelKey: string
  gatewayModelId: string
  nativeParams: Record<string, unknown>
  promptPrefixApplied?: string
  droppedFields: Array<{ field: string; reason: string }>
  refImageMode?: 'native' | 'primary_image' | 'prompt_url_tags' | 'none'
  referenceImageCount?: number
  responseMode?: ImageResponseMode | VideoResponseMode
  refWire?: ImageRefWire | VideoRefWire
  scenario?: VideoScenario
  refVideoMode?: 'native' | 'metadata_only' | 'none'
  refAudioMode?: 'native' | 'metadata_only' | 'none'
  referenceVideoCount?: number
  referenceAudioCount?: number
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

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日语',
  ko: '韩语',
}

function resolveVoice(
  entry: StudioModelEntry,
  voice?: string,
): { voice?: string; droppedFields: AdapterMeta['droppedFields'] } {
  const defaultVoice =
    (entry.defaults?.voice as string | undefined) ?? entry.voices?.[0]?.id

  if (!voice) {
    return { voice: defaultVoice, droppedFields: [] }
  }

  const valid = entry.voices?.some((v) => v.id === voice)
  if (valid) {
    return { voice, droppedFields: [] }
  }

  return {
    voice: defaultVoice,
    droppedFields: [
      {
        field: 'voice',
        reason: `invalid voice "${voice}", replaced with "${defaultVoice}"`,
      },
    ],
  }
}

function buildPromptPrefix(
  entry: StudioModelEntry,
  fields: Record<string, string | number | undefined>,
): string | undefined {
  const parts: string[] = []

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === '') continue
    const disposition = entry.params[field] ?? 'metadataOnly'
    if (disposition !== 'promptPrefix') continue

    if (field === 'language') {
      parts.push(`语言=${LANGUAGE_LABELS[String(value)] ?? value}`)
    } else if (field === 'emotion') {
      parts.push(`情绪=${value}`)
    } else {
      parts.push(`${field}=${value}`)
    }
  }

  if (parts.length === 0) return undefined
  return `【朗读设定】${parts.join('；')}\n`
}

export function buildAudioRequest(input: {
  mergedText: string
  modelKey?: string
  voice?: string
  emotion?: string
  language?: string
  speed?: number
  volume?: number
  pitch?: number
}): BuiltAudioRequest {
  const { mergedText, modelKey, voice, emotion, language, speed, volume, pitch } = input
  const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('audio', modelKey)

  const droppedFields: AdapterMeta['droppedFields'] = []
  const nativeParams: Record<string, unknown> = {}
  const options: BuiltAudioRequest['options'] = { model: entry.gatewayModelId }
  nativeParams.model = entry.gatewayModelId

  const voiceResult = resolveVoice(entry, voice)
  if (voiceResult.voice) {
    options.voice = voiceResult.voice
    nativeParams.voice = voiceResult.voice
  }
  droppedFields.push(...voiceResult.droppedFields)

  const paramValues: Record<string, string | number | undefined> = {
    speed,
    volume,
    pitch,
    emotion,
  }

  for (const [field, value] of Object.entries(paramValues)) {
    if (value === undefined) continue
    const disposition = entry.params[field] ?? 'metadataOnly'

    if (disposition === 'native') {
      ;(options as Record<string, unknown>)[field] = value
      nativeParams[field] = value
    } else if (disposition === 'metadataOnly') {
      droppedFields.push({
        field,
        reason: `${field} not supported natively by ${entry.modelKey}`,
      })
    }
  }

  const promptPrefixApplied = buildPromptPrefix(entry, { emotion, language })
  const text = promptPrefixApplied ? `${promptPrefixApplied}${mergedText}` : mergedText

  return {
    text,
    options,
    meta: {
      modelKey: resolvedKey,
      gatewayModelId: entry.gatewayModelId,
      nativeParams,
      promptPrefixApplied,
      droppedFields,
      ...(fallback ? { modelFallback: true } : {}),
    },
  }
}

function normalizeAspectRatio(aspectRatio?: string): string {
  const ratio = aspectRatio?.trim() || '16:9'
  return SUPPORTED_ASPECT_RATIOS.has(ratio) ? ratio : '16:9'
}

function appendRefImageTag(prompt: string, refImageUrl: string): string {
  const trimmed = prompt.trim()
  const ref = refImageUrl.trim()
  if (!ref) return trimmed
  return `${trimmed} [ref-image:${ref}]`
}

/** Remove legacy prompt URL tags before native img2img provider calls (e.g. platform fallback). */
export function stripRefImagePromptTags(prompt: string): string {
  return prompt.replace(/\s*\[ref-image:[^\]]+\]/g, '').trim()
}

export interface ImageRefDescriptor {
  refKey: string
  label: string
}

export function imageRefDescriptorsFromRefs(
  refs: Array<{ refKey: string; label?: string; mediaType: string; url?: string }> | undefined,
): ImageRefDescriptor[] {
  return (refs ?? [])
    .filter((r) => r.mediaType === 'image' && r.url?.trim())
    .map((r) => ({ refKey: r.refKey, label: r.label?.trim() || r.refKey }))
}

const ORDINAL_ZH = ['第一张', '第二张', '第三张', '第四张', '第五张', '第六张']

function formatImageRefName(ref: ImageRefDescriptor): string {
  return ref.label !== ref.refKey ? `${ref.refKey}（${ref.label}）` : ref.refKey
}

/** Deterministic preserve/consistency instructions appended when image refs are present. */
export function buildImageRefConsistencyBlock(imageRefs: ImageRefDescriptor[]): string {
  if (imageRefs.length === 0) return ''

  if (imageRefs.length === 1) {
    const name = formatImageRefName(imageRefs[0])
    return (
      `【参考图一致性】以参考图 ${name} 为主参考，严格保留其主体形态、关键细节与构图布局；` +
      '仅按上方提示词要求调整背景、风格或局部元素，不要改变主体品类、识别特征与核心结构。'
    )
  }

  const roleLines = imageRefs
    .map((ref, i) => {
      const ord = ORDINAL_ZH[i] ?? `第${i + 1}张`
      const name = formatImageRefName(ref)
      if (i === 0) {
        return `- ${ord}参考图 ${name}：主参考，严格保留主体形态、关键细节与构图`
      }
      return `- ${ord}参考图 ${name}：辅助参考，按提示词融合其风格/元素，但不覆盖主参考的主体识别`
    })
    .join('\n')

  return (
    `【参考图一致性】\n${roleLines}\n` +
    '生成结果须与各参考图在主体身份、关键特征上保持一致；仅允许按提示词调整背景、风格或局部元素。'
  )
}

export function buildEffectiveImagePrompt(
  mergedText: string,
  built: Pick<
    ReturnType<typeof buildImageProviderOptions>,
    'referenceImages' | 'effectivePromptSuffix' | 'meta'
  >,
  imageRefs?: ImageRefDescriptor[],
): string {
  let base: string
  if (built.meta.refImageMode === 'native' && built.referenceImages.length > 0) {
    base = mergedText.trim()
  } else {
    const primaryRef = built.referenceImages[0]
    base = primaryRef ? appendRefImageTag(mergedText, primaryRef) : mergedText.trim()
    base = [base, built.effectivePromptSuffix].filter(Boolean).join('\n')
  }

  const refs =
    imageRefs ??
    built.referenceImages.map((_, i) => ({
      refKey: `I${i + 1}`,
      label: `I${i + 1}`,
    }))
  const consistency = buildImageRefConsistencyBlock(refs)
  if (!consistency) return base
  return `${base}\n\n${consistency}`
}

export function providerReferenceImages(
  built: Pick<ReturnType<typeof buildImageProviderOptions>, 'referenceImages' | 'meta'>,
): string[] | undefined {
  if (built.meta.refImageMode === 'native' && built.referenceImages.length > 0) {
    return built.referenceImages
  }
  return undefined
}

export interface ImageProviderGenerateOptions {
  modelId?: string
  size?: string
  resolution?: string
  n?: number
  quality?: string
  referenceImages?: string[]
  refWire?: ImageRefWire
  responseMode?: ImageResponseMode
  pollIntervalMs?: number
  maxPollMs?: number
}

export function buildImageProviderGenerateOptions(
  built: ReturnType<typeof buildImageProviderOptions>,
): ImageProviderGenerateOptions {
  const profileResolution =
    typeof built.meta.nativeParams.resolution === 'string'
      ? built.meta.nativeParams.resolution
      : undefined
  return {
    modelId: built.modelId,
    size: built.size,
    resolution: profileResolution,
    n: built.n,
    quality:
      typeof built.meta.nativeParams.quality === 'string'
        ? built.meta.nativeParams.quality
        : undefined,
    referenceImages: providerReferenceImages(built),
    refWire: built.meta.refWire as ImageRefWire | undefined,
    responseMode: built.meta.responseMode as ImageResponseMode | undefined,
    pollIntervalMs:
      typeof built.meta.nativeParams.pollIntervalMs === 'number'
        ? built.meta.nativeParams.pollIntervalMs
        : undefined,
    maxPollMs:
      typeof built.meta.nativeParams.maxPollMs === 'number'
        ? built.meta.nativeParams.maxPollMs
        : undefined,
  }
}

export function buildImageProviderOptions(input: {
  modelKey?: string
  aspectRatio?: string
  resolution?: ImageResolutionTier
  pixelSize?: string
  n: number
  referenceImages: string[]
  /** BYOK: keep upstream gateway id; never fall back to platform catalog default. */
  byok?: boolean
  channelBaseUrl?: string
}): {
  modelId: string
  size: string
  n: number
  referenceImages: string[]
  effectivePromptSuffix?: string
  meta: AdapterMeta
} {
  const {
    modelKey,
    aspectRatio = '16:9',
    resolution = '1K',
    pixelSize,
    n,
    referenceImages,
    byok = false,
    channelBaseUrl,
  } = input
  const catalog = resolveModelKey('image', modelKey)
  let resolvedKey = catalog.modelKey
  let catalogGateway = catalog.entry.gatewayModelId
  let catalogFallback = catalog.fallback
  if (modelKey && isApimartBackedImageModel(modelKey)) {
    resolvedKey = modelKey
    catalogGateway = resolveImageGatewayModelId(modelKey, modelKey)
    catalogFallback = false
  } else if (modelKey && byok && catalog.fallback) {
    resolvedKey = modelKey
    catalogGateway = modelKey
    catalogFallback = false
  }
  const profile = resolveImageModelProfile(resolvedKey, catalogGateway, { channelBaseUrl })
  const gatewayModelId = resolveImageGatewayModelId(resolvedKey, catalogGateway)
  const clamped = clampImageGenerationInput(profile, {
    n,
    resolution,
    referenceImages,
  })

  const refCount = clamped.referenceImages.length
  const result: {
    modelId: string
    size: string
    n: number
    referenceImages: string[]
    effectivePromptSuffix?: string
  } = {
    modelId: gatewayModelId,
    size: pixelSize ?? resolveImageSize(aspectRatio, resolution),
    n: clamped.n,
    referenceImages: [],
  }

  let refImageMode: AdapterMeta['refImageMode'] = 'none'
  const nativeParams: Record<string, unknown> = {
    model: gatewayModelId,
    n: clamped.n,
    pollIntervalMs: profile.pollIntervalMs,
    maxPollMs: profile.maxPollMs,
  }
  const droppedFields: AdapterMeta['droppedFields'] = [...clamped.droppedFields]

  if (profile.sizeWire === 'ratio_resolution') {
    result.size = normalizeAspectRatio(aspectRatio)
    nativeParams.size = result.size
    nativeParams.resolution = formatImageResolutionForProvider(profile, clamped.resolution)
  } else {
    result.size = pixelSize ?? resolveImageSize(aspectRatio, clamped.resolution)
    nativeParams.size = result.size
  }

  if (profile.defaultQuality) {
    nativeParams.quality = profile.defaultQuality
  }

  if (refCount > 0 && usesNativeImageRefs(profile)) {
    result.referenceImages = [...clamped.referenceImages]
    refImageMode = 'native'
    if (profile.refWire === 'agnes_extra_body') {
      nativeParams.image = [...clamped.referenceImages]
    } else if (profile.refWire === 'apimart_image_urls') {
      nativeParams.image_urls = [...clamped.referenceImages]
    }
  } else if (refCount === 1) {
    result.referenceImages = [clamped.referenceImages[0]]
    refImageMode = 'primary_image'
  } else if (refCount > 1) {
    result.referenceImages = [clamped.referenceImages[0]]
    result.effectivePromptSuffix = clamped.referenceImages
      .slice(1)
      .map((url) => `[ref-image:${url}]`)
      .join(' ')
    refImageMode = 'primary_image'
  }

  return {
    ...result,
    meta: {
      modelKey: resolvedKey,
      gatewayModelId,
      nativeParams,
      droppedFields,
      refImageMode: refImageMode ?? 'none',
      referenceImageCount: refCount,
      responseMode: profile.responseMode,
      refWire: refCount > 0 ? profile.refWire : 'none',
      ...(catalogFallback ? { modelFallback: true } : {}),
    },
  }
}

const SEEDANCE_IMAGE_TAG_RE = /@(?:Image|图片)(\d+)\b/g
const SEEDANCE_VIDEO_TAG_RE = /@Video(\d+)\b/g
const SEEDANCE_AUDIO_TAG_RE = /@Audio(\d+)\b/g

function stripSeedanceRefTags(prompt: string): string {
  return prompt
    .replace(SEEDANCE_IMAGE_TAG_RE, '')
    .replace(SEEDANCE_VIDEO_TAG_RE, '')
    .replace(SEEDANCE_AUDIO_TAG_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function hasSeedanceImageTag(prompt: string, index: number): boolean {
  return new RegExp(`@(?:Image|图片)${index}\\b`).test(prompt)
}

function hasSeedanceVideoTag(prompt: string, index: number): boolean {
  return new RegExp(`@Video${index}\\b`).test(prompt)
}

function hasSeedanceAudioTag(prompt: string, index: number): boolean {
  return new RegExp(`@Audio${index}\\b`).test(prompt)
}

function stripOutOfRangeSeedanceTags(
  prompt: string,
  bundle: VideoReferenceBundle,
): string {
  let out = prompt.replace(SEEDANCE_IMAGE_TAG_RE, (match, numStr) => {
    const num = Number.parseInt(numStr, 10)
    return num >= 1 && num <= bundle.images.length ? match : ''
  })
  out = out.replace(SEEDANCE_VIDEO_TAG_RE, (match, numStr) => {
    const num = Number.parseInt(numStr, 10)
    return num >= 1 && num <= bundle.videos.length ? match : ''
  })
  out = out.replace(SEEDANCE_AUDIO_TAG_RE, (match, numStr) => {
    const num = Number.parseInt(numStr, 10)
    return num >= 1 && num <= bundle.audios.length ? match : ''
  })
  return out.replace(/\s{2,}/g, ' ')
}

export function ensureSeedanceRefTags(
  prompt: string,
  bundle: VideoReferenceBundle,
): string {
  let out = stripOutOfRangeSeedanceTags(prompt, bundle)
  bundle.images.forEach((_, i) => {
    const tag = `@Image${i + 1}`
    if (!hasSeedanceImageTag(out, i + 1)) out += ` ${tag}`
  })
  bundle.videos.forEach((_, i) => {
    const tag = `@Video${i + 1}`
    if (!hasSeedanceVideoTag(out, i + 1)) out += ` ${tag}`
  })
  bundle.audios.forEach((_, i) => {
    const tag = `@Audio${i + 1}`
    if (!hasSeedanceAudioTag(out, i + 1)) out += ` ${tag}`
  })
  return out.replace(/\s{2,}/g, ' ').trim()
}

export function buildVideoRefConsistencyBlock(bundle: VideoReferenceBundle): string {
  if (bundle.images.length === 0) return ''
  if (bundle.images.length === 1) {
    const ref = bundle.images[0]
    return (
      `【参考图一致性】以 @Image1 / 参考图 ${ref.refKey}（${ref.label}）为主，` +
      '严格保留主体外形、关键细节与构图。'
    )
  }

  const roles = bundle.images
    .map((ref, index) =>
      index === 0
        ? `- @Image1 / ${ref.refKey}（${ref.label}）：主参考，保持主体身份与关键特征`
        : `- @Image${index + 1} / ${ref.refKey}（${ref.label}）：辅助参考，融合场景、服装或风格`,
    )
    .join('\n')
  return `【参考图一致性】\n${roles}\n保持 @Image1 的主体身份一致，不得被辅助参考覆盖。`
}

function buildFirstLastFrameConsistencyBlock(bundle: VideoReferenceBundle): string {
  const [first, last] = bundle.images
  if (!first || !last) return ''
  return (
    `【首尾帧约束】首帧参考 ${first.refKey}（${first.label}），` +
    `末帧参考 ${last.refKey}（${last.label}）；在两帧间自然过渡并保持构图连续。`
  )
}

export interface VideoProviderGenerateOptions {
  model?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  image?: string
  generateAudio?: boolean
  referenceImages?: string[]
  referenceVideos?: string[]
  referenceAudios?: string[]
  imageWithRoles?: Array<{ url: string; role: string }>
  returnLastFrame?: boolean
  pollIntervalMs?: number
  maxPollMs?: number
}

export interface BuiltVideoProviderOptions {
  model: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  image?: string
  effectivePromptSuffix?: string
  effectiveReferenceBundle: VideoReferenceBundle
  providerOptions: VideoProviderGenerateOptions
  meta: AdapterMeta
}

export class Seedance1xUnsupportedError extends Error {
  constructor(gatewayModelId: string) {
    super(`不支持 Seedance 1.x 视频模型（${gatewayModelId}），请改用 Seedance 2.0`)
    this.name = 'Seedance1xUnsupportedError'
  }
}

export function buildEffectiveVideoPrompt(
  mergedText: string,
  built: Pick<
    BuiltVideoProviderOptions,
    'effectivePromptSuffix' | 'effectiveReferenceBundle' | 'meta'
  >,
): string {
  const bundle = built.effectiveReferenceBundle
  let prompt = [mergedText.trim(), built.effectivePromptSuffix].filter(Boolean).join('\n')
  if (built.meta.refWire === 'apimart_first_last') {
    prompt = stripSeedanceRefTags(prompt)
  } else if (built.meta.refWire === 'apimart_multimodal') {
    prompt = ensureSeedanceRefTags(prompt, bundle)
  }
  const consistency =
    built.meta.refWire === 'apimart_first_last'
      ? buildFirstLastFrameConsistencyBlock(bundle)
      : buildVideoRefConsistencyBlock(bundle)
  return consistency ? `${prompt}\n\n${consistency}` : prompt
}

export function buildVideoProviderGenerateOptions(
  built: BuiltVideoProviderOptions,
): VideoProviderGenerateOptions {
  return { ...built.providerOptions }
}

export function buildVideoProviderOptions(input: {
  modelKey?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  referenceBundle?: VideoReferenceBundle
  /** @deprecated Pass referenceBundle instead. */
  referenceImages?: string[]
  videoMode?: VideoMode
  scenario?: VideoScenario
  /** BYOK: upstream gateway id for profile resolution when catalog misses. */
  gatewayModelHint?: string
  channelBaseUrl?: string
  generateAudio?: boolean
}): BuiltVideoProviderOptions {
  const {
    modelKey,
    duration,
    aspectRatio,
    resolution,
    crop,
    videoMode,
    gatewayModelHint,
    channelBaseUrl,
    generateAudio,
  } = input
  if (gatewayModelHint && isSeedance1x(gatewayModelHint)) {
    throw new Seedance1xUnsupportedError(gatewayModelHint)
  }
  const catalog = resolveModelKey('video', modelKey)
  let resolvedKey = catalog.modelKey
  let catalogGateway = catalog.entry.gatewayModelId
  let catalogFallback = catalog.fallback
  if (gatewayModelHint && catalog.fallback) {
    resolvedKey = gatewayModelHint
    catalogGateway = gatewayModelHint
    catalogFallback = false
  }
  const profile = resolveVideoModelProfile(resolvedKey, catalogGateway, {
    channelBaseUrl,
  })
  const sourceBundle =
    input.referenceBundle ??
    buildVideoReferenceBundle(
      (input.referenceImages ?? []).map((url, index) => ({
        refKey: `I${index + 1}`,
        mediaType: 'image',
        url,
      })),
    )
  const clamped = clampVideoGenerationInput(profile, {
    duration,
    aspectRatio,
    resolution,
    referenceImages: sourceBundle.images.map((ref) => ref.url),
    referenceVideos: sourceBundle.videos.map((ref) => ref.url),
    referenceAudios: sourceBundle.audios.map((ref) => ref.url),
  })
  const clampedBundle: VideoReferenceBundle = {
    images: sourceBundle.images.slice(0, clamped.referenceImages.length),
    videos: sourceBundle.videos.slice(0, clamped.referenceVideos.length),
    audios: sourceBundle.audios.slice(0, clamped.referenceAudios.length),
  }
  const useFirstLast =
    profile.refWire === 'apimart_multimodal' &&
    videoMode === 'first_last_frame' &&
    clampedBundle.images.length === 2
  const bundle: VideoReferenceBundle = useFirstLast
    ? { images: clampedBundle.images, videos: [], audios: [] }
    : clampedBundle
  const scenario = input.scenario ?? inferVideoScenario(bundle, videoMode)
  const droppedFields: AdapterMeta['droppedFields'] = [...clamped.droppedFields]
  const nativeParams: Record<string, unknown> = {
    model: profile.gatewayModelId,
    duration: clamped.duration,
    resolution: clamped.resolution,
  }
  const providerOptions: VideoProviderGenerateOptions = {
    model: profile.gatewayModelId,
    duration: clamped.duration,
    aspectRatio: clamped.aspectRatio,
    resolution: clamped.resolution,
    pollIntervalMs: profile.pollIntervalMs,
    maxPollMs: profile.maxPollMs,
  }
  if (
    profile.refWire === 'apimart_multimodal' &&
    (scenario === 'S2' || scenario === 'S3' || scenario === 'S8')
  ) {
    providerOptions.returnLastFrame = true
    nativeParams.return_last_frame = true
  }
  if (crop !== undefined) {
    if (catalog.entry.params.crop === 'native') {
      providerOptions.crop = crop
      nativeParams.crop = crop
    } else {
      droppedFields.push({
        field: 'crop',
        reason: `crop not supported natively by ${catalog.entry.modelKey}`,
      })
    }
  }
  if (generateAudio !== undefined) {
    if (entry.params.generateAudio === 'native') {
      providerOptions.generateAudio = generateAudio
      nativeParams.generate_audio = generateAudio
    } else {
      droppedFields.push({
        field: 'generateAudio',
        reason: `generateAudio not supported natively by ${entry.modelKey}`,
      })
    }
  }

  if (profile.sizeWire === 'ratio_duration') {
    nativeParams.size = clamped.aspectRatio
  } else {
    nativeParams.aspectRatio = clamped.aspectRatio
  }

  const imageCount = bundle.images.length
  const videoCount = bundle.videos.length
  const audioCount = bundle.audios.length
  const hasRefs = imageCount + videoCount + audioCount > 0
  let refWire: VideoRefWire = hasRefs ? profile.refWire : 'none'
  let refImageMode: AdapterMeta['refImageMode'] = 'none'
  let refVideoMode: AdapterMeta['refVideoMode'] = 'none'
  let refAudioMode: AdapterMeta['refAudioMode'] = 'none'
  let image: string | undefined
  let effectivePromptSuffix: string | undefined

  if (profile.refWire === 'agnes_single_image') {
    if (imageCount >= 2) {
      refWire = 'agnes_keyframes'
      providerOptions.referenceImages = clamped.referenceImages
      nativeParams.image = clamped.referenceImages
      nativeParams.mode = 'keyframes'
      refImageMode = 'native'
    } else if (imageCount === 1) {
      image = clamped.referenceImages[0]
      providerOptions.image = image
      nativeParams.image = image
      refImageMode = 'native'
    }
    if (sourceBundle.videos.length) {
      refVideoMode = 'metadata_only'
      droppedFields.push({
        field: 'referenceVideos',
        reason: `referenceVideos not supported natively by ${catalog.entry.modelKey}`,
      })
    }
    if (sourceBundle.audios.length) {
      refAudioMode = 'metadata_only'
      droppedFields.push({
        field: 'referenceAudios',
        reason: `referenceAudios not supported natively by ${catalog.entry.modelKey}`,
      })
    }
  } else if (profile.refWire === 'apimart_multimodal') {
    if (useFirstLast) {
      refWire = 'apimart_first_last'
      providerOptions.imageWithRoles = [
        { url: bundle.images[0].url, role: 'first_frame' },
        { url: bundle.images[1].url, role: 'last_frame' },
      ]
      nativeParams.image_with_roles = providerOptions.imageWithRoles
      refImageMode = 'native'
      if (clampedBundle.videos.length) {
        droppedFields.push({
          field: 'referenceVideos',
          reason: 'referenceVideos omitted in first_last_frame mode',
        })
      }
      if (clampedBundle.audios.length) {
        droppedFields.push({
          field: 'referenceAudios',
          reason: 'referenceAudios omitted in first_last_frame mode',
        })
      }
      refVideoMode = clampedBundle.videos.length ? 'metadata_only' : 'none'
      refAudioMode = clampedBundle.audios.length ? 'metadata_only' : 'none'
    } else {
      if (imageCount) {
        providerOptions.referenceImages = bundle.images.map((ref) => ref.url)
        nativeParams.image_urls = providerOptions.referenceImages
        refImageMode = 'native'
      }
      if (videoCount) {
        providerOptions.referenceVideos = bundle.videos.map((ref) => ref.url)
        nativeParams.video_urls = providerOptions.referenceVideos
        refVideoMode = 'native'
      }
      if (audioCount) {
        providerOptions.referenceAudios = bundle.audios.map((ref) => ref.url)
        nativeParams.audio_urls = providerOptions.referenceAudios
        refAudioMode = 'native'
      }
    }
  } else if (imageCount) {
    image = clamped.referenceImages[0]
    providerOptions.image = image
    nativeParams.image = image
    refImageMode = 'primary_image'
    if (sourceBundle.images.length > 1) {
      effectivePromptSuffix = sourceBundle.images
        .slice(1)
        .map((ref) => `[ref-image:${ref.url}]`)
        .join(' ')
    }
  }

  return {
    model: profile.gatewayModelId,
    duration: clamped.duration,
    aspectRatio: clamped.aspectRatio,
    resolution: clamped.resolution,
    ...(providerOptions.crop ? { crop: providerOptions.crop } : {}),
    image,
    effectivePromptSuffix,
    effectiveReferenceBundle: bundle,
    providerOptions,
    meta: {
      modelKey: resolvedKey,
      gatewayModelId: profile.gatewayModelId,
      nativeParams,
      droppedFields,
      refImageMode,
      refVideoMode,
      refAudioMode,
      referenceImageCount: imageCount,
      referenceVideoCount: videoCount,
      referenceAudioCount: audioCount,
      refWire,
      responseMode: profile.responseMode,
      scenario,
      ...(catalogFallback ? { modelFallback: true } : {}),
    },
  }
}
