import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { DirectUploadService } from './direct-upload.service'

describe('DirectUploadService', () => {
  const presignPut = vi.fn()
  let svc: DirectUploadService

  beforeEach(() => {
    presignPut.mockReset()
    svc = new DirectUploadService(
      { presignPut } as any,
      () => true, // isConfigured
    )
  })

  it('rejects oversize', async () => {
    await expect(
      svc.createCredential('u1', {
        fileName: 'a.png',
        mimeType: 'image/png',
        size: 51 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('returns local when storage not configured', async () => {
    svc = new DirectUploadService({} as any, () => false)
    await expect(
      svc.createCredential('u1', { fileName: 'a.png', mimeType: 'image/png', size: 10 }),
    ).resolves.toEqual({ mode: 'local' })
  })

  it('presigns with user-scoped key', async () => {
    presignPut.mockResolvedValue({
      putUrl: 'https://put',
      headers: { 'Content-Type': 'image/png' },
      publicUrl: 'https://cdn/x',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })
    const out = await svc.createCredential('user-42', {
      fileName: 'shot.PNG',
      mimeType: 'image/png',
      size: 100,
    })
    expect(out.mode).toBe('presign')
    if (out.mode === 'presign') {
      expect(out.key.startsWith('uploads/user-42/')).toBe(true)
      expect(out.key.endsWith('.png') || out.key.endsWith('.PNG')).toBe(true)
      expect(out.putUrl).toBe('https://put')
    }
    expect(presignPut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png', expiresInSeconds: 600 }),
    )
  })
})
