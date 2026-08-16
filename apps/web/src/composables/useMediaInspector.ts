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
  generationRecordId?: string
  nodeId?: string
  nodeLabel?: string
  url?: string
  kind?: 'image' | 'video'
  assetMediaInfo?: MediaInfo
  assetMeta?: Record<string, unknown>
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

export interface LocateCanvasNodePayload {
  recordId: string
  nodeId?: string | null
}

type LocateCanvasNodeHandler = (payload: LocateCanvasNodePayload) => void | Promise<void>

const locateNodeHandler = ref<LocateCanvasNodeHandler | null>(null)

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

function parseMaterialMeta(metadata?: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    return JSON.parse(metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

export interface MaterialMediaSource {
  type?: string | null
  metadata?: string | null
}

export function buildMaterialMediaInfoSummary(
  material: MaterialMediaSource,
): NodeMediaInfoSummary | undefined {
  const kind: NodeMediaInfoSummary['kind'] = material.type === 'video' ? 'video' : 'image'
  const meta = parseMaterialMeta(material.metadata)
  const fromMeta = meta.mediaInfo
  const mediaInfo =
    fromMeta && typeof fromMeta === 'object' ? (fromMeta as MediaInfo) : undefined
  const output = mediaInfo?.output
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

  const { kind: _kind, ...rest } = summary
  const hasPayload = Object.values(rest).some((v) => v != null && v !== '')
  return hasPayload ? summary : undefined
}

export interface AssetMediaSource {
  kind?: 'image' | 'video' | 'audio' | 'other'
  metadata?: string | null
}

export function parseAssetMetadata(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function buildAssetMediaInfoSummary(asset: AssetMediaSource): NodeMediaInfoSummary | undefined {
  if (asset.kind !== 'image' && asset.kind !== 'video') return undefined
  const meta = parseAssetMetadata(asset.metadata)
  const fromMeta = meta.mediaInfo
  const mediaInfo =
    fromMeta && typeof fromMeta === 'object' ? (fromMeta as MediaInfo) : undefined
  const output = mediaInfo?.output
  const kind: NodeMediaInfoSummary['kind'] = asset.kind
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

  const { kind: _kind, ...rest } = summary
  const hasPayload = Object.values(rest).some((v) => v != null && v !== '')
  return hasPayload ? summary : undefined
}

export function useMediaInspector() {
  async function openInspector(next: MediaInspectorTarget) {
    target.value = next
    open.value = true
    error.value = null
    if (!next.generationRecordId) {
      record.value = null
      loading.value = false
      return
    }
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

  function registerLocateNodeHandler(handler: LocateCanvasNodeHandler | null) {
    locateNodeHandler.value = handler
  }

  async function locateCanvasNode() {
    const recordId = record.value?.id || target.value?.generationRecordId
    if (!recordId || !locateNodeHandler.value) return
    const nodeId = target.value?.nodeId ?? record.value?.nodeId
    await locateNodeHandler.value({ recordId, nodeId })
    closeInspector()
  }

  return {
    open,
    loading,
    error,
    target,
    record,
    locateNodeHandler,
    openInspector,
    closeInspector,
    probeMedia,
    invalidateRecordCache,
    registerLocateNodeHandler,
    locateCanvasNode,
  }
}
