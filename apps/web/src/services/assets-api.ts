import { api } from './api'

export interface PublicAssetItem {
  id: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio'
  publishedAt: string
}

export const assetsApi = {
  listPublic: (params?: { kind?: string; search?: string }) =>
    api.get<{ code: number; data: { items: PublicAssetItem[] } }>('/assets/public', { params }),
}
