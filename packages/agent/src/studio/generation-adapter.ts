import { resolveModelKey, type StudioModelEntry } from '@lnkpi/shared'

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

function usesNativeImageRefs(
  requestedModelKey: string | undefined,
  resolvedKey: string,
  catalogFallback: boolean,
): boolean {
  if (requestedModelKey && /^agnes-image-/i.test(requestedModelKey)) return true
  if (!catalogFallback && /^agnes-image-/i.test(resolvedKey)) return true
  return false
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

export function buildEffectiveImagePrompt(
  mergedText: string,
  built: Pick<
    ReturnType<typeof buildImageProviderOptions>,
    'referenceImages' | 'effectivePromptSuffix' | 'meta'
  >,
): string {
  if (built.meta.refImageMode === 'native' && built.referenceImages.length > 0) {
    return mergedText.trim()
  }
  const primaryRef = built.referenceImages[0]
  const base = primaryRef ? appendRefImageTag(mergedText, primaryRef) : mergedText.trim()
  return [base, built.effectivePromptSuffix].filter(Boolean).join('\n')
}

export function providerReferenceImages(
  built: Pick<ReturnType<typeof buildImageProviderOptions>, 'referenceImages' | 'meta'>,
): string[] | undefined {
  if (built.meta.refImageMode === 'native' && built.referenceImages.length > 0) {
    return built.referenceImages
  }
  return undefined
}

export function buildImageProviderOptions(input: {
  modelKey?: string
  size: string
  n: number
  referenceImages: string[]
}): {
  modelId: string
  size: string
  n: number
  referenceImages: string[]
  effectivePromptSuffix?: string
  meta: AdapterMeta
} {
  const { modelKey, size, n, referenceImages } = input
  const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('image', modelKey)

  const refCount = referenceImages.length
  const result: {
    modelId: string
    size: string
    n: number
    referenceImages: string[]
    effectivePromptSuffix?: string
  } = {
    modelId: entry.gatewayModelId,
    size,
    n,
    referenceImages: [],
  }

  let refImageMode: AdapterMeta['refImageMode'] = 'none'
  const nativeParams: Record<string, unknown> = { model: entry.gatewayModelId, size, n }

  if (refCount > 0 && usesNativeImageRefs(modelKey, resolvedKey, fallback)) {
    result.referenceImages = [...referenceImages]
    refImageMode = 'native'
    nativeParams.image = [...referenceImages]
  } else if (refCount === 1) {
    result.referenceImages = [referenceImages[0]]
    refImageMode = 'primary_image'
  } else if (refCount > 1) {
    result.referenceImages = [referenceImages[0]]
    result.effectivePromptSuffix = referenceImages
      .slice(1)
      .map((url) => `[ref-image:${url}]`)
      .join(' ')
    refImageMode = 'primary_image'
  }

  return {
    ...result,
    meta: {
      modelKey: resolvedKey,
      gatewayModelId: entry.gatewayModelId,
      nativeParams,
      droppedFields: [],
      refImageMode: refImageMode ?? 'none',
      referenceImageCount: refCount,
      ...(fallback ? { modelFallback: true } : {}),
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
