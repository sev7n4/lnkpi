import { api } from './api'
import type { ApiCallFormat, ModelCapability } from '@lnkpi/shared'

export type ChannelModelEntry = {
  name: string
  capability: ModelCapability
}

export type ProviderChannelPublic = {
  id: string
  name: string
  apiFormat: ApiCallFormat
  baseUrl: string
  models: ChannelModelEntry[]
  hasApiKey: boolean
  apiKeyMask?: string
  readOnly: boolean
  createdAt: string
  updatedAt: string
}

export type ProviderPreferencesPublic = {
  selectableImageModels: string[]
  selectableVideoModels: string[]
  selectableTextModels: string[]
  selectableAudioModels: string[]
  defaultImageModel: string
  defaultVideoModel: string
  defaultTextModel: string
  defaultAudioModel: string
  canvasImageCount: number
  audioVoice: string
  audioFormat: string
  audioSpeed: number
  audioInstructions: string | null
  systemPrompt: string | null
}

export type ProviderWebdavPublic = {
  url: string
  directory: string
  username: string
  hasPassword: boolean
  connectionMode: 'proxy'
  lastSyncedAt: string | null
}

export type ProviderBootstrap = {
  platformChannel: ProviderChannelPublic
  channels: ProviderChannelPublic[]
  preferences: ProviderPreferencesPublic
  webdav: ProviderWebdavPublic
}

export type CreateChannelInput = {
  name: string
  apiFormat: ApiCallFormat
  baseUrl: string
  apiKey?: string
  models?: ChannelModelEntry[]
}

export type UpdateChannelInput = {
  name?: string
  apiFormat?: ApiCallFormat
  baseUrl?: string
  apiKey?: string
  clearApiKey?: boolean
  models?: ChannelModelEntry[]
}

export type UpdatePreferencesInput = Partial<ProviderPreferencesPublic>

export type UpdateWebdavInput = {
  url?: string
  directory?: string
  username?: string
  password?: string
  clearPassword?: boolean
}

type ApiEnvelope<T> = { code: number; message: string; data: T }

async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const res = await promise
  return res.data.data
}

export const providerApi = {
  bootstrap: () => unwrap(api.get<ApiEnvelope<ProviderBootstrap>>('/provider/bootstrap')),

  createChannel: (input: CreateChannelInput) =>
    unwrap(api.post<ApiEnvelope<ProviderChannelPublic>>('/provider/channels', input)),

  updateChannel: (id: string, input: UpdateChannelInput) =>
    unwrap(api.put<ApiEnvelope<ProviderChannelPublic>>(`/provider/channels/${id}`, input)),

  deleteChannel: (id: string) =>
    unwrap(api.delete<ApiEnvelope<{ id: string }>>(`/provider/channels/${id}`)),

  pullAllModels: () =>
    unwrap(api.post<ApiEnvelope<ProviderChannelPublic[]>>('/provider/channels/pull-all')),

  pullModels: (id: string) =>
    unwrap(api.post<ApiEnvelope<ProviderChannelPublic>>(`/provider/channels/${id}/pull-models`)),

  updatePreferences: (input: UpdatePreferencesInput) =>
    unwrap(api.put<ApiEnvelope<ProviderPreferencesPublic>>('/provider/preferences', input)),

  updateWebdav: (input: UpdateWebdavInput) =>
    unwrap(api.put<ApiEnvelope<ProviderWebdavPublic>>('/provider/webdav', input)),

  testWebdav: () => unwrap(api.post<ApiEnvelope<{ ok: true }>>('/provider/webdav/test')),

  syncWebdav: () => unwrap(api.post<ApiEnvelope<ProviderWebdavPublic>>('/provider/webdav/sync')),
}

export { apiErrorMessage } from '@/utils/apiError'
