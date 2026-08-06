import type { ImageResolutionTier } from './imageParams'

export type ImageRefWire = 'none' | 'agnes_extra_body' | 'apimart_image_urls' | 'legacy_prompt_tags'
export type ImageSizeWire = 'pixel' | 'ratio_resolution'
export type ImageResponseMode = 'sync_url' | 'async_task'
export type ImageResolutionCase = 'lower' | 'upper'

export interface ImageModelProfile {
  refWire: ImageRefWire
  sizeWire: ImageSizeWire
  responseMode: ImageResponseMode
  gatewayModelId: string
  maxRefs: number
  maxN: number
  allowedResolutions: ImageResolutionTier[]
  resolutionCase: ImageResolutionCase
  defaultQuality?: string
  pollIntervalMs: number
  maxPollMs: number
}

const SEEDREAM_GATEWAY = 'doubao-seedream-5-0-pro'
const GPT_IMAGE2_GATEWAY = 'gpt-image-2-official'

const RATIO_RESOLUTIONS: ImageResolutionTier[] = ['1K', '2K', '4K']
const SEEDREAM_RESOLUTIONS: ImageResolutionTier[] = ['1K', '2K']

const APIMART_PROFILE_BASE = {
  refWire: 'apimart_image_urls' as const,
  sizeWire: 'ratio_resolution' as const,
  responseMode: 'async_task' as const,
  pollIntervalMs: 8_000,
}

const AGNES_PROFILE: Omit<ImageModelProfile, 'gatewayModelId'> = {
  refWire: 'agnes_extra_body',
  sizeWire: 'pixel',
  responseMode: 'sync_url',
  maxRefs: 16,
  maxN: 4,
  allowedResolutions: RATIO_RESOLUTIONS,
  resolutionCase: 'lower',
  pollIntervalMs: 0,
  maxPollMs: 0,
}

const LEGACY_PROFILE: Omit<ImageModelProfile, 'gatewayModelId'> = {
  refWire: 'legacy_prompt_tags',
  sizeWire: 'pixel',
  responseMode: 'sync_url',
  maxRefs: 16,
  maxN: 4,
  allowedResolutions: RATIO_RESOLUTIONS,
  resolutionCase: 'lower',
  pollIntervalMs: 0,
  maxPollMs: 0,
}

function isAgnesImageModel(modelKey: string, gatewayModelId: string): boolean {
  return /^agnes-image-/i.test(modelKey) || /^agnes-image-/i.test(gatewayModelId)
}

function isSeedreamModel(modelKey: string, gatewayModelId: string): boolean {
  return (
    /^seedream-5\.0-pro$/i.test(modelKey) ||
    /^doubao-seedream-5-0-pro$/i.test(gatewayModelId) ||
    /^doubao-seedream-/i.test(gatewayModelId)
  )
}

function isGptImage2Model(modelKey: string, gatewayModelId: string): boolean {
  return (
    modelKey === 'image2' ||
    /^gpt-image-2/i.test(modelKey) ||
    /^gpt-image-2/i.test(gatewayModelId)
  )
}

/** Catalog keys and upstream gateway ids that must hit APIMart (not Agnes). */
export function isApimartBackedImageModel(
  modelKey: string,
  gatewayModelId?: string,
): boolean {
  const gw = gatewayModelId ?? modelKey
  return isSeedreamModel(modelKey, gw) || isGptImage2Model(modelKey, gw)
}

/** Resolve upstream gateway model id for APIMart-backed catalog entries. */
export function resolveImageGatewayModelId(modelKey: string, gatewayModelId: string): string {
  if (isSeedreamModel(modelKey, gatewayModelId)) return SEEDREAM_GATEWAY
  if (isGptImage2Model(modelKey, gatewayModelId)) return GPT_IMAGE2_GATEWAY
  return gatewayModelId
}

export function resolveImageModelProfile(
  modelKey: string,
  gatewayModelId: string,
): ImageModelProfile {
  const resolvedGateway = resolveImageGatewayModelId(modelKey, gatewayModelId)

  if (isAgnesImageModel(modelKey, gatewayModelId)) {
    return { ...AGNES_PROFILE, gatewayModelId: resolvedGateway }
  }

  if (isSeedreamModel(modelKey, gatewayModelId)) {
    return {
      ...APIMART_PROFILE_BASE,
      gatewayModelId: resolvedGateway,
      maxRefs: 10,
      maxN: 1,
      allowedResolutions: SEEDREAM_RESOLUTIONS,
      resolutionCase: 'upper',
      maxPollMs: 300_000,
    }
  }

  if (isGptImage2Model(modelKey, gatewayModelId)) {
    return {
      ...APIMART_PROFILE_BASE,
      gatewayModelId: resolvedGateway,
      maxRefs: 16,
      maxN: 4,
      allowedResolutions: RATIO_RESOLUTIONS,
      resolutionCase: 'lower',
      defaultQuality: 'high',
      maxPollMs: 360_000,
    }
  }

  return { ...LEGACY_PROFILE, gatewayModelId: resolvedGateway }
}

export interface ClampedImageGenerationInput {
  n: number
  resolution: ImageResolutionTier
  referenceImages: string[]
  droppedFields: Array<{ field: string; reason: string }>
}

export function clampImageGenerationInput(
  profile: ImageModelProfile,
  input: {
    n: number
    resolution: ImageResolutionTier
    referenceImages: string[]
  },
): ClampedImageGenerationInput {
  const droppedFields: ClampedImageGenerationInput['droppedFields'] = []
  let n = Math.max(1, input.n)
  if (n > profile.maxN) {
    droppedFields.push({
      field: 'n',
      reason: `${profile.gatewayModelId} supports at most n=${profile.maxN}, clamped from ${input.n}`,
    })
    n = profile.maxN
  }

  let resolution = input.resolution
  if (!profile.allowedResolutions.includes(resolution)) {
    const fallback = profile.allowedResolutions[profile.allowedResolutions.length - 1]
    droppedFields.push({
      field: 'resolution',
      reason: `${profile.gatewayModelId} does not support ${resolution}, using ${fallback}`,
    })
    resolution = fallback
  }

  let referenceImages = [...input.referenceImages]
  if (referenceImages.length > profile.maxRefs) {
    droppedFields.push({
      field: 'referenceImages',
      reason: `${profile.gatewayModelId} supports at most ${profile.maxRefs} refs, truncated from ${referenceImages.length}`,
    })
    referenceImages = referenceImages.slice(0, profile.maxRefs)
  }

  return { n, resolution, referenceImages, droppedFields }
}

export function formatImageResolutionForProvider(
  profile: ImageModelProfile,
  resolution: ImageResolutionTier,
): string {
  return profile.resolutionCase === 'upper' ? resolution : resolution.toLowerCase()
}

export function isAsyncImageProfile(profile: Pick<ImageModelProfile, 'responseMode'>): boolean {
  return profile.responseMode === 'async_task'
}

export function usesNativeImageRefs(profile: Pick<ImageModelProfile, 'refWire'>): boolean {
  return profile.refWire === 'agnes_extra_body' || profile.refWire === 'apimart_image_urls'
}
