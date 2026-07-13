import { api } from './api'
import type { VideoSettings } from '@lnkpi/shared'

export const canvasApi = {
  list: () => api.get('/agent/canvas/list'),
  create: (title?: string) => api.post('/agent/canvas/create', { title }),
  update: (id: string, data: { title?: string; canvasData?: unknown }) =>
    api.put('/agent/canvas/update', { id, ...data }),
  createShot: (sessionId: string, data: { title?: string; prompt?: string }) =>
    api.post('/agent/canvas/shot/create', { sessionId, ...data }),
  editShot: (shotId: string, data: { title?: string; prompt?: string; status?: string }) =>
    api.post('/agent/canvas/shot/edit', { shotId, ...data }),
  reorderShots: (sessionId: string, shotIds: string[]) =>
    api.post('/agent/canvas/shot-order', { sessionId, shotIds }),
  generateImage: (shotId: string, prompt: string) =>
    api.post('/agent/canvas/material/generate-image', { shotId, prompt }),
  generateVideo: (shotId: string, prompt: string, settings?: Partial<VideoSettings>) =>
    api.post('/agent/canvas/material/generate-video', {
      shotId,
      prompt,
      duration: settings?.duration,
      aspectRatio: settings?.aspectRatio,
      crop: settings?.crop,
    }),
  statusBatch: (ids: string[]) =>
    api.get('/agent/canvas/shot/status/batch', { params: { ids: ids.join(',') } }),
  optimizePrompt: (prompt: string, style?: string) =>
    api.post<{ data: { optimized: string } }>('/agent/chat/optimize-prompt', { prompt, style }),
}
