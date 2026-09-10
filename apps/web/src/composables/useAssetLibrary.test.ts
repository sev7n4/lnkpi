import type { AxiosResponse } from 'axios'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { saveAssetToLibrary } from './useAssetLibrary'
import { assetsApi } from '@/services/assets-api'

vi.mock('@/services/assets-api', () => ({
  assetsApi: {
    persistRemote: vi.fn(),
    saveMine: vi.fn(),
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function mockAxiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as AxiosResponse<T>['config'] }
}

describe('saveAssetToLibrary', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't')
    vi.mocked(assetsApi.persistRemote).mockReset()
    vi.mocked(assetsApi.saveMine).mockReset()
  })

  it('persists upstream https urls', async () => {
    vi.mocked(assetsApi.persistRemote).mockResolvedValue(
      mockAxiosResponse({
        code: 0,
        data: { persistedUrl: 'https://cos/x', assetId: 'a1', storageTier: 'persisted' },
      }) as never,
    )
    await saveAssetToLibrary({ kind: 'image', url: 'https://cdn.example/a.png', label: 'a' })
    expect(assetsApi.persistRemote).toHaveBeenCalledWith({
      url: 'https://cdn.example/a.png',
      kind: 'image',
      label: 'a',
      sourceNodeId: undefined,
      sessionId: undefined,
      replaceNodeUrl: undefined,
      generationRecordId: undefined,
    })
    expect(assetsApi.saveMine).not.toHaveBeenCalled()
  })

  it('saveMine directly for /api/uploads/', async () => {
    vi.mocked(assetsApi.saveMine).mockResolvedValue(
      mockAxiosResponse({ code: 0, data: {} }) as never,
    )
    await saveAssetToLibrary({ kind: 'image', url: '/api/uploads/u/a.png' })
    expect(assetsApi.saveMine).toHaveBeenCalledWith({ kind: 'image', url: '/api/uploads/u/a.png' })
    expect(assetsApi.persistRemote).not.toHaveBeenCalled()
  })
})
