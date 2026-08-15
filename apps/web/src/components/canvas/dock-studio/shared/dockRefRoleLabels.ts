import type { NodeRef } from '@/composables/useNodeRefs'
import type { VideoGenerationMode } from '@/composables/useUpstreamNodeContext'

export function isValidImageRef(ref: NodeRef): boolean {
  return ref.mediaType === 'image' && !ref.stale && !!ref.payload.url?.trim()
}

export function resolveRefRoleLabel(
  ref: NodeRef,
  refs: NodeRef[],
  videoMode: VideoGenerationMode,
): string | undefined {
  if (ref.stale) return undefined

  if (ref.mediaType === 'video') return '运镜'
  if (ref.mediaType === 'audio') return '音频'

  if (ref.mediaType !== 'image' || !ref.payload.url?.trim()) return undefined

  if (videoMode === 'first_last_frame') {
    const imageRefs = refs.filter(isValidImageRef)
    const idx = imageRefs.findIndex((r) => r.refId === ref.refId)
    if (idx === 0) return '首帧'
    if (idx === 1) return '末帧'
    return '参考'
  }

  if (videoMode === 'image_to_video') return '参考'

  return undefined
}

export function countValidImageRefs(refs: NodeRef[]): number {
  return refs.filter(isValidImageRef).length
}

export function hasUnsupportedMediaRefs(
  refs: NodeRef[],
  supportsVideoRef: boolean,
  supportsAudioRef: boolean,
): { hasVideo: boolean; hasAudio: boolean; showWarning: boolean } {
  const hasVideo = refs.some((r) => r.mediaType === 'video' && !r.stale && !!r.payload.url?.trim())
  const hasAudio = refs.some((r) => r.mediaType === 'audio' && !r.stale && !!r.payload.url?.trim())
  const showWarning =
    (hasVideo && !supportsVideoRef) || (hasAudio && !supportsAudioRef)
  return { hasVideo, hasAudio, showWarning }
}
