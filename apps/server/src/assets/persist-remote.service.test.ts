import 'reflect-metadata'
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { Readable } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService, openDownloadStream } from '../media/media.service'
import { STORAGE_ADAPTER } from '../storage/storage.adapter'
import { PersistRemoteService } from './persist-remote.service'
import { parseUserAssetMetadata } from './build-user-asset-metadata'

vi.mock('../media/media.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media/media.service')>()
  return {
    ...actual,
    openDownloadStream: vi.fn(),
  }
})

describe('PersistRemoteService', () => {
  let service: PersistRemoteService
  const resolveDownloadSource = vi.fn()
  const putStream = vi.fn()
  const userAssetUpsert = vi.fn()
  const userAssetDeleteMany = vi.fn()
  const sessionFindFirst = vi.fn()
  const sessionUpdate = vi.fn()
  const generationFindFirst = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    userAssetUpsert.mockResolvedValue({ id: 'asset-1', url: '/api/uploads/u1/a.png' })
    userAssetDeleteMany.mockResolvedValue({ count: 0 })
    generationFindFirst.mockResolvedValue(null)

    const moduleRef = await Test.createTestingModule({
      providers: [
        PersistRemoteService,
        {
          provide: MediaService,
          useValue: { resolveDownloadSource },
        },
        {
          provide: STORAGE_ADAPTER,
          useValue: { putStream },
        },
        {
          provide: PrismaService,
          useValue: {
            userAsset: {
              upsert: userAssetUpsert,
              deleteMany: userAssetDeleteMany,
            },
            session: {
              findFirst: sessionFindFirst,
              update: sessionUpdate,
            },
            generationRecord: {
              findFirst: generationFindFirst,
            },
          },
        },
      ],
    }).compile()

    service = moduleRef.get(PersistRemoteService)
  })

  it('skips object storage for /api/uploads/ and upserts as upload tier', async () => {
    const url = '/api/uploads/u1/a.png'
    userAssetUpsert.mockResolvedValue({ id: 'asset-upload', url })

    const result = await service.persistRemote({
      userId: 'u1',
      url,
      kind: 'image',
      label: 'shot',
    })

    expect(putStream).not.toHaveBeenCalled()
    expect(resolveDownloadSource).not.toHaveBeenCalled()
    expect(userAssetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_url: { userId: 'u1', url } },
        create: expect.objectContaining({
          userId: 'u1',
          url,
          kind: 'image',
          label: 'shot',
        }),
      }),
    )
    const createMeta = parseUserAssetMetadata(userAssetUpsert.mock.calls[0][0].create.metadata)
    expect(createMeta.storageTier).toBe('upload')
    expect(result).toEqual({
      persistedUrl: url,
      assetId: 'asset-upload',
      storageTier: 'upload',
    })
  })

  it('streams remote url through adapter and upserts persisted', async () => {
    const original = 'https://platform-outputs.example/out.png'
    const publicUrl = 'https://cos.example/users/u1/assets/2026/abc.png'
    resolveDownloadSource.mockResolvedValue({
      kind: 'remote',
      fetchUrl: original,
      filename: 'out.png',
    })
    vi.mocked(openDownloadStream).mockResolvedValue({
      body: Readable.from([Buffer.from('png')]),
      contentType: 'image/png',
      contentLength: 3,
    })
    putStream.mockResolvedValue({ publicUrl })
    userAssetUpsert.mockResolvedValue({ id: 'asset-persisted', url: publicUrl })

    const result = await service.persistRemote({
      userId: 'u1',
      url: original,
      kind: 'image',
      sessionId: 'sess-1',
    })

    expect(resolveDownloadSource).toHaveBeenCalledWith('u1', original, undefined, 'sess-1')
    expect(openDownloadStream).toHaveBeenCalled()
    expect(putStream).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^users\/u1\/assets\/\d{4}\/.+\.png$/),
        contentType: 'image/png',
        contentLength: 3,
      }),
    )
    expect(userAssetDeleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', url: original },
    })
    const createMeta = parseUserAssetMetadata(userAssetUpsert.mock.calls[0][0].create.metadata)
    expect(createMeta.storageTier).toBe('persisted')
    expect(createMeta.upstreamUrl).toBe(original)
    expect(createMeta.objectKey).toMatch(/^users\/u1\/assets\/\d{4}\/.+\.png$/)
    expect(result).toEqual({
      persistedUrl: publicUrl,
      assetId: 'asset-persisted',
      storageTier: 'persisted',
    })
  })

  it('propagates 503 when adapter unconfigured', async () => {
    const original = 'https://platform-outputs.example/out.png'
    resolveDownloadSource.mockResolvedValue({
      kind: 'remote',
      fetchUrl: original,
      filename: 'out.png',
    })
    vi.mocked(openDownloadStream).mockResolvedValue({
      body: Readable.from([Buffer.from('png')]),
      contentType: 'image/png',
    })
    putStream.mockRejectedValue(new ServiceUnavailableException('对象存储未配置'))

    await expect(
      service.persistRemote({ userId: 'u1', url: original, kind: 'image' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)

    expect(userAssetUpsert).not.toHaveBeenCalled()
  })

  it('replaceNodeUrl=true rewrites matching node data.url in session canvasData', async () => {
    const original = 'https://platform-outputs.example/out.png'
    const publicUrl = 'https://cos.example/users/u1/assets/2026/abc.png'
    resolveDownloadSource.mockResolvedValue({
      kind: 'remote',
      fetchUrl: original,
      filename: 'out.png',
    })
    vi.mocked(openDownloadStream).mockResolvedValue({
      body: Readable.from([Buffer.from('png')]),
      contentType: 'image/png',
    })
    putStream.mockResolvedValue({ publicUrl })
    userAssetUpsert.mockResolvedValue({ id: 'asset-persisted', url: publicUrl })
    sessionFindFirst.mockResolvedValue({
      id: 'sess-1',
      userId: 'u1',
      canvasData: JSON.stringify({
        nodes: [
          { id: 'node-a', data: { url: original } },
          { id: 'node-b', data: { url: 'https://other.example/x.png' } },
        ],
      }),
    })
    sessionUpdate.mockResolvedValue({})

    await service.persistRemote({
      userId: 'u1',
      url: original,
      kind: 'image',
      sessionId: 'sess-1',
      sourceNodeId: 'node-a',
      replaceNodeUrl: true,
    })

    expect(sessionFindFirst).toHaveBeenCalledWith({
      where: { id: 'sess-1', userId: 'u1' },
    })
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: {
        canvasData: expect.any(String),
      },
    })
    const updated = JSON.parse(sessionUpdate.mock.calls[0][0].data.canvasData)
    expect(updated.nodes[0].data.url).toBe(publicUrl)
    expect(updated.nodes[0].data.upstreamUrl).toBe(original)
    expect(updated.nodes[0].data.storageTier).toBe('persisted')
    expect(updated.nodes[1].data.url).toBe('https://other.example/x.png')
  })

  it('rejects upload path owned by another user', async () => {
    await expect(
      service.persistRemote({
        userId: 'u2',
        url: '/api/uploads/u1/a.png',
        kind: 'image',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(putStream).not.toHaveBeenCalled()
    expect(userAssetUpsert).not.toHaveBeenCalled()
  })
})
