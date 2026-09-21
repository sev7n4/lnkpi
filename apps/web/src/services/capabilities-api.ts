import { api } from './api'
import type { AIModel } from '@lnkpi/shared'

export interface CapabilitiesData {
  text: AIModel[]
  image: AIModel[]
  video: AIModel[]
  /** COS 预签名直传是否可用 */
  stsDirectUpload?: boolean
}

export const capabilitiesApi = {
  list: () => api.get<{ data: CapabilitiesData }>('/agent/capabilities/list'),
}
