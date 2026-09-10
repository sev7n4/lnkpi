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
  metadata?: string | null
  createdAt: string
}

export interface SaveUserAssetPayload {
  kind: 'image' | 'video' | 'audio'
  url: string
  label?: string
  sourceNodeId?: string
  generationRecordId?: string
  sessionId?: string
  replaceNodeUrl?: boolean
}

export interface PersistRemotePayload {
  url: string
  kind: 'image' | 'video' | 'audio'
  label?: string
  sourceNodeId?: string
  sessionId?: string
  replaceNodeUrl?: boolean
  generationRecordId?: string
}

export interface PersistRemoteResult {
  persistedUrl: string
  assetId: string
  storageTier: 'persisted' | 'upload'
}

export const assetsApi = {
  listPublic: (params?: { kind?: string; search?: string }) =>
    api.get<{ code: number; data: { items: PublicAssetItem[] } }>('/assets/public', { params }),
  listMine: () =>
    api.get<{ code: number; data: { items: UserAssetItem[] } }>('/assets/mine'),
  saveMine: (payload: SaveUserAssetPayload) =>
    api.post<{ code: number; data: UserAssetItem }>('/assets/mine', payload),
  persistRemote: (payload: PersistRemotePayload) =>
    api.post<{ code: number; data: PersistRemoteResult }>('/assets/persist-remote', payload),
  removeMine: (id: string) =>
    api.delete<{ code: number; data: { id: string } }>(`/assets/mine/${id}`),
}
