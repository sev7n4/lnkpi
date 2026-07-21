import type { Ref } from 'vue'
import { resolveMediaUrl } from '@/services/api-base'

export type FileNodeKind = 'text' | 'image' | 'video' | 'audio'

export interface MediaFilePayload {
  url: string
  fileName: string
  mimeType: string
  kind: FileNodeKind | 'other'
  textContent?: string
}

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'html', 'htm', 'xml', 'log'])

function extensionOf(name: string) {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return ''
  return name.slice(idx + 1).toLowerCase()
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
      const res = await fetch(resolveMediaUrl(item.url))
      const blob = await res.blob()
      triggerDownload(blob, item.fileName)
      await delay(280)
    } catch {
      // blob/data URLs may fail cross-origin — skip
    }
  }
  return items.length
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 下载单个媒体文件；跨域 fetch 失败时退化为新标签页打开 */
export async function downloadMediaFile(url: string, filename: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    triggerDownload(await res.blob(), filename)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

const EXT_BY_KIND: Record<string, string> = { image: 'png', video: 'mp4', audio: 'mp3' }

/** 由 URL / label 推导下载文件名 */
export function mediaDownloadName(url: string, kind: string, label?: string) {
  const urlExt = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)?.[1]
  const ext = urlExt ?? EXT_BY_KIND[kind] ?? 'bin'
  const base = (label ?? 'lnkpi-media').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 48) || 'lnkpi-media'
  return base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? base : `${base}.${ext}`
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
