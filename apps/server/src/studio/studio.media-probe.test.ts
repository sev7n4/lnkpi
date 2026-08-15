import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { StudioController } from './studio.controller'
import { isAllowedMediaProbeUrl } from './media-probe-url.util'
import { checkMediaProbeRateLimit, resetMediaProbeRateLimitForTests } from './media-probe-rate-limit'

describe('isAllowedMediaProbeUrl', () => {
  it('allows platform-outputs hostname', () => {
    expect(isAllowedMediaProbeUrl('https://platform-outputs.agnes-ai.space/out.png')).toBe(true)
  })

  it('allows 119.29.173.89', () => {
    expect(isAllowedMediaProbeUrl('https://119.29.173.89/media/test.png')).toBe(true)
  })

  it('allows localhost and 127.0.0.1', () => {
    expect(isAllowedMediaProbeUrl('http://localhost:3000/api/uploads/u1/a.png')).toBe(true)
    expect(isAllowedMediaProbeUrl('http://127.0.0.1:3000/file.png')).toBe(true)
  })

  it('allows /api/uploads/ path on any host', () => {
    expect(isAllowedMediaProbeUrl('https://example.com/api/uploads/user/file.png')).toBe(true)
  })

  it('rejects non-http(s) schemes', () => {
    expect(isAllowedMediaProbeUrl('file:///tmp/a.png')).toBe(false)
    expect(isAllowedMediaProbeUrl('ftp://example.com/a.png')).toBe(false)
  })

  it('rejects disallowed host without uploads path', () => {
    expect(isAllowedMediaProbeUrl('https://evil.example.com/secret.png')).toBe(false)
  })
})

describe('StudioController GET media-probe', () => {
  const probeUrl = vi.fn(async (url: string) => ({
    url,
    width: 1024,
    height: 768,
    bytes: 500_000,
    mimeType: 'image/png',
    probeStatus: 'ok' as const,
  }))

  let controller: StudioController

  beforeEach(() => {
    vi.clearAllMocks()
    resetMediaProbeRateLimitForTests()
    controller = new StudioController(
      {} as never,
      {} as never,
      {} as never,
      { probeUrl } as never,
    )
  })

  it('returns ProbedMediaFile for allowlisted URL', async () => {
    const url = 'https://platform-outputs.agnes-ai.space/out.png'
    const result = await controller.mediaProbe({ user: { sub: 'u1' } }, url)

    expect(probeUrl).toHaveBeenCalledWith(url)
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: {
        url,
        width: 1024,
        height: 768,
        bytes: 500_000,
        mimeType: 'image/png',
        probeStatus: 'ok',
      },
    })
  })

  it('rejects missing url with 400', async () => {
    await expect(controller.mediaProbe({ user: { sub: 'u1' } }, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(probeUrl).not.toHaveBeenCalled()
  })

  it('rejects disallowed URL with 400', async () => {
    await expect(
      controller.mediaProbe({ user: { sub: 'u1' } }, 'https://evil.example.com/x.png'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(probeUrl).not.toHaveBeenCalled()
  })

  it('rejects non-http(s) URL with 400', async () => {
    await expect(controller.mediaProbe({ user: { sub: 'u1' } }, 'file:///tmp/a.png')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(probeUrl).not.toHaveBeenCalled()
  })

  it('enforces 30/min rate limit per user', async () => {
    const url = 'https://platform-outputs.agnes-ai.space/out.png'
    for (let i = 0; i < 30; i++) {
      await controller.mediaProbe({ user: { sub: 'u-rate' } }, url)
    }
    await expect(controller.mediaProbe({ user: { sub: 'u-rate' } }, url)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    })
    expect(probeUrl).toHaveBeenCalledTimes(30)
  })
})

describe('checkMediaProbeRateLimit', () => {
  beforeEach(() => {
    resetMediaProbeRateLimitForTests()
  })

  it('tracks limits independently per user', () => {
    for (let i = 0; i < 30; i++) {
      checkMediaProbeRateLimit('user-a')
    }
    expect(() => checkMediaProbeRateLimit('user-a')).toThrow(HttpException)
    expect(() => checkMediaProbeRateLimit('user-b')).not.toThrow()
  })
})
