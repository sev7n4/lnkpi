import { BadRequestException } from '@nestjs/common'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import {
  LocalFilesystemStorageAdapter,
  resolveUploadTarget,
} from './local-filesystem.storage-adapter'

describe('resolveUploadTarget', () => {
  it('maps users/{id}/assets/{year}/{file} to flat upload target', () => {
    expect(resolveUploadTarget('users/u1/assets/2026/abc.png')).toEqual({
      userId: 'u1',
      fileName: 'abc.png',
    })
  })

  it('rejects path traversal / malformed keys', () => {
    expect(() => resolveUploadTarget('../etc/passwd')).toThrow(BadRequestException)
    expect(() => resolveUploadTarget('users/u1/assets/2026/../x.png')).toThrow(BadRequestException)
  })
})

describe('LocalFilesystemStorageAdapter', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'lnkpi-local-storage-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('writes stream under uploads/{userId}/{file} and returns /api/uploads url', async () => {
    const adapter = new LocalFilesystemStorageAdapter({ rootDir })
    const { publicUrl } = await adapter.putStream({
      key: 'users/u1/assets/2026/deadbeef.png',
      body: Readable.from([Buffer.from('png-bytes')]),
      contentType: 'image/png',
    })
    expect(publicUrl).toBe('/api/uploads/u1/deadbeef.png')
    const written = await readFile(join(rootDir, 'u1', 'deadbeef.png'))
    expect(written.toString()).toBe('png-bytes')
  })

  it('prefixes API_PUBLIC_URL when configured', async () => {
    const adapter = new LocalFilesystemStorageAdapter({
      rootDir,
      publicBaseUrl: 'http://119.29.173.89:8888',
    })
    const { publicUrl } = await adapter.putStream({
      key: 'users/u2/assets/2026/aa.bin',
      body: Readable.from([Buffer.from('x')]),
      contentType: 'application/octet-stream',
    })
    expect(publicUrl).toBe('http://119.29.173.89:8888/api/uploads/u2/aa.bin')
  })
})
