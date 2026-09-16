import { BadRequestException } from '@nestjs/common'
import type {
  CanvasData,
  CanonicalVideoGenerationRequest,
  GenerationRefPayload,
  VideoGenerationMode,
} from '@lnkpi/shared'
import { resolveCanonicalVideoRequest, resolveCompositionVideoPrompt } from '@lnkpi/shared'

const EMPTY_P_BLOCK_V_MESSAGE = '分镜还是空的，写好后再生成视频。'

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

export function hasCompositionPBlock(canvas: CanvasData, videoNodeId?: string): boolean {
  const ids = canvas.compositionRunGroup?.nodeIds
  if (!ids?.length) return false
  if (videoNodeId && !ids.includes(videoNodeId)) return false
  if (canvas.nodes.some((node) => node.id === 'text-p')) return true
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  return ids.some((id) => byId.get(id)?.type === 'text')
}

function inferVideoMode(explicit: unknown, refs: GenerationRefPayload[]): VideoGenerationMode {
  const mode = String(explicit ?? '').trim()
  if (
    mode === 'text_to_video'
    || mode === 'image_to_video'
    || mode === 'first_last_frame'
    || mode === 'reference_to_video'
  ) {
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
    const resolvedPrompt = resolveCompositionVideoPrompt(input.canvas, nodeId)
    if ('error' in resolvedPrompt) {
      throw new BadRequestException(EMPTY_P_BLOCK_V_MESSAGE)
    }

    const usePPrompt = hasCompositionPBlock(input.canvas, nodeId)
    const node = input.canvas.nodes.find((n) => n.id === nodeId)
    if (node) {
      const request = resolveCanonicalVideoRequest({
        node,
        canvas: input.canvas,
        sessionId,
      })
      if (usePPrompt) {
        request.prompt = resolvedPrompt.prompt
      }
      const legacy = String(node.data?.referenceImageUrl ?? bodyReference(input.body)).trim() || undefined
      return { request, legacyReferenceImageUrl: legacy }
    }

    if (usePPrompt) {
      const request = buildCanonicalVideoRequestFromBody({
        ...input.body,
        prompt: resolvedPrompt.prompt,
        sessionId,
        nodeId,
      })
      const legacy = bodyReference(input.body)
      return {
        request,
        legacyReferenceImageUrl: legacy || undefined,
      }
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
