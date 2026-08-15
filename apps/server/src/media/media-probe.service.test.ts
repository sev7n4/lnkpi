import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  MediaProbeService,
  parseJpegDimensions,
  parsePngDimensions,
} from './media-probe.service'

function buildPngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function buildJpegBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(20)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  buf[3] = 0xc0
  buf.writeUInt16BE(11, 4)
  buf[6] = 8
  buf.writeUInt16BE(height, 7)
  buf.writeUInt16BE(width, 9)
  return buf
}

describe('parsePngDimensions', () => {
  it('reads width and height from IHDR chunk', () => {
    expect(parsePngDimensions(buildPngBuffer(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('returns null for invalid signature', () => {
    expect(parsePngDimensions(Buffer.from('not-a-png'))).toBeNull()
  })
})

describe('parseJpegDimensions', () => {
  it('reads width and height from SOF0 marker', () => {
    expect(parseJpegDimensions(buildJpegBuffer(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('returns null for invalid signature', () => {
    expect(parseJpegDimensions(Buffer.from('not-a-jpeg'))).toBeNull()
  })
})

describe('MediaProbeService.probeUrl', () => {
  let service: MediaProbeService
  const fetchMock = vi.fn()

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()

    const moduleRef = await Test.createTestingModule({
      providers: [MediaProbeService],
    }).compile()
    service = moduleRef.get(MediaProbeService)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('probes image url with HEAD metadata and partial GET for dimensions', async () => {
    const pngBody = buildPngBuffer(800, 600)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'image/png',
          'content-length': '12345',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        statusText: 'Partial Content',
        arrayBuffer: async () => pngBody.buffer.slice(pngBody.byteOffset, pngBody.byteOffset + pngBody.byteLength),
      })

    const result = await service.probeUrl('https://cdn.example/a.png')

    expect(result).toEqual({
      url: 'https://cdn.example/a.png',
      probeStatus: 'ok',
      mimeType: 'image/png',
      bytes: 12345,
      width: 800,
      height: 600,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD' })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      headers: { Range: 'bytes=0-65535' },
    })
  })

  it('returns failed when HEAD is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
    })

    const result = await service.probeUrl('https://cdn.example/missing.png')

    expect(result.probeStatus).toBe('failed')
    expect(result.probeError).toBe('HEAD 404 Not Found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns failed when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network timeout'))

    const result = await service.probeUrl('https://cdn.example/timeout.png')

    expect(result.probeStatus).toBe('failed')
    expect(result.probeError).toBe('network timeout')
  })

  it('probes non-image url with bytes and mime only', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-length': '999999',
      }),
    })

    const result = await service.probeUrl('https://cdn.example/a.mp4')

    expect(result).toEqual({
      url: 'https://cdn.example/a.mp4',
      probeStatus: 'ok',
      mimeType: 'video/mp4',
      bytes: 999999,
      width: undefined,
      height: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
