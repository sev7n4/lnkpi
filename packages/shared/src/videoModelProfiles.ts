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
