import type {
  CanvasData,
  CanonicalVideoGenerationRequest,
  GenerationRefPayload,
  VideoGenerationMode,
} from '@lnkpi/shared'
import { resolveCanonicalVideoRequest } from '@lnkpi/shared'

export type VideoStartBody = {
  prompt: string
  model?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
  videoMode?: string
  generateAudio?: boolean
  seed?: number
  negativePrompt?: string
  referenceImageUrl?: string
  refs?: GenerationRefPayload[]
  mentionedKeys?: string[]
  sessionId?: string
  nodeId?: string
}

function inferVideoMode(explicit: unknown, refs: GenerationRefPayload[]): VideoGenerationMode {
  const mode = String(explicit ?? '').trim()
  if (mode === 'text_to_video' || mode === 'image_to_video' || mode === 'first_last_frame') {
    return mode
  }
  return refs.some((r) => r.mediaType === 'image') ? 'image_to_video' : 'text_to_video'
}

export function buildCanonicalVideoRequestFromBody(body: VideoStartBody): CanonicalVideoGenerationRequest {
  const refs = (body.refs ?? []).map((r) => ({
    refKey: r.refKey,
    mediaType: r.mediaType,
    label: r.label,
    text: r.text,
    url: r.url,
  }))
  return {
    prompt: String(body.prompt ?? '').trim(),
    refs,
    mentionedKeys: body.mentionedKeys?.length ? body.mentionedKeys : undefined,
    videoSettings: {
      duration: typeof body.duration === 'number' && body.duration > 0 ? body.duration : 5,
      aspectRatio: body.aspectRatio?.trim() || '16:9',
      resolution: body.resolution?.trim() || '720p',
      crop: body.crop?.trim() || 'none',
      generateAudio: typeof body.generateAudio === 'boolean' ? body.generateAudio : undefined,
    },
    videoMode: inferVideoMode(body.videoMode, refs),
    model: body.model?.trim() || undefined,
    seed:
      typeof body.seed === 'number' && Number.isFinite(body.seed)
        ? Math.trunc(body.seed)
        : undefined,
    negativePrompt: body.negativePrompt?.trim() || undefined,
    scope: {
      sessionId: body.sessionId?.trim() || '',
      nodeId: body.nodeId?.trim() || '',
    },
  }
}

export function resolveVideoStartRequest(input: {
  body: VideoStartBody
  canvas?: CanvasData
  nodeId?: string
  sessionId?: string
}): { request: CanonicalVideoGenerationRequest; legacyReferenceImageUrl?: string } {
  const sessionId = input.sessionId ?? input.body.sessionId ?? ''
  const nodeId = input.nodeId ?? input.body.nodeId ?? ''

  if (input.canvas && nodeId) {
    const node = input.canvas.nodes.find((n) => n.id === nodeId)
    if (node) {
      const request = resolveCanonicalVideoRequest({
        node,
        canvas: input.canvas,
        sessionId,
      })
      const legacy = String(node.data?.referenceImageUrl ?? bodyReference(input.body)).trim() || undefined
      return { request, legacyReferenceImageUrl: legacy }
    }
  }

  const request = buildCanonicalVideoRequestFromBody({ ...input.body, sessionId, nodeId })
  const legacy = bodyReference(input.body)
  return {
    request,
    legacyReferenceImageUrl: legacy || undefined,
  }
}

function bodyReference(body: VideoStartBody): string {
  return String(body.referenceImageUrl ?? '').trim()
}
