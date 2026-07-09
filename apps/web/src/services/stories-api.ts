import { api } from './api'

export interface Story {
  id: string
  title: string
  synopsis: string
  sessionId?: string | null
  status: string
  episodeCount: number
  coverUrl?: string | null
  createdAt: string
  updatedAt: string
}

export const storiesApi = {
  list: () => api.get<{ data: Story[] }>('/stories'),
  create: (data: { title: string; synopsis?: string; episodeCount?: number }) =>
    api.post<{ data: Story }>('/stories', data),
  get: (id: string) => api.get<{ data: Story }>(`/stories/${id}`),
}
