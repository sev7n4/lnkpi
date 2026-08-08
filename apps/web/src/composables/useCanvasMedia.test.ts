import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadMediaFile,
  isUpstreamMediaUrl,
  UPSTREAM_MEDIA_DOWNLOAD_HINT,
} from './useCanvasMedia'

vi.mock('@/services/api-base', () => ({
  apiUrl: (path: string) => `/api${path}`,
  resolveMediaUrl: (url: string) => url,
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn(),
    success: vi.fn(),
  },
}))

describe('isUpstreamMediaUrl', () => {
  it('detects third-party CDN urls', () => {
    expect(isUpstreamMediaUrl('https://platform-outputs.example/out.png')).toBe(true)
  })

  it('treats lnkpi uploads as local', () => {
    expect(isUpstreamMediaUrl('http://119.29.173.89:8888/api/uploads/u/a.png')).toBe(false)
  })
})

describe('downloadMediaFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let openMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    })
    openMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('open', openMock)
    localStorage.setItem('token', 'test-token')
    // jsdom may lack createObjectURL — assign directly for download tests
    ;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(
      () => 'blob:mock',
    )
    ;(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches blob via stream-download API', async () => {
    await downloadMediaFile('https://cdn.example/a.png', 'a.png', { sessionId: 'sess-1' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/api/media/stream-download?')
    expect(calledUrl).toContain('sessionId=sess-1')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('does not call window.open on failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
    await downloadMediaFile('https://cdn.example/a.png', 'a.png')
    expect(openMock).not.toHaveBeenCalled()
  })
})

describe('UPSTREAM_MEDIA_DOWNLOAD_HINT', () => {
  it('has expiry copy', () => {
    expect(UPSTREAM_MEDIA_DOWNLOAD_HINT).toMatch(/过期/)
  })
})
