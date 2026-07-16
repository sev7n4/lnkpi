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

export const studioApi = {
  listGenerations: (type?: string) =>
    api.get<{ data: GenerationRecord[] }>('/studio/generations', { params: { type } }),
  getGeneration: (id: string) =>
    api.get<{ data: GenerationRecord }>(`/studio/generations/${id}`),
  generateImage: (prompt: string, model?: string, aspectRatio?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/image/generate', { prompt, model, aspectRatio }, { timeout: 120_000 }),
  generateImageVariation: (prompt: string, basePrompt?: string, model?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/image/variation', { prompt, basePrompt, model }, { timeout: 120_000 }),
  generateText: (prompt: string, model?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/text/generate', { prompt, model }, { timeout: 90_000 }),
  generateVideo: (prompt: string, model?: string, duration?: number, aspectRatio?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/video/generate', { prompt, model, duration, aspectRatio }, { timeout: 60_000 }),
  generateAudio: (text: string, options?: AudioGenerateOptions) =>
    api.post<{ data: GenerationRecord & { url?: string } }>('/studio/audio/generate', { text, ...options }, { timeout: 60_000 }),
}
