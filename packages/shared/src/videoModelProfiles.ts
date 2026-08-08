export type VideoRefWire =
  | 'none'
  | 'agnes_single_image'
  | 'agnes_keyframes'
  | 'apimart_multimodal'
  | 'apimart_first_last'
  | 'legacy_prompt_tags'

export type VideoSizeWire = 'pixel_frames' | 'ratio_duration'
export type VideoResponseMode = 'agnes_poll' | 'async_task'
export type VideoResolutionTier = '480p' | '720p' | '1080p' | '4k'
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

const RESOLUTION_RANK: Record<VideoResolutionTier, number> = {
  '480p': 1,
  '720p': 2,
  '1080p': 3,
  '4k': 4,
}

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
  variantTag?: SeedanceVariantTag
  maxResolution?: VideoResolutionTier
  supportsAssetUrl?: boolean
}

function isAgnesVideoModel(modelKey: string, gatewayModelId: string): boolean {
  return /^agnes-video-/i.test(modelKey) || /^agnes-video-/i.test(gatewayModelId)
}

export function isSeedance1x(gatewayModelId: string): boolean {
  return /^doubao-seedance-1[.-]/i.test(gatewayModelId)
}

/** BytePlus ModelArk ids use hyphens (2-0-260128); APIMart catalog uses dots (2.0-mini). */
function inferSeedance20VariantFromDoubaoGateway(gatewayModelId: string): SeedanceVariantTag | null {
  if (isSeedance1x(gatewayModelId)) return null
  if (!/^doubao-seedance-2[.-]0/i.test(gatewayModelId)) return null

  const lower = gatewayModelId.toLowerCase()
  const exact = Object.values(SEEDANCE_20_GATEWAYS).find((gw) => gw.toLowerCase() === lower)
  if (exact) return GATEWAY_TO_VARIANT[exact]

  if (/-fast(?:$|[-_])/i.test(lower)) return 'fast'
  if (/-face(?:$|[-_])/i.test(lower)) return 'face'
  if (/-mini(?:$|[-_])/i.test(lower)) return 'mini'
  if (/^doubao-seedance-2[.-]0$/i.test(gatewayModelId)) return 'standard'
  // e.g. doubao-seedance-2-0-260128 (BytePlus base 2.0)
  if (/^doubao-seedance-2-0-\d+$/i.test(gatewayModelId)) return 'mini'
  return 'mini'
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
  if (isSeedance1x(gatewayModelId) || isSeedance1x(modelKey)) return null

  for (const id of [gatewayModelId, modelKey]) {
    const variant = inferSeedance20VariantFromDoubaoGateway(id)
    if (variant) return SEEDANCE_20_GATEWAYS[variant]
  }
  return null
}

export function resolveVideoGatewayModelId(modelKey: string, gatewayModelId: string): string {
  return resolveSeedance20Gateway(modelKey, gatewayModelId) ?? gatewayModelId
}

export function buildSeedance20Profile(gatewayModelId: string): VideoModelProfile {
  const variantTag = GATEWAY_TO_VARIANT[gatewayModelId] ?? 'mini'
  const maxResolution: VideoResolutionTier =
    variantTag === 'standard' ? '4k' : variantTag === 'face' ? '1080p' : '720p'
  const allowedResolutions: string[] =
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

const APIMART_GENERIC_VIDEO_PROFILE: Omit<VideoModelProfile, 'gatewayModelId'> = {
  refWire: 'apimart_multimodal',
  sizeWire: 'ratio_duration',
  responseMode: 'async_task',
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

export function resolveVideoModelProfile(
  modelKey: string,
  gatewayModelId: string,
  opts?: { channelBaseUrl?: string },
): VideoModelProfile {
  const seedanceGw = resolveSeedance20Gateway(modelKey, gatewayModelId)
  if (seedanceGw) {
    const profile = buildSeedance20Profile(seedanceGw)
    // BYOK channels may use upstream ids (e.g. doubao-seedance-2-0-260128) — keep for API calls.
    if (
      gatewayModelId.toLowerCase() !== seedanceGw.toLowerCase() &&
      /^doubao-seedance-/i.test(gatewayModelId)
    ) {
      return { ...profile, gatewayModelId }
    }
    return profile
  }

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
  if (opts?.channelBaseUrl?.includes('apimart.ai')) {
    return {
      ...APIMART_GENERIC_VIDEO_PROFILE,
      gatewayModelId: gw,
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

function clampResolution(
  resolution: string,
  profile: VideoModelProfile,
  droppedFields: Array<{ field: string; reason: string }>,
): string {
  const cap = profile.maxResolution ?? '1080p'
  const resolutionRank = RESOLUTION_RANK[resolution as VideoResolutionTier] ?? 0
  const capRank = RESOLUTION_RANK[cap] ?? 0
  if (resolutionRank > capRank) {
    droppedFields.push({
      field: 'resolution',
      reason: `${resolution} not on ${profile.variantTag ?? 'model'}; use ${cap}`,
    })
    return cap
  }
  return resolution
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
  resolution = clampResolution(resolution, profile, droppedFields)

  const referenceImages = input.referenceImages.slice(0, profile.maxImageRefs)
  const referenceVideos = input.referenceVideos.slice(0, profile.maxVideoRefs)
  const referenceAudios = input.referenceAudios.slice(0, profile.maxAudioRefs)

  if (input.referenceImages.length > profile.maxImageRefs) {
    droppedFields.push({ field: 'referenceImages', reason: `truncated to ${profile.maxImageRefs}` })
  }

  return { duration, aspectRatio, resolution, referenceImages, referenceVideos, referenceAudios, droppedFields }
}
