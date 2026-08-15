import { ref } from 'vue'
import type { MediaInfo, ProbedMediaFile } from '@lnkpi/shared'
import { studioApi, type GenerationRecord } from '@/services/studio-api'

export interface NodeMediaInfoSummary {
  kind?: 'image' | 'video'
  width?: number
  height?: number
  bytes?: number
  aspectRatio?: string
  resolution?: string
  refWarning?: 'warn' | 'error'
}

function parseRecordMeta(rec: GenerationRecord): Record<string, unknown> {
  if (!rec.metadata) return {}
  try {
    return JSON.parse(rec.metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function resolveRecordMediaInfo(rec: GenerationRecord): MediaInfo | undefined {
  if (rec.mediaInfo?.output || rec.mediaInfo?.references?.length) {
    return rec.mediaInfo
  }
  const meta = parseRecordMeta(rec)
  const fromMeta = meta.mediaInfo
  return fromMeta && typeof fromMeta === 'object' ? (fromMeta as MediaInfo) : undefined
}

export interface MediaInspectorTarget {
  generationRecordId: string
  nodeId?: string
  nodeLabel?: string
  url?: string
  kind?: 'image' | 'video'
}

interface CachedRecord {
  record: GenerationRecord
  fetchedAt: number
}

const recordCache = new Map<string, CachedRecord>()
const probeCache = new Map<string, ProbedMediaFile>()

const open = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const target = ref<MediaInspectorTarget | null>(null)
const record = ref<GenerationRecord | null>(null)

export function buildNodeMediaInfoSummary(rec: GenerationRecord): NodeMediaInfoSummary | undefined {
  const output = resolveRecordMediaInfo(rec)?.output
  const meta = parseRecordMeta(rec)
  const kind: NodeMediaInfoSummary['kind'] = rec.type === 'video' ? 'video' : 'image'
  const summary: NodeMediaInfoSummary = { kind }

  if (kind === 'video') {
    const resolution = meta.resolution
    if (typeof resolution === 'string' && resolution.trim()) {
      summary.resolution = resolution.trim()
    }
    const aspectRatio = meta.aspectRatio
    if (typeof aspectRatio === 'string' && aspectRatio.trim()) {
      summary.aspectRatio = aspectRatio.trim()
    }
    if (output?.bytes != null) summary.bytes = output.bytes
  } else {
    if (output?.width != null) summary.width = output.width
    if (output?.height != null) summary.height = output.height
    if (output?.bytes != null) summary.bytes = output.bytes
    const aspectRatio = meta.aspectRatio
    if (typeof aspectRatio === 'string' && aspectRatio.trim()) {
      summary.aspectRatio = aspectRatio.trim()
    }
  }

  const refLevel = rec.refPreflight?.level
  if (refLevel === 'warn' || refLevel === 'error') {
    summary.refWarning = refLevel
  }

  const { kind: _kind, refWarning: _refWarning, ...rest } = summary
  const hasPayload = Object.values(rest).some((v) => v != null && v !== '')
  return hasPayload || summary.refWarning ? summary : undefined
}

export function useMediaInspector() {
  async function openInspector(next: MediaInspectorTarget) {
    target.value = next
    open.value = true
    error.value = null
    loading.value = true
    try {
      const cached = recordCache.get(next.generationRecordId)
      if (cached) {
        record.value = cached.record
      } else {
        const { data: res } = await studioApi.getGeneration(next.generationRecordId)
        recordCache.set(next.generationRecordId, { record: res.data, fetchedAt: Date.now() })
        record.value = res.data
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载媒体属性失败'
      record.value = null
    } finally {
      loading.value = false
    }
  }

  function closeInspector() {
    open.value = false
  }

  async function probeMedia(url: string): Promise<ProbedMediaFile> {
    const cached = probeCache.get(url)
    if (cached) return cached
    const probed = await studioApi.probeMedia(url)
    probeCache.set(url, probed)
    return probed
  }

  function invalidateRecordCache(generationRecordId: string) {
    recordCache.delete(generationRecordId)
  }

  return {
    open,
    loading,
    error,
    target,
    record,
    openInspector,
    closeInspector,
    probeMedia,
    invalidateRecordCache,
  }
}
