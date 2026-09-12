import { describe, expect, it, vi } from 'vitest'
import { S3CompatibleStorageAdapter } from './s3-compatible.storage-adapter'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put'),
}))

describe('S3CompatibleStorageAdapter.presignPut', () => {
  it('returns putUrl, Content-Type header, and publicUrl', async () => {
    const adapter = new S3CompatibleStorageAdapter({
      endpoint: 'https://cos.example',
      bucket: 'b',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      publicBaseUrl: 'https://cdn.example',
    })
    const out = await adapter.presignPut!({
      key: 'uploads/u1/a.png',
      contentType: 'image/png',
      expiresInSeconds: 600,
    })
    expect(out.putUrl).toBe('https://signed.example/put')
    expect(out.headers['Content-Type']).toBe('image/png')
    expect(out.publicUrl).toBe('https://cdn.example/uploads/u1/a.png')
    expect(Date.parse(out.expiresAt)).toBeGreaterThan(Date.now())
  })
})
