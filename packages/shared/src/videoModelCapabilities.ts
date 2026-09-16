import { resolveVideoModelProfile } from './videoModelProfiles'

export interface VideoModelCapabilities {
  supportsFirstLastFrame: boolean
  supportsKeyframes: boolean
  supportsVideoRef: boolean
  supportsAudioRef: boolean
  supportsReferenceToVideo: boolean
  supportsGenerateAudio: boolean
  supportsReturnLastFrame: boolean
  supports4K: boolean
  allowedAspectRatios: string[]
  allowedResolutions: string[]
  minDuration: number
  maxDuration: number
  maxImageRefs: number
  maxVideoRefs: number
  maxAudioRefs: number
  firstLastFrameLabel: string
  keyframesLabel: string
}

export function resolveVideoModelCapabilities(
  modelKey: string,
  gatewayModelId?: string,
): VideoModelCapabilities {
  const profile = resolveVideoModelProfile(modelKey, gatewayModelId ?? modelKey)
  const isAgnes = profile.refWire === 'agnes_single_image' || profile.refWire === 'agnes_keyframes'
  const isSeedance =
    profile.refWire === 'apimart_multimodal' || profile.refWire === 'apimart_first_last'
  const isFalH3Max = profile.refWire === 'fal_h3_max'
  const isOfficialH3 = profile.refWire === 'minimax_h3_content'
  const supportsFirstLastFrame = isSeedance || isFalH3Max || isOfficialH3

  return {
    supportsFirstLastFrame,
    supportsKeyframes: isAgnes || isSeedance,
    supportsVideoRef: profile.maxVideoRefs > 0,
    supportsAudioRef: profile.maxAudioRefs > 0,
    supportsReferenceToVideo: isOfficialH3 && profile.maxVideoRefs > 0,
    supportsGenerateAudio: profile.defaultGenerateAudio,
    supportsReturnLastFrame: isSeedance,
    supports4K: profile.maxResolution === '4k',
    allowedAspectRatios: profile.allowedAspectRatios,
    allowedResolutions: profile.allowedResolutions,
    minDuration: profile.minDuration,
    maxDuration: profile.maxDuration,
    maxImageRefs: profile.maxImageRefs,
    maxVideoRefs: profile.maxVideoRefs,
    maxAudioRefs: profile.maxAudioRefs,
    firstLastFrameLabel: supportsFirstLastFrame ? '严格首尾帧' : '关键帧过渡',
    keyframesLabel: isAgnes ? '关键帧过渡' : '多图参考',
  }
}
