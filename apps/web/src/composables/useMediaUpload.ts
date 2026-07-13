import { uploadApi } from '@/services/upload-api'
import { resolveMediaUrl } from '@/services/api-base'
import { detectFileKind, type MediaFilePayload } from '@/composables/useCanvasMedia'

/** 登录态下上传到服务端，失败或未登录时保留 blob URL */
export async function persistMediaUrl(file: File, fallbackUrl: string): Promise<string> {
  const token = localStorage.getItem('token')
  if (!token) return fallbackUrl
  try {
    const { data } = await uploadApi.upload(file)
    return resolveMediaUrl(data.data.url)
  } catch {
    return fallbackUrl
  }
}

export async function fileToPersistedPayload(file: File): Promise<MediaFilePayload> {
  const kind = detectFileKind(file)
  const blobUrl = URL.createObjectURL(file)
  const url = await persistMediaUrl(file, blobUrl)
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
