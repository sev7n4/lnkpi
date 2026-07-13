import { api } from './api'

export interface UploadResult {
  url: string
  fileName: string
  mimeType: string
  size: number
}

export const uploadApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ data: UploadResult }>('/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}
