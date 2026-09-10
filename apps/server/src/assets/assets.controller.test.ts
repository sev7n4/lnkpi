import 'reflect-metadata'
import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AssetsController } from './assets.controller'

describe('AssetsController.persistRemote', () => {
  it('delegates to PersistRemoteService with mapped fields', async () => {
    const persistRemote = vi.fn(async () => ({
      persistedUrl: 'https://cos.example/a.png',
      assetId: 'asset-1',
      storageTier: 'persisted' as const,
    }))
    const controller = new AssetsController({} as never, { persistRemote } as never)

    const result = await controller.persistRemote(
      { user: { sub: 'user-1', phone: '13800000000' } } as never,
      {
        url: 'https://upstream.example/out.png',
        kind: 'image',
        label: 'shot',
        sessionId: 'sess-1',
        nodeId: 'node-a',
        replaceNodeUrl: true,
        generationRecordId: 'gen-1',
      },
    )

    expect(persistRemote).toHaveBeenCalledWith({
      userId: 'user-1',
      url: 'https://upstream.example/out.png',
      kind: 'image',
      label: 'shot',
      sessionId: 'sess-1',
      sourceNodeId: 'node-a',
      replaceNodeUrl: true,
      generationRecordId: 'gen-1',
    })
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: {
        persistedUrl: 'https://cos.example/a.png',
        assetId: 'asset-1',
        storageTier: 'persisted',
      },
    })
  })

  it('prefers sourceNodeId over nodeId alias', async () => {
    const persistRemote = vi.fn(async () => ({
      persistedUrl: 'https://cos.example/a.png',
      assetId: 'asset-1',
      storageTier: 'persisted' as const,
    }))
    const controller = new AssetsController({} as never, { persistRemote } as never)

    await controller.persistRemote(
      { user: { sub: 'user-1', phone: '13800000000' } } as never,
      {
        url: 'https://upstream.example/out.png',
        kind: 'image',
        sourceNodeId: 'node-primary',
        nodeId: 'node-alias',
      },
    )

    expect(persistRemote).toHaveBeenCalledWith(
      expect.objectContaining({ sourceNodeId: 'node-primary' }),
    )
  })

  it('propagates 503 when storage adapter is unconfigured', async () => {
    const persistRemote = vi.fn(async () => {
      throw new ServiceUnavailableException('对象存储未配置')
    })
    const controller = new AssetsController({} as never, { persistRemote } as never)

    await expect(
      controller.persistRemote(
        { user: { sub: 'user-1', phone: '13800000000' } } as never,
        {
          url: 'https://upstream.example/out.png',
          kind: 'image',
        },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
