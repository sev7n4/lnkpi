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
    // fallback_pending / completed / failed are terminal for this poll loop
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

  function removeByNodeId(nodeId: string) {
    const next = tasks.value.filter((t) => t.nodeId !== nodeId)
    if (next.length === tasks.value.length) return
    tasks.value = next
    if (!next.length) stop()
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

  return { start, stop, clearTasks, removeByNodeId }
}

export function parseRecordPromptContent(record: { metadata?: string | null; prompt: string }) {
  if (!record.metadata) return { content: record.prompt, mode: null as string | null }
  try {
    const meta = JSON.parse(record.metadata) as { content?: string; mode?: string; text?: string }
    return {
      content: meta.content ?? meta.text ?? record.prompt,
      mode: meta.mode ?? null,
    }
  } catch {
    return { content: record.prompt, mode: null }
  }
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
    const meta = JSON.parse(record.metadata) as { url?: string; urls?: string[] }
    return meta.url ?? meta.urls?.[0] ?? ''
  } catch {
    return ''
  }
}

export function parseRecordUrls(record: { url?: string | null; metadata?: string | null }): string[] {
  if (!record.metadata) {
    return record.url ? [record.url] : []
  }
  try {
    const meta = JSON.parse(record.metadata) as { url?: string; urls?: string[] }
    if (Array.isArray(meta.urls) && meta.urls.length) return meta.urls.filter(Boolean)
    const single = meta.url ?? record.url
    return single ? [single] : []
  } catch {
    return record.url ? [record.url] : []
  }
}
