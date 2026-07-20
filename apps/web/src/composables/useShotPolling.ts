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
      const requestedIds = [...ids.value]
      try {
        const { data } = await canvasApi.statusBatch(requestedIds)
        const shots = (data.data ?? data) as ShotStatus[]
        // Ignore shots removed during await (e.g. cancel → removeById)
        const active = shots.filter((s) => ids.value.includes(s.id))
        if (active.length) onUpdate(active)
        const stillGenerating = active.some((s) =>
          s.materials.some((m) => m.status === 'generating' || m.status === 'pending'),
        )
        if (!stillGenerating) stop()
      } catch {
        // ignore polling errors
      }
    }, 2000)
  }

  function removeById(shotId: string) {
    const next = ids.value.filter((id) => id !== shotId)
    if (next.length === ids.value.length) return
    ids.value = next
    if (!next.length) stop()
  }

  function stop() {
    if (timer.value) clearInterval(timer.value)
    timer.value = undefined
  }

  onUnmounted(stop)
  return { start, stop, removeById }
}
