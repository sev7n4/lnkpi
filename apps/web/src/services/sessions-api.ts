import type { Session } from '@lnkpi/shared'
import { api } from './api'

export const sessionsApi = {
  list: () => api.get<{ data: Session[] }>('/sessions'),
  create: (data: { title?: string; prompt?: string }) =>
    api.post<{ data: Session }>('/sessions', data),
  update: (id: string, data: { title?: string; canvasData?: unknown }) =>
    api.put<{ data: Session }>(`/sessions/${id}`, data),
  remove: (id: string) => api.delete(`/sessions/${id}`),
  duplicate: (id: string) => api.post<{ data: Session }>(`/sessions/${id}/duplicate`),
}
