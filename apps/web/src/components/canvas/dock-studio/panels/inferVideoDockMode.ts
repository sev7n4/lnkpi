import type { VideoGenerationMode } from '@/composables/useUpstreamNodeContext'

export type InferVideoDockModeInput = {
  current: VideoGenerationMode
  imageCount: number
  hasFallbackImage: boolean
  hasVideoOrAudioRef: boolean
  supportsFirstLastFrame: boolean
  supportsReferenceToVideo: boolean
}

export function inferVideoDockMode(input: InferVideoDockModeInput): VideoGenerationMode {
  const hasImage = input.imageCount > 0 || input.hasFallbackImage

  if (input.supportsReferenceToVideo && input.hasVideoOrAudioRef) {
    return 'reference_to_video'
  }

  if (input.current === 'reference_to_video' && input.supportsReferenceToVideo) {
    return 'reference_to_video'
  }

  if (
    input.current === 'first_last_frame' &&
    input.supportsFirstLastFrame &&
    input.imageCount === 2
  ) {
    return 'first_last_frame'
  }

  return hasImage ? 'image_to_video' : 'text_to_video'
}
