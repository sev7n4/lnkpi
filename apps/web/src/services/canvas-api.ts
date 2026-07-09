import { api } from './api'

export const canvasApi = {
  list: () => api.get('/agent/canvas/list'),
  create: (title?: string) => api.post('/agent/canvas/create', { title }),
  update: (id: string, data: { title?: string; canvasData?: unknown }) =>
    api.put('/agent/canvas/update', { id, ...data }),
  createShot: (sessionId: string, data: { title?: string; prompt?: string }) =>
    api.post('/agent/canvas/shot/create', { sessionId, ...data }),
  generateImage: (shotId: string, prompt: string) =>
    api.post('/agent/canvas/material/generate-image', { shotId, prompt }),
  statusBatch: (ids: string[]) =>
    api.get('/agent/canvas/shot/status/batch', { params: { ids: ids.join(',') } }),
}
