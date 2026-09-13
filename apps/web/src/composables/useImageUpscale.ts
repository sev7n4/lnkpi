import { ref } from 'vue'
import { canvasApi } from '@/services/canvas-api'
import { apiErrorMessage } from '@/utils/apiError'

export type UpscaleResult = {
  url: string
  scale: 2 | 4
  providerId: string
  recordId?: string
}

export type RunUpscaleInput = {
  sessionId: string
  nodeId?: string
  imageUrl: string
  /** UI 固定 2×；API 仍预留 4 */
  scale?: 2 | 4
  onSuccess?: (result: { url: string }) => void
}

export function useImageUpscale() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function runUpscale(input: RunUpscaleInput): Promise<UpscaleResult> {
    loading.value = true
    error.value = null
    try {
      const { data } = await canvasApi.upscaleImage({
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        imageUrl: input.imageUrl,
        scale: input.scale ?? 2,
      })
      const result = data.data
      input.onSuccess?.({ url: result.url })
      return result
    } catch (err) {
      error.value = apiErrorMessage(err, '放大失败')
      throw err
    } finally {
      loading.value = false
    }
  }

  return { loading, error, runUpscale }
}
