import { ServiceUnavailableException } from '@nestjs/common'
import { createStorageAdapterFromEnv } from './storage.module'
import { UnconfiguredStorageAdapter } from './unconfigured.storage-adapter'
import { Readable } from 'stream'

describe('StorageAdapter factory', () => {
  const prev = { ...process.env }

  afterEach(() => {
    process.env = { ...prev }
  })

  it('returns UnconfiguredStorageAdapter when env missing', () => {
    delete process.env.OBJECT_STORAGE_ENDPOINT
    delete process.env.OBJECT_STORAGE_BUCKET
    delete process.env.OBJECT_STORAGE_ACCESS_KEY
    delete process.env.OBJECT_STORAGE_SECRET_KEY
    const adapter = createStorageAdapterFromEnv()
    expect(adapter).toBeInstanceOf(UnconfiguredStorageAdapter)
  })

  it('returns S3CompatibleStorageAdapter when env complete', () => {
    process.env.OBJECT_STORAGE_ENDPOINT = 'https://cos.example'
    process.env.OBJECT_STORAGE_BUCKET = 'b'
    process.env.OBJECT_STORAGE_ACCESS_KEY = 'ak'
    process.env.OBJECT_STORAGE_SECRET_KEY = 'sk'
    const adapter = createStorageAdapterFromEnv()
    expect(adapter.constructor.name).toBe('S3CompatibleStorageAdapter')
  })

  it('Unconfigured putStream throws 503', async () => {
    const adapter = new UnconfiguredStorageAdapter()
    await expect(
      adapter.putStream({
        key: 'users/u/assets/2026/x.png',
        body: Readable.from([Buffer.from('x')]),
        contentType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
