import { computed, type ComputedRef, type Ref } from 'vue'
import {
  decodeChannelModel,
  resolveVideoModelCapabilities,
  type VideoModelCapabilities,
} from '@lnkpi/shared'

export function useVideoModelCapabilities(videoModel: Ref<string> | ComputedRef<string>) {
  const capabilities = computed<VideoModelCapabilities>(() => {
    const value = videoModel.value
    const decoded = decodeChannelModel(value)
    const modelKey = decoded?.modelName ?? value
    return resolveVideoModelCapabilities(modelKey, modelKey)
  })

  return { capabilities }
}
