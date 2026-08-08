import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiUrl, resolveMediaUrl } from '@/services/api-base'

export type FileNodeKind = 'text' | 'image' | 'video' | 'audio'

export interface MediaFilePayload {
  url: string
  fileName: string
  mimeType: string
  kind: FileNodeKind | 'other'
  textContent?: string
}

export interface DownloadMediaOptions {
  sessionId?: string
}

export const UPSTREAM_MEDIA_DOWNLOAD_HINT = '第三方链接，可能过期，请及时下载'
export const GENERATION_SAVE_LOCAL_HINT = '生成完成，建议立即下载到本机保存'

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'html', 'htm', 'xml', 'log'])
const REVOKE_OBJECT_URL_DELAY_MS = 1000

function extensionOf(name: string) {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

export function isUpstreamMediaUrl(url: string): boolean {
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) && !trimmed.includes('/api/uploads/')
}

export function detectFileKind(file: File): MediaFilePayload['kind'] {
  const mime = file.type || ''
  if (mime.startsWith('text/')) return 'text'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'

  const ext = extensionOf(file.name)
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio'
  return 'other'
}

export async function fileToMediaPayload(file: File): Promise<MediaFilePayload> {
  const kind = detectFileKind(file)
  const payload: MediaFilePayload = {
    url: URL.createObjectURL(file),
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    kind,
  }
  if (kind === 'text') {
    payload.textContent = await file.text()
  }
  return payload
}

export async function clipboardItemToMediaPayload(item: DataTransferItem): Promise<MediaFilePayload | null> {
  const file = item.getAsFile()
  if (file) return fileToMediaPayload(file)
  return null
}

export function assetKindToNodeKind(kind: string): FileNodeKind | null {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  return null
}

export function collectMediaFromNodes(
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>,
  ids: string[],
) {
  const idSet = new Set(ids)
  const items: Array<{ nodeId: string; url: string; fileName: string; kind: string }> = []
  for (const node of nodes) {
    if (!idSet.has(node.id)) continue
    const data = node.data
    const url = String(data.url ?? '').trim()
    if (!url) continue
    const type = String(node.type ?? '')
    const title = String(data.title ?? data.fileName ?? data.prompt ?? node.id)
    const ext = url.includes('.mp4') ? 'mp4' : url.includes('.webm') ? 'webm' : url.includes('.png') ? 'png' : 'jpg'
    items.push({
      nodeId: node.id,
      url,
      fileName: `${title.slice(0, 32).replace(/[/\\?%*:|"<>]/g, '_')}-${node.id.slice(0, 8)}.${ext}`,
      kind: type,
    })
  }
  return items
}

export async function downloadMediaPackage(
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>,
  selectedIds: string[],
  opts?: DownloadMediaOptions,
) {
  const items = collectMediaFromNodes(nodes, selectedIds)
  if (!items.length) return 0

  const manifest = {
    exportedAt: new Date().toISOString(),
    count: items.length,
    items: items.map((item) => ({ ...item })),
  }
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  triggerDownload(manifestBlob, `lnkpi-export-${Date.now()}.json`)

  for (const item of items) {
    try {
      await downloadMediaFile(item.url, item.fileName, opts)
      await delay(280)
    } catch {
      // continue remaining items
    }
  }
  return items.length
}

function triggerDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_OBJECT_URL_DELAY_MS)
}

/** 下载单个媒体文件；经鉴权 stream-download 代理，不再 window.open 假下载 */
export async function downloadMediaFile(
  url: string,
  filename: string,
  opts?: DownloadMediaOptions,
) {
  const resolved = resolveMediaUrl(url.trim())
  if (!resolved) return

  if (/^(blob:|data:)/i.test(resolved)) {
    const res = await fetch(resolved)
    triggerDownload(await res.blob(), filename)
    return
  }

  const token = localStorage.getItem('token')
  if (!token) {
    ElMessage.warning('请先登录后再下载')
    return
  }

  const params = new URLSearchParams({ url: resolved, filename })
  if (opts?.sessionId) params.set('sessionId', opts.sessionId)

  const res = await fetch(apiUrl(`/media/stream-download?${params.toString()}`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    ElMessage.warning('下载失败，链接可能已过期，请稍后重试')
    return
  }
  triggerDownload(await res.blob(), filename)
}

const EXT_BY_KIND: Record<string, string> = { image: 'png', video: 'mp4', audio: 'mp3' }

/** 由 URL / label 推导下载文件名 */
export function mediaDownloadName(url: string, kind: string, label?: string) {
  const urlExt = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)?.[1]
  const ext = urlExt ?? EXT_BY_KIND[kind] ?? 'bin'
  const base = (label ?? 'lnkpi-media').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 48) || 'lnkpi-media'
  return base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? base : `${base}.${ext}`
}

export function notifyGenerationSaveLocalHint() {
  ElMessage.success({ message: GENERATION_SAVE_LOCAL_HINT, duration: 5000 })
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function setupCanvasMediaHandlers(
  container: Ref<HTMLElement | null>,
  onMedia: (file: File, clientPos: { x: number; y: number }) => void | Promise<void>,
) {
  function onDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  async function onDrop(event: DragEvent) {
    const files = event.dataTransfer?.files
    if (!files?.length) return
    event.preventDefault()
    const file = files[0]
    await onMedia(file, { x: event.clientX, y: event.clientY })
  }

  async function onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items
    if (!items?.length) return
    for (const item of items) {
      if (
        !item.type.startsWith('image/')
        && !item.type.startsWith('video/')
        && !item.type.startsWith('audio/')
        && !item.type.startsWith('text/')
      ) continue
      const file = item.getAsFile()
      if (!file) continue
      event.preventDefault()
      const rect = container.value?.getBoundingClientRect()
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      await onMedia(file, { x, y })
      break
    }
  }

  return { onDragOver, onDrop, onPaste }
}
