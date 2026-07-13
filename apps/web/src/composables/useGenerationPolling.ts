import { onUnmounted, ref } from 'vue'
import { studioApi, type GenerationRecord } from '@/services/studio-api'

export interface GenerationPollTask {
  recordId: string
  nodeId: string
}

export function useGenerationPolling(
  onUpdate: (records: Array<{ task: GenerationPollTask; record: GenerationRecord }>) => void,
) {
  const timer = ref<ReturnType<typeof setInterval>>()
  const tasks = ref<GenerationPollTask[]>([])

  async function pollOnce() {
    if (!tasks.value.length) return
    const results: Array<{ task: GenerationPollTask; record: GenerationRecord }> = []
    for (const task of tasks.value) {
      try {
        const { data } = await studioApi.getGeneration(task.recordId)
        results.push({ task, record: data.data })
      } catch {
        // ignore single poll failure
      }
    }
    if (results.length) onUpdate(results)

    const stillGenerating = results.some(
      ({ record }) => record.status === 'generating' || record.status === 'pending',
    )
    if (!stillGenerating && results.length === tasks.value.length) {
      stop()
    }
  }

  function start(newTasks: GenerationPollTask[]) {
    const merged = [...tasks.value]
    for (const task of newTasks) {
      if (!merged.some((t) => t.recordId === task.recordId)) {
        merged.push(task)
      }
    }
    tasks.value = merged
    stop()
    if (!merged.length) return
    void pollOnce()
    timer.value = setInterval(() => {
      void pollOnce()
    }, 2000)
  }

  function stop() {
    if (timer.value) clearInterval(timer.value)
    timer.value = undefined
  }

  function clearTasks() {
    tasks.value = []
    stop()
  }

  onUnmounted(stop)

  return { start, stop, clearTasks }
}

export function parseRecordText(record: { metadata?: string | null; prompt: string }) {
  if (!record.metadata) return record.prompt
  try {
    const meta = JSON.parse(record.metadata) as { text?: string }
    return meta.text ?? record.prompt
  } catch {
    return record.prompt
  }
}

export function parseRecordUrl(record: { url?: string | null; metadata?: string | null }) {
  if (record.url) return record.url
  if (!record.metadata) return ''
  try {
    const meta = JSON.parse(record.metadata) as { url?: string }
    return meta.url ?? ''
  } catch {
    return ''
  }
}
