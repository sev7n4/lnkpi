import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { MediaController, isHostAllowedForProxy } from './media.controller'

vi.mock('./media.service', () => ({
  MediaService: class {},
  contentDispositionAttachment: (name: string) => `attachment; filename="${name}"`,
  openDownloadStream: vi.fn(),
}))

import { openDownloadStream } from './media.service'

const mockedOpen = vi.mocked(openDownloadStream)

function makeRes(): Response & { headers: Record<string, string>; status?: number } {
  const headers: Record<string, string> = {}
  const res = {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v
    },
  } as unknown as Response & { headers: Record<string, string> }
  return res
}

function makeStream() {
  return { on: vi.fn(), pipe: vi.fn(), destroy: vi.fn() }
}

describe('isHostAllowedForProxy', () => {
  it('白名单域放行，含子域', () => {
    expect(isHostAllowedForProxy('platform-outputs.agnes-ai.space')).toBe(true)
    expect(isHostAllowedForProxy('cos-platform-outputs.agnes-ai.cn')).toBe(true)
    expect(isHostAllowedForProxy('a.platform-outputs.agnes-ai.space')).toBe(true)
  })

  it('白名单外 / 仿冒域拒绝', () => {
    expect(isHostAllowedForProxy('evil.example.com')).toBe(false)
    expect(isHostAllowedForProxy('platform-outputs.agnes-ai.space.evil.com')).toBe(false)
    expect(isHostAllowedForProxy('127.0.0.1')).toBe(false)
  })
})

describe('MediaController proxy', () => {
  beforeEach(() => {
    mockedOpen.mockReset()
    vi.restoreAllMocks()
  })

  const controller = new MediaController({} as never)

  it('白名单域 https 图片 → inline 透传 + Cache-Control', async () => {
    const stream = makeStream()
    mockedOpen.mockResolvedValue({
      body: stream as never,
      contentType: 'image/png',
      contentLength: 123,
    })
    const res = makeRes()
    await controller.proxy(
      { url: 'https://platform-outputs.agnes-ai.space/images/t2i/a.png' },
      res,
    )
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=86400')
    expect(stream.pipe).toHaveBeenCalled()
  })

  it('白名单外域 / 非 https / url 非法 → ForbiddenException', async () => {
    const res = makeRes()
    await expect(
      controller.proxy({ url: 'https://evil.example.com/a.png' }, res),
    ).rejects.toThrow(ForbiddenException)
    await expect(
      controller.proxy({ url: 'http://platform-outputs.agnes-ai.space/a.png' }, res),
    ).rejects.toThrow(ForbiddenException)
    await expect(controller.proxy({ url: 'not-a-url' }, res)).rejects.toThrow(
      ForbiddenException,
    )
    expect(mockedOpen).not.toHaveBeenCalled()
  })

  it('上游响应非图片 → 拒绝且不向客户端输出', async () => {
    const stream = makeStream()
    mockedOpen.mockResolvedValue({
      body: stream as never,
      contentType: 'text/html',
      contentLength: undefined,
    })
    const res = makeRes()
    await expect(
      controller.proxy({ url: 'https://platform-outputs.agnes-ai.space/x' }, res),
    ).rejects.toThrow(ForbiddenException)
    expect(stream.destroy).toHaveBeenCalled()
    expect(stream.pipe).not.toHaveBeenCalled()
  })
})
