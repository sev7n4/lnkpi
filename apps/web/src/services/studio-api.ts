import { api } from './api'
import type { GenerationDiagnostic, GenerationRefPayload } from '@lnkpi/shared'

export type StudioRefPayload = GenerationRefPayload

export interface CanvasGenerationScope {
  sessionId?: string
  nodeId?: string
}

export interface GenerationRecord {
  id: string
  type: string
  prompt: string
  model?: string | null
  url?: string | null
  status: string
  metadata?: string | null
  sessionId?: string | null
  nodeId?: string | null
  createdAt: string
}

export interface AudioGenerateOptions {
  voice?: string
  emotion?: string
  language?: string
  speed?: number
  volume?: number
  pitch?: number
  model?: string
}

function scopeBody(scope?: CanvasGenerationScope) {
  if (!scope?.sessionId && !scope?.nodeId) return {}
  return {
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    ...(scope.nodeId ? { nodeId: scope.nodeId } : {}),
  }
}

export const studioApi = {
  listGenerations: (opts?: { type?: string; sessionId?: string } | string) => {
    const params = typeof opts === 'string' ? { type: opts } : opts
    return api.get<{ data: GenerationRecord[] }>('/studio/generations', { params })
  },
  getGeneration: (id: string) =>
    api.get<{ data: GenerationRecord }>(`/studio/generations/${id}`),
  generateImage: (
    prompt: string,
    model?: string,
    aspectRatio?: string,
    refs?: StudioRefPayload[],
    mentionedKeys?: string[],
    resolution?: string,
    count?: number,
    signal?: AbortSignal,
    scope?: CanvasGenerationScope,
  ) =>
    api.post<{ data: GenerationRecord }>(
      '/studio/image/generate',
      { prompt, model, aspectRatio, refs, mentionedKeys, resolution, count, ...scopeBody(scope) },
      { timeout: 300_000, signal },
    ),
  generateImageVariation: (
    prompt: string,
    basePrompt?: string,
    model?: string,
    signal?: AbortSignal,
    scope?: CanvasGenerationScope,
  ) =>
    api.post<{ data: GenerationRecord }>(
      '/studio/image/variation',
      { prompt, basePrompt, model, ...scopeBody(scope) },
      { timeout: 300_000, signal },
    ),
  generateText: (
    prompt: string,
    model?: string,
    refs?: StudioRefPayload[],
    mentionedKeys?: string[],
    signal?: AbortSignal,
    thinking?: boolean,
    thinkingEffort?: 'high' | 'max',
    scope?: CanvasGenerationScope,
  ) =>
    api.post<{ data: GenerationRecord }>(
      '/studio/text/generate',
      {
        prompt,
        model,
        refs,
        mentionedKeys,
        thinking,
        thinkingEffort,
        ...scopeBody(scope),
      },
      { timeout: thinking ? 300_000 : 180_000, signal },
    ),
  generatePrompt: (
    prompt: string,
    model?: string,
    signal?: AbortSignal,
    scope?: CanvasGenerationScope,
  ) =>
    api.post<{ data: GenerationRecord }>(
      '/studio/prompt/generate',
      { prompt, model, ...scopeBody(scope) },
      { timeout: 180_000, signal },
    ),
  generateVideo: (
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
    refs?: StudioRefPayload[],
    mentionedKeys?: string[],
    resolution?: string,
    crop?: string,
    signal?: AbortSignal,
    scope?: CanvasGenerationScope,
  ) =>
    api.post<{ data: GenerationRecord }>(
      '/studio/video/generate',
      {
        prompt,
        model,
        duration,
        aspectRatio,
        refs,
        mentionedKeys,
        resolution,
        crop,
        ...scopeBody(scope),
      },
      { timeout: 60_000, signal },
    ),
  generateAudio: (
    text: string,
    options?: AudioGenerateOptions,
    refs?: StudioRefPayload[],
    mentionedKeys?: string[],
    signal?: AbortSignal,
    scope?: CanvasGenerationScope,
  ) =>
    api.post<{ data: GenerationRecord & { url?: string } }>(
      '/studio/audio/generate',
      { text, ...options, refs, mentionedKeys, ...scopeBody(scope) },
      { timeout: 60_000, signal },
    ),
  confirmPlatformFallback: (id: string) =>
    api.post<{ data: GenerationRecord }>(`/studio/generations/${id}/confirm-platform-fallback`, {}, {
      timeout: 120_000,
    }),
  cancelPlatformFallback: (id: string) =>
    api.post<{ data: GenerationRecord }>(`/studio/generations/${id}/cancel-platform-fallback`),
  cancelGeneration: (id: string) =>
    api.post<{ data: GenerationRecord }>(`/studio/generations/${id}/cancel`),
  getGenerationDiagnostic: (id: string) =>
    api
      .get<{ data: GenerationDiagnostic }>(`/studio/generations/${id}/diagnostic`)
      .then((r) => r.data.data),
}
