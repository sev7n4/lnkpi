import { uploadApi } from '@/services/upload-api'
import { resolveMediaUrl } from '@/services/api-base'
import { detectFileKind, type MediaFilePayload } from '@/composables/useCanvasMedia'

/** 有 token 时上传到服务端，失败则抛错；未登录时返回 fallbackUrl */
export async function persistMediaUrl(
  file: File,
  fallbackUrl: string,
  opts?: { onProgress?: (pct: number) => void; allowBlobFallback?: boolean },
): Promise<string> {
  const token = localStorage.getItem('token')
  if (!token) return fallbackUrl

  const allowBlobFallback = opts?.allowBlobFallback ?? false

  try {
    const result = await uploadApi.upload(file, { onProgress: opts?.onProgress })
    if (!result?.url) {
      throw new Error('上传失败')
    }
    return resolveMediaUrl(result.url)
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
