import { api } from './api'

export interface GenerationRecord {
  id: string
  type: string
  prompt: string
  model?: string | null
  url?: string | null
  status: string
  metadata?: string | null
  createdAt: string
}

export interface AudioGenerateOptions {
  voice?: string
  emotion?: string
  language?: string
  speed?: number
}

export type StudioRefPayload = {
  refKey: string
  mediaType: string
  label?: string
  text?: string
  url?: string
}

export const studioApi = {
  listGenerations: (type?: string) =>
    api.get<{ data: GenerationRecord[] }>('/studio/generations', { params: { type } }),
  getGeneration: (id: string) =>
    api.get<{ data: GenerationRecord }>(`/studio/generations/${id}`),
  generateImage: (prompt: string, model?: string, aspectRatio?: string, refs?: StudioRefPayload[]) =>
    api.post<{ data: GenerationRecord }>('/studio/image/generate', { prompt, model, aspectRatio, refs }, { timeout: 120_000 }),
  generateImageVariation: (prompt: string, basePrompt?: string, model?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/image/variation', { prompt, basePrompt, model }, { timeout: 120_000 }),
  generateText: (prompt: string, model?: string, refs?: StudioRefPayload[]) =>
    api.post<{ data: GenerationRecord }>('/studio/text/generate', { prompt, model, refs }, { timeout: 90_000 }),
  generatePrompt: (prompt: string, model?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/prompt/generate', { prompt, model }, { timeout: 90_000 }),
  generateVideo: (prompt: string, model?: string, duration?: number, aspectRatio?: string, refs?: StudioRefPayload[]) =>
    api.post<{ data: GenerationRecord }>('/studio/video/generate', { prompt, model, duration, aspectRatio, refs }, { timeout: 60_000 }),
  generateAudio: (text: string, options?: AudioGenerateOptions, refs?: StudioRefPayload[]) =>
    api.post<{ data: GenerationRecord & { url?: string } }>('/studio/audio/generate', { text, ...options, refs }, { timeout: 60_000 }),
}
