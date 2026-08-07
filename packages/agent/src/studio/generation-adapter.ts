import {
  clampImageGenerationInput,
  formatImageResolutionForProvider,
  resolveImageGatewayModelId,
  resolveImageModelProfile,
  usesNativeImageRefs,
  isApimartBackedImageModel,
  SUPPORTED_ASPECT_RATIOS,
  type ImageRefWire,
  type ImageResolutionTier,
  type ImageResponseMode,
  resolveModelKey,
  resolveImageSize,
  type StudioModelEntry,
} from '@lnkpi/shared'

export interface AdapterMeta {
  modelKey: string
  gatewayModelId: string
  nativeParams: Record<string, unknown>
  promptPrefixApplied?: string
  droppedFields: Array<{ field: string; reason: string }>
  refImageMode?: 'native' | 'primary_image' | 'prompt_url_tags' | 'none'
  referenceImageCount?: number
  responseMode?: ImageResponseMode
  refWire?: ImageRefWire
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
    refWire: built.meta.refWire,
    responseMode: built.meta.responseMode,
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

export function buildVideoProviderOptions(input: {
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
} {
  const { modelKey, duration, aspectRatio, resolution, crop, referenceImages } = input
  const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('video', modelKey)

  const droppedFields: AdapterMeta['droppedFields'] = []
  const nativeParams: Record<string, unknown> = { model: entry.gatewayModelId }

  const result: {
    model: string
    duration?: number
    aspectRatio?: string
    resolution?: string
    crop?: string
    image?: string
    effectivePromptSuffix?: string
  } = { model: entry.gatewayModelId }

  const scalarParams: Record<string, string | number | undefined> = {
    duration,
    aspectRatio,
    resolution,
    crop,
  }

  for (const [field, value] of Object.entries(scalarParams)) {
    if (value === undefined) continue
    const disposition = entry.params[field] ?? 'metadataOnly'

    if (disposition === 'native') {
      ;(result as Record<string, unknown>)[field] = value
      nativeParams[field] = value
    } else if (disposition === 'metadataOnly') {
      droppedFields.push({
        field,
        reason: `${field} not supported natively by ${entry.modelKey}`,
      })
    } else {
      droppedFields.push({
        field,
        reason: `${field} configured as promptPrefix but not applied for video scalars`,
      })
    }
  }

  const refCount = referenceImages.length
  if (refCount > 0) {
    result.image = referenceImages[0]
    nativeParams.image = referenceImages[0]
  }

  if (refCount > 1) {
    result.effectivePromptSuffix = referenceImages
      .slice(1)
      .map((url) => `[ref-image:${url}]`)
      .join(' ')
  }

  const refImageMode = refCount > 0 ? 'primary_image' : 'none'

  return {
    ...result,
    meta: {
      modelKey: resolvedKey,
      gatewayModelId: entry.gatewayModelId,
      nativeParams,
      droppedFields,
      refImageMode,
      referenceImageCount: refCount,
      ...(fallback ? { modelFallback: true } : {}),
    },
  }
}
