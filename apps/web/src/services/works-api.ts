import { api } from './api'

export const worksApi = {
  list: (params?: { category?: string; search?: string }) =>
    api.get('/works', { params }),
  get: (id: string) => api.get(`/works/${id}`),
  publish: (data: { sessionId: string; title: string; category?: string }) =>
    api.post('/works/publish', data),
}
