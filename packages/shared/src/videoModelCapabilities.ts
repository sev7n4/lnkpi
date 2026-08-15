import { resolveVideoModelProfile } from './videoModelProfiles'

export interface VideoModelCapabilities {
  supportsFirstLastFrame: boolean
  supportsKeyframes: boolean
  supportsVideoRef: boolean
  supportsAudioRef: boolean
  supportsGenerateAudio: boolean
  supportsReturnLastFrame: boolean
  supports4K: boolean
  allowedAspectRatios: string[]
  allowedResolutions: string[]
  minDuration: number
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

  return {
    supportsFirstLastFrame: isSeedance,
    supportsKeyframes: isAgnes || isSeedance,
    supportsVideoRef: profile.maxVideoRefs > 0,
    supportsAudioRef: profile.maxAudioRefs > 0,
    supportsGenerateAudio: profile.defaultGenerateAudio,
    supportsReturnLastFrame: isSeedance,
    supports4K: profile.maxResolution === '4k',
    allowedAspectRatios: profile.allowedAspectRatios,
    allowedResolutions: profile.allowedResolutions,
    minDuration: profile.minDuration,
    maxImageRefs: profile.maxImageRefs,
    maxVideoRefs: profile.maxVideoRefs,
    maxAudioRefs: profile.maxAudioRefs,
    firstLastFrameLabel: isSeedance ? '严格首尾帧' : '关键帧过渡',
    keyframesLabel: isAgnes ? '关键帧过渡' : '多图参考',
  }
}
