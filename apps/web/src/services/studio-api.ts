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

export const studioApi = {
  listGenerations: (type?: string) =>
    api.get<{ data: GenerationRecord[] }>('/studio/generations', { params: { type } }),
  generateImage: (prompt: string, model?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/image/generate', { prompt, model }),
  generateVideo: (prompt: string, model?: string, duration?: number) =>
    api.post<{ data: GenerationRecord }>('/studio/video/generate', { prompt, model, duration }),
  generateAudio: (text: string, voice?: string) =>
    api.post<{ data: GenerationRecord }>('/studio/audio/generate', { text, voice }),
}
