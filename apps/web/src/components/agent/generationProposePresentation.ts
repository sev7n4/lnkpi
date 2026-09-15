/** @vitest-environment node */

import type { AgentPresentationEnvelope } from '@/components/agent/presentation/types'

/** Minimal node shape for generation_propose presentation (Phase 2c.2). */
export type GenerationProposeNodeLike = {
  id: string
  type?: string | null
  data?: Record<string, unknown> | null
}

/** Optional Nest proposeGeneration.summary merge (credits / missing display fallback only). */
export type GenerationProposeSummaryLike = {
  credits_hint?: string
  type?: string
  title?: string
  promptPreview?: string
  imageModel?: string
  videoModel?: string
  textModel?: string
  audioModel?: string
  imageAspect?: string
  imageResolution?: string
  videoSettings?: unknown
}

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  text: '文案',
  audio: '音频',
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function promptFromNode(data: Record<string, unknown>): string {
  return String(data.prompt ?? data.content ?? '').trim()
}

function previewPrompt(prompt: string, max = 120): string {
  if (!prompt) return ''
  return prompt.length > max ? `${prompt.slice(0, max)}…` : prompt
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

function videoSettingsHint(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined
  const s = settings as Record<string, unknown>
  const parts: string[] = []
  const duration = s.duration ?? s.seconds
  if (duration != null && String(duration).trim()) parts.push(`${String(duration).trim()}s`)
  const aspect = asNonEmptyString(s.aspectRatio ?? s.aspect)
  if (aspect) parts.push(aspect)
  return parts.length ? parts.join(' · ') : undefined
}

function collectParamHints(
  data: Record<string, unknown>,
  summary?: GenerationProposeSummaryLike | null,
): string[] {
  const rows: string[] = []
  const model =
    asNonEmptyString(data.imageModel) ??
    asNonEmptyString(data.videoModel) ??
    asNonEmptyString(data.textModel) ??
    asNonEmptyString(data.audioModel) ??
    asNonEmptyString(summary?.imageModel) ??
    asNonEmptyString(summary?.videoModel) ??
    asNonEmptyString(summary?.textModel) ??
    asNonEmptyString(summary?.audioModel)
  if (model) rows.push(`模型 ${model}`)

  const aspect =
    asNonEmptyString(data.imageAspect) ?? asNonEmptyString(summary?.imageAspect)
  if (aspect) rows.push(`比例 ${aspect}`)

  const resolution =
    asNonEmptyString(data.imageResolution) ?? asNonEmptyString(summary?.imageResolution)
  if (resolution) rows.push(`分辨率 ${resolution}`)

  const videoHint =
    videoSettingsHint(data.videoSettings) ?? videoSettingsHint(summary?.videoSettings)
  if (videoHint) rows.push(videoHint)

  return rows
}

/**
 * Phase 2c.2: build generation_propose presentation from node SSOT.
 * Prompt always from node; summary may supply credits_hint or missing param labels only.
 */
export function buildGenerationProposePresentation(
  node: GenerationProposeNodeLike,
  summary?: GenerationProposeSummaryLike | null,
): AgentPresentationEnvelope {
  const data = (node.data ?? {}) as Record<string, unknown>
  const type = asNonEmptyString(node.type) ?? asNonEmptyString(summary?.type) ?? 'media'
  const title =
    asNonEmptyString(data.title) ?? asNonEmptyString(summary?.title) ?? typeLabel(type)
  const prompt = promptFromNode(data)
  const promptPreview = previewPrompt(prompt)
  const credits =
    asNonEmptyString(data.credits_hint) ?? asNonEmptyString(summary?.credits_hint)
  const paramHint = collectParamHints(data, summary).join(' · ') || undefined

  const body: NonNullable<AgentPresentationEnvelope['body']> = {
    text: promptPreview || '（无提示词）',
  }
  if (paramHint) body.hint = paramHint
  if (credits) body.credits_hint = credits

  return {
    kind: 'generation_propose',
    title,
    stepper: { current: 'generating', completed: [] },
    body,
  }
}
