import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { api } from './api'
import { shouldPreferChunkedUpload, uploadApi } from './upload-api'

vi.mock('./api', () => ({
  api: {
    post: vi.fn(),
  },
}))

const apiPost = api.post as unknown as ReturnType<typeof vi.fn>

function presignCredential(overrides?: Partial<{
  putUrl: string
  publicUrl: string
  headers: Record<string, string>
}>) {
  return {
    code: 0,
    data: {
      mode: 'presign' as const,
      key: 'uploads/u/a.png',
      putUrl: overrides?.putUrl ?? 'https://signed.example/put',
      headers: overrides?.headers ?? { 'Content-Type': 'image/png' },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      publicUrl: overrides?.publicUrl ?? 'https://cdn.example/uploads/u/a.png',
    },
  }
}

describe('shouldPreferChunkedUpload', () => {
  const originalHostname = window.location.hostname

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: { hostname: originalHostname },
      writable: true,
    })
  })

  it('uses chunked upload on Vercel hosts', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'lnkpi-web.vercel.app' },
      writable: true,
    })
    const small = new File(['x'], 'a.png', { type: 'image/png' })
    expect(shouldPreferChunkedUpload(small)).toBe(true)
  })

  it('uses multipart for small files on localhost', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    })
    const small = new File(['x'], 'a.png', { type: 'image/png' })
    expect(shouldPreferChunkedUpload(small)).toBe(false)
  })

  it('uses chunked upload for files larger than 40MB everywhere', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    })
    const huge = new File([new Uint8Array(41 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' })
    expect(shouldPreferChunkedUpload(huge)).toBe(true)
  })
})

describe('uploadApi.upload direct credential', () => {
  beforeEach(() => {
    apiPost.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs to putUrl when credential mode is presign', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    apiPost.mockImplementation(async (url: string) => {
      if (url === '/upload/direct-credential') {
        return { data: presignCredential() }
      }
      throw new Error(`unexpected api.post ${url}`)
    })

    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const result = await uploadApi.upload(file)

    expect(result.url).toBe('https://cdn.example/uploads/u/a.png')
    expect(result.fileName).toBe('a.png')
    expect(result.mimeType).toBe('image/png')
    expect(result.size).toBe(3)
    expect(apiPost).toHaveBeenCalledWith(
      '/upload/direct-credential',
      expect.objectContaining({
        fileName: 'a.png',
        mimeType: 'image/png',
        size: 3,
      }),
    )
    expect(apiPost).not.toHaveBeenCalledWith('/upload', expect.anything(), expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://signed.example/put',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
        body: file,
      }),
    )
  })

  it('falls back to multipart when mode is local', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    })

    apiPost.mockImplementation(async (url: string) => {
      if (url === '/upload/direct-credential') {
        return { data: { code: 0, data: { mode: 'local' } } }
      }
      if (url === '/upload') {
        return {
          data: {
            code: 0,
            data: {
              url: 'https://api.example/uploads/a.png',
              fileName: 'a.png',
              mimeType: 'image/png',
              size: 3,
            },
          },
        }
      }
      throw new Error(`unexpected api.post ${url}`)
    })

    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const result = await uploadApi.upload(file)

    expect(result.url).toBe('https://api.example/uploads/a.png')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(apiPost.mock.calls.map((c) => c[0])).toEqual(['/upload/direct-credential', '/upload'])
    expect(apiPost).toHaveBeenCalledWith('/upload', expect.any(FormData), expect.anything())
  })

  it('re-fetches credential and retries PUT once on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    apiPost
      .mockResolvedValueOnce({
        data: presignCredential({ putUrl: 'https://signed.example/put-1' }),
      })
      .mockResolvedValueOnce({
        data: presignCredential({
          putUrl: 'https://signed.example/put-2',
          publicUrl: 'https://cdn.example/uploads/u/a-retry.png',
        }),
      })

    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const result = await uploadApi.upload(file)

    expect(result.url).toBe('https://cdn.example/uploads/u/a-retry.png')
    expect(apiPost).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://signed.example/put-1',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://signed.example/put-2',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
