import { onUnmounted, ref } from 'vue'
import { canvasApi } from '@/services/canvas-api'

interface ShotMaterial {
  id: string
  url?: string | null
  status: string
  prompt?: string | null
}

interface ShotStatus {
  id: string
  status: string
  materials: ShotMaterial[]
}

export function useShotPolling(onUpdate: (shots: ShotStatus[]) => void) {
  const timer = ref<ReturnType<typeof setInterval>>()
  const ids = ref<string[]>([])

  function start(shotIds: string[]) {
    ids.value = shotIds
    stop()
    if (!shotIds.length) return
    timer.value = setInterval(async () => {
      if (!ids.value.length) return
      try {
        const { data } = await canvasApi.statusBatch(ids.value)
        const shots = (data.data ?? data) as ShotStatus[]
        onUpdate(shots)
        const stillGenerating = shots.some((s) =>
          s.materials.some((m) => m.status === 'generating'),
        )
        if (!stillGenerating) stop()
      } catch {
        // ignore polling errors
      }
    }, 2000)
  }

  function stop() {
    if (timer.value) clearInterval(timer.value)
    timer.value = undefined
  }

  onUnmounted(stop)
  return { start, stop }
}
