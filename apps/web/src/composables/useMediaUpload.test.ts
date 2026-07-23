import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistMediaUrl } from './useMediaUpload'

vi.mock('@/services/upload-api', () => ({
  uploadApi: { upload: vi.fn() },
}))
vi.mock('@/services/api-base', () => ({
  resolveMediaUrl: (u: string) => u,
}))

import { uploadApi } from '@/services/upload-api'

describe('persistMediaUrl', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't')
    vi.mocked(uploadApi.upload).mockReset()
  })

  it('throws when upload returns empty url', async () => {
    vi.mocked(uploadApi.upload).mockResolvedValue({
      url: '',
      fileName: 'a.png',
      mimeType: 'image/png',
      size: 1,
    })
    await expect(persistMediaUrl(new File(['x'], 'a.png'), 'blob:x')).rejects.toThrow(/上传/)
  })

  it('throws when logged-in upload network-fails (no blob fallback)', async () => {
    vi.mocked(uploadApi.upload).mockRejectedValue(new Error('Network Error'))
    await expect(persistMediaUrl(new File(['x'], 'a.png'), 'blob:x')).rejects.toThrow()
  })

  it('returns server url on success', async () => {
    vi.mocked(uploadApi.upload).mockResolvedValue({
      url: '/uploads/u/a.png',
      fileName: 'a.png',
      mimeType: 'image/png',
      size: 1,
    })
    await expect(persistMediaUrl(new File(['x'], 'a.png'), 'blob:x')).resolves.toBe('/uploads/u/a.png')
  })
})
