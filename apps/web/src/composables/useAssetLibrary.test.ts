import type { AxiosResponse } from 'axios'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
  ASSET_LIBRARY_LABEL_MAX,
  resolveAssetLibraryLabel,
  saveAssetToLibrary,
} from './useAssetLibrary'
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

describe('resolveAssetLibraryLabel', () => {
  it('prefers short label over prompt', () => {
    expect(
      resolveAssetLibraryLabel({ kind: 'image', label: '产品图', prompt: '很长的提示词'.repeat(20) }),
    ).toBe('产品图')
  })

  it('falls back to prompt then kind default', () => {
    expect(resolveAssetLibraryLabel({ kind: 'image', prompt: '  抠图  ' })).toBe('抠图')
    expect(resolveAssetLibraryLabel({ kind: 'video' })).toBe('视频')
    expect(resolveAssetLibraryLabel({ kind: 'audio', label: '' })).toBe('音频')
  })

  it('truncates to 128 chars (not filename semantics)', () => {
    const long = '为这个图片创作广告图'.repeat(20)
    const resolved = resolveAssetLibraryLabel({ kind: 'image', prompt: long })
    expect(resolved.length).toBe(ASSET_LIBRARY_LABEL_MAX)
    expect(resolved).toBe(long.slice(0, ASSET_LIBRARY_LABEL_MAX))
  })
})

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
    expect(assetsApi.saveMine).toHaveBeenCalledWith({
      kind: 'image',
      url: '/api/uploads/u/a.png',
      label: '图片',
    })
    expect(assetsApi.persistRemote).not.toHaveBeenCalled()
  })

  it('truncates long prompt used as title before saveMine', async () => {
    vi.mocked(assetsApi.saveMine).mockResolvedValue(
      mockAxiosResponse({ code: 0, data: {} }) as never,
    )
    const longPrompt = '为这个图片创作精致品牌广告推广图画面'.repeat(10)
    expect(longPrompt.length).toBeGreaterThan(ASSET_LIBRARY_LABEL_MAX)
    await saveAssetToLibrary({
      kind: 'image',
      url: '/api/uploads/u/a.png',
      prompt: longPrompt,
    })
    expect(assetsApi.saveMine).toHaveBeenCalledWith({
      kind: 'image',
      url: '/api/uploads/u/a.png',
      label: longPrompt.slice(0, ASSET_LIBRARY_LABEL_MAX),
    })
  })
})
