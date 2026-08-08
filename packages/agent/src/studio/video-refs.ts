import type { GenerationRefPayload } from '@lnkpi/shared'

export interface VideoReferenceItem {
  refKey: string
  url: string
  label: string
}

export interface VideoReferenceBundle {
  images: VideoReferenceItem[]
  videos: VideoReferenceItem[]
  audios: VideoReferenceItem[]
}

export type VideoScenario = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8'

export type VideoMode = 'text_to_video' | 'image_to_video' | 'first_last_frame'

function toVideoReferenceItem(ref: GenerationRefPayload): VideoReferenceItem {
  return {
    refKey: ref.refKey,
    url: ref.url!.trim(),
    label: ref.label?.trim() || ref.refKey,
  }
}

export function buildVideoReferenceBundle(
  refs: GenerationRefPayload[],
  referenceImageUrl?: string,
): VideoReferenceBundle {
  const images = refs
    .filter((r) => r.mediaType === 'image' && r.url?.trim())
    .map(toVideoReferenceItem)

  if (images.length === 0 && referenceImageUrl?.trim()) {
    images.push({
      refKey: 'I1',
      url: referenceImageUrl.trim(),
      label: '参考图',
    })
  }

  return {
    images,
    videos: refs
      .filter((r) => r.mediaType === 'video' && r.url?.trim())
      .map(toVideoReferenceItem),
    audios: refs
      .filter((r) => r.mediaType === 'audio' && r.url?.trim())
      .map(toVideoReferenceItem),
  }
}

export function inferVideoScenario(
  bundle: VideoReferenceBundle,
  videoMode?: VideoMode,
): VideoScenario {
  const { images, videos, audios } = bundle
  if (audios.length && !images.length && !videos.length) return 'S7'
  if (videos.length) return 'S6'
  if (audios.length && (images.length || videos.length)) return 'S7'
  if (videoMode === 'first_last_frame' && images.length === 2) return 'S5'
  if (images.length >= 2) return 'S4'
  if (images.length === 1 || videoMode === 'image_to_video') return 'S2'
  return 'S1'
}
