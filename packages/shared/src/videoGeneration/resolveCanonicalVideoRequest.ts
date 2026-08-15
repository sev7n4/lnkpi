import type { CanvasData, CanvasNode, GenerationRefPayload } from '../index'
import { resolveNodeRefs } from '../nodeRefs'
import type { LocalRefBinding } from '../nodeRefs'
import type {
  CanonicalVideoGenerationRequest,
  CanonicalVideoSettings,
  VideoAccountDefaults,
  VideoGenerationMode,
} from './types'

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function pickDuration(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function resolveVideoSettings(
  nodeData: Record<string, unknown>,
  defaults?: VideoAccountDefaults,
): CanonicalVideoSettings {
  const settings =
    nodeData.videoSettings && typeof nodeData.videoSettings === 'object'
      ? (nodeData.videoSettings as Record<string, unknown>)
      : {}
  return {
    duration: pickDuration(settings.duration, defaults?.duration ?? 5),
    aspectRatio: pickString(settings.aspectRatio, defaults?.aspectRatio, '16:9'),
    resolution: pickString(settings.resolution, defaults?.resolution, '720p'),
    crop: pickString(settings.crop, defaults?.crop, 'none'),
    generateAudio:
      typeof settings.generateAudio === 'boolean' ? settings.generateAudio : undefined,
  }
}

function inferVideoMode(
  explicit: unknown,
  refs: GenerationRefPayload[],
): VideoGenerationMode {
  const mode = String(explicit ?? '').trim()
  if (mode === 'text_to_video' || mode === 'image_to_video' || mode === 'first_last_frame') {
    return mode
  }
  return refs.some((r) => r.mediaType === 'image') ? 'image_to_video' : 'text_to_video'
}

export function resolveCanonicalVideoRequest(input: {
  node: CanvasNode
  canvas: CanvasData
  accountDefaults?: VideoAccountDefaults
  sessionId?: string
}): CanonicalVideoGenerationRequest {
  const data = input.node.data ?? {}
  const refs = resolveNodeRefs({
    targetNodeId: input.node.id,
    targetType: String(input.node.type),
    nodes: input.canvas.nodes,
    edges: input.canvas.edges,
    localRefs: (data.localRefs as LocalRefBinding[] | undefined) ?? [],
    refOrder: (data.refOrder as string[] | undefined) ?? [],
  })
    .filter((r) => !r.stale)
    .map(
      (r): GenerationRefPayload => ({
        refKey: r.refKey,
        mediaType: r.mediaType,
        label: r.label,
        text: r.payload.text,
        url: r.payload.url,
      }),
    )

  const mentionedKeys = Array.isArray(data.mentionedKeys)
    ? (data.mentionedKeys as string[]).filter((k) => typeof k === 'string' && k.trim())
    : undefined

  const videoSettings = resolveVideoSettings(data, input.accountDefaults)
  const videoMode = inferVideoMode(data.videoMode, refs)
  const seedRaw = data.seed
  const seed =
    typeof seedRaw === 'number' && Number.isFinite(seedRaw) ? Math.trunc(seedRaw) : undefined
  const negativePrompt = pickString(data.negativePrompt) || undefined

  return {
    prompt: String(data.prompt ?? data.content ?? '').trim(),
    refs,
    mentionedKeys: mentionedKeys?.length ? mentionedKeys : undefined,
    videoSettings,
    videoMode,
    model: pickString(data.videoModel, input.accountDefaults?.model) || undefined,
    seed,
    negativePrompt,
    scope: {
      sessionId: input.sessionId ?? '',
      nodeId: input.node.id,
    },
  }
}
