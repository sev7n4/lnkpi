import { uploadApi } from '@/services/upload-api'
import { resolveMediaUrl } from '@/services/api-base'
import { detectFileKind, type MediaFilePayload } from '@/composables/useCanvasMedia'

/** 登录态下上传到服务端，失败或未登录时保留 blob URL */
export async function persistMediaUrl(
  file: File,
  fallbackUrl: string,
  opts?: { onProgress?: (pct: number) => void; allowBlobFallback?: boolean },
): Promise<string> {
  const token = localStorage.getItem('token')
  if (!token) return fallbackUrl

  const allowBlobFallback = opts?.allowBlobFallback ?? false

  try {
    const { data } = await uploadApi.upload(file, { onProgress: opts?.onProgress })
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(data.message || '上传失败')
    }
    if (!data.data?.url) {
      throw new Error(data.message || '上传失败')
    }
    return resolveMediaUrl(data.data.url)
  } catch (err) {
    if (allowBlobFallback) return fallbackUrl
    throw err
  }
}

export async function fileToPersistedPayload(
  file: File,
  opts?: { onProgress?: (pct: number) => void; allowBlobFallback?: boolean },
): Promise<MediaFilePayload> {
  const kind = detectFileKind(file)
  const blobUrl = URL.createObjectURL(file)
  const url = await persistMediaUrl(file, blobUrl, opts)
  const payload: MediaFilePayload = {
    url,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    kind,
  }
  if (kind === 'text') {
    payload.textContent = await file.text()
  }
  return payload
}

export type MediaInputKind = 'image' | 'video' | 'audio'

export function inferMediaInputKind(mimeType: string, url: string): MediaInputKind {
  if (mimeType.startsWith('video/') || /\.(mp4|webm|mov)(\?|$)/i.test(url)) return 'video'
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url)) return 'audio'
  return 'image'
}
