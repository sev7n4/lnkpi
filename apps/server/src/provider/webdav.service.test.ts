import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { WebdavService } from './webdav.service'

describe('WebdavService', () => {
  let svc: WebdavService

  beforeEach(() => {
    svc = new WebdavService()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects intranet WebDAV URLs (SSRF)', async () => {
    await expect(
      svc.testConnection({
        url: 'https://127.0.0.1/webdav',
        directory: 'lnkpi',
        username: 'u',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    await expect(
      svc.uploadJson(
        {
          url: 'https://192.168.1.10/dav',
          directory: 'lnkpi',
          username: 'u',
          password: 'secret',
        },
        'sessions.json',
        { sessions: [] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects path traversal in directory', async () => {
    await expect(
      svc.testConnection({
        url: 'https://dav.example.com/webdav',
        directory: '../etc',
        username: 'u',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('PROPFIND test uses Basic auth and does not follow redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 207,
      ok: true,
    })
    vi.stubGlobal('fetch', fetchMock)

    await svc.testConnection({
      url: 'https://dav.example.com/webdav',
      directory: 'lnkpi',
      username: 'alice',
      password: 'p@ss',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(target.toString()).toContain('dav.example.com')
    expect(init.method).toBe('PROPFIND')
    expect(init.redirect).toBe('manual')
    const auth = (init.headers as Record<string, string>).Authorization
    expect(auth).toBe(`Basic ${Buffer.from('alice:p@ss').toString('base64')}`)
  })

  it('falls back to OPTIONS when PROPFIND is not allowed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 405, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await svc.testConnection({
      url: 'https://dav.example.com/webdav',
      directory: 'backup',
      username: 'u',
      password: 'p',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: 'OPTIONS', redirect: 'manual' }),
    )
  })

  it('uploadJson PUTs JSON without leaking password in errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      svc.uploadJson(
        {
          url: 'https://dav.example.com/webdav',
          directory: 'lnkpi',
          username: 'u',
          password: 'super-secret-password',
        },
        'sessions.json',
        { sessions: [{ id: 's1' }] },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(BadRequestException)
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain('super-secret-password')
      return true
    })

    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(target.pathname).toMatch(/\/lnkpi\/sessions\.json$/)
    expect(init.method).toBe('PUT')
    expect(init.body).toContain('"sessions"')
    expect(String(init.body)).not.toContain('super-secret-password')
  })
})
