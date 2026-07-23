import type { AxiosError } from 'axios'
import { api } from './api'
import { getApiBaseUrl } from './api-base'

export interface UploadResult {
  url: string
  fileName: string
  mimeType: string
  size: number
}

/** 经 Vercel 代理时单请求体约 4.5MB；分片 raw 取 2MB（base64 后仍安全） */
const CHUNK_RAW_BYTES = 2 * 1024 * 1024

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function uploadErrorMessage(err: unknown): string {
  const ax = err as AxiosError<{ message?: string }>
  const status = ax.response?.status
  const msg = ax.response?.data?.message || ax.message || '上传失败'
  if (status === 413) {
    return '文件过大（网关限制约 4.5MB/请求）。请改用分片上传或压缩后再试。'
  }
  if (status === 400 && /multipart|form/i.test(String(msg))) {
    return '上传通道异常，请刷新后重试；若仍失败请缩小文件或联系管理员。'
  }
  return typeof msg === 'string' ? msg : '上传失败'
}

async function uploadMultipart(
  file: File,
  opts?: { onProgress?: (pct: number) => void },
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ code?: number; message?: string; data: UploadResult }>(
    '/upload',
    form,
    {
      onUploadProgress: (e) => {
        if (!opts?.onProgress || !e.total) return
        opts.onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
      },
    },
  )
  if (data.code != null && data.code !== 0) {
    throw new Error(data.message || '上传失败')
  }
  return data.data
}

async function uploadChunked(
  file: File,
  opts?: { onProgress?: (pct: number) => void },
): Promise<UploadResult> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_RAW_BYTES))
  const { data: initRes } = await api.post<{
    code?: number
    data: { uploadId: string; chunkSize: number }
  }>('/upload/init', {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    totalChunks,
  })
  if (initRes.code != null && initRes.code !== 0) {
    throw new Error('初始化分片上传失败')
  }
  const uploadId = initRes.data.uploadId

  for (let index = 0; index < totalChunks; index++) {
    const start = index * CHUNK_RAW_BYTES
    const end = Math.min(file.size, start + CHUNK_RAW_BYTES)
    const slice = file.slice(start, end)
    const buf = await slice.arrayBuffer()
    const b64 = arrayBufferToBase64(buf)
    await api.post('/upload/chunk', { uploadId, index, data: b64 }, { timeout: 120_000 })
    opts?.onProgress?.(Math.min(99, Math.round(((index + 1) / totalChunks) * 100)))
  }

  const { data: done } = await api.post<{ code?: number; message?: string; data: UploadResult }>(
    '/upload/complete',
    { uploadId },
    { timeout: 120_000 },
  )
  if (done.code != null && done.code !== 0) {
    throw new Error(done.message || '合并分片失败')
  }
  opts?.onProgress?.(100)
  return done.data
}

function preferChunked(file: File): boolean {
  const base = getApiBaseUrl()
  // 生产走 Vercel `/api` 代理：一律分片，避开 multipart 破坏与 4.5MB 硬限
  if (base === '/api') return true
  return file.size > 40 * 1024 * 1024
}

export const uploadApi = {
  upload: async (file: File, opts?: { onProgress?: (pct: number) => void }) => {
    try {
      if (preferChunked(file)) {
        return await uploadChunked(file, opts)
      }
      try {
        return await uploadMultipart(file, opts)
      } catch (err) {
        // multipart 仍失败时回退分片（兼容旧代理）
        const status = (err as AxiosError).response?.status
        if (status === 400 || status === 413) {
          return await uploadChunked(file, opts)
        }
        throw err
      }
    } catch (err) {
      throw Object.assign(new Error(uploadErrorMessage(err)), { cause: err })
    }
  },
}
