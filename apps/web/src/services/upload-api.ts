import { api } from './api'

export interface UploadResult {
  url: string
  fileName: string
  mimeType: string
  size: number
}

export const uploadApi = {
  upload: (file: File, opts?: { onProgress?: (pct: number) => void }) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ code?: number; message?: string; data: UploadResult }>('/upload', form, {
      onUploadProgress: (e) => {
        if (!opts?.onProgress || !e.total) return
        opts.onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
      },
    })
  },
}
