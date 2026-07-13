import { api } from './api'
import type { AIModel } from '@lnkpi/shared'

export interface CapabilitiesData {
  text: AIModel[]
  image: AIModel[]
  video: AIModel[]
}

export const capabilitiesApi = {
  list: () => api.get<{ data: CapabilitiesData }>('/agent/capabilities/list'),
}
