import type { Session, Work } from '@lnkpi/shared'
import { api } from './api'

export const worksApi = {
  list: (params?: { category?: string; search?: string }) =>
    api.get('/works', { params }),
  get: (id: string) => api.get<{ data: Work }>(`/works/${id}`),
  publish: (data: { sessionId: string; title: string; category?: string; primaryNodeId: string }) =>
    api.post('/works/publish', data),
  like: (id: string) => api.post<{ data: Work }>(`/works/${id}/like`),
  getCanvas: (id: string) => api.get<{ data: { nodes: unknown[]; edges: unknown[] } }>(`/works/${id}/canvas`),
  forkCanvas: (id: string) => api.post<{ data: Session }>(`/works/${id}/fork-canvas`),
}
