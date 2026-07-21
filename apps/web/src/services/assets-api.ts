import { api } from './api'

export interface PublicAssetItem {
  id: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio'
  publishedAt: string
}

export interface UserAssetItem {
  id: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio'
  sourceNodeId?: string | null
  createdAt: string
}

export interface SaveUserAssetPayload {
  kind: 'image' | 'video' | 'audio'
  url: string
  label?: string
  sourceNodeId?: string
}

export const assetsApi = {
  listPublic: (params?: { kind?: string; search?: string }) =>
    api.get<{ code: number; data: { items: PublicAssetItem[] } }>('/assets/public', { params }),
  listMine: () =>
    api.get<{ code: number; data: { items: UserAssetItem[] } }>('/assets/mine'),
  saveMine: (payload: SaveUserAssetPayload) =>
    api.post<{ code: number; data: UserAssetItem }>('/assets/mine', payload),
  removeMine: (id: string) =>
    api.delete<{ code: number; data: { id: string } }>(`/assets/mine/${id}`),
}
