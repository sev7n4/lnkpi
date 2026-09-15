import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'
import { GRID_SLICE_MAX_EDGE } from '@lnkpi/shared'
import { readImageBuffer } from '../media/upstream-ref-downscale'
import { UploadService } from '../upload/upload.service'
import { ImageSliceService } from './image-slice.service'

vi.mock('../media/upstream-ref-downscale', () => ({
  readImageBuffer: vi.fn(),
}))

async function createTestPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toBuffer()
}

describe('ImageSliceService', () => {
  let svc: ImageSliceService
  let saveUserFile: ReturnType<typeof vi.fn>

  const baseInput = {
    userId: 'u1',
    sourceUrl: '/api/uploads/u1/source.png',
    cols: 2,
    rows: 2,
    sessionId: 's1',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    saveUserFile = vi.fn(async (_userId: string, _buf: Buffer, name: string) => ({
      url: `https://cdn.example/${name}`,
    }))

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImageSliceService,
        {
          provide: UploadService,
          useValue: { saveUserFile },
        },
      ],
    }).compile()

    svc = moduleRef.get(ImageSliceService)
  })

  it('slices 2x2 into 4 urls with clamped dims and source dimensions', async () => {
    const png = await createTestPng(100, 80)
    vi.mocked(readImageBuffer).mockResolvedValue(png)

    const out = await svc.slice(baseInput)

    expect(out.urls).toHaveLength(4)
    expect(out.cols).toBe(2)
    expect(out.rows).toBe(2)
    expect(out.width).toBe(100)
    expect(out.height).toBe(80)
    expect(saveUserFile).toHaveBeenCalledTimes(4)
    const savedNames = saveUserFile.mock.calls.map((c) => c[2]).sort()
    expect(savedNames).toEqual(['slice-1.png', 'slice-2.png', 'slice-3.png', 'slice-4.png'])
    expect(out.urls).toHaveLength(4)
    expect([...out.urls].sort()).toEqual([
      'https://cdn.example/slice-1.png',
      'https://cdn.example/slice-2.png',
      'https://cdn.example/slice-3.png',
      'https://cdn.example/slice-4.png',
    ])
  })

  it('clamps cols/rows to 1..7', async () => {
    const png = await createTestPng(70, 70)
    vi.mocked(readImageBuffer).mockResolvedValue(png)

    const out = await svc.slice({ ...baseInput, cols: 0, rows: 99 })

    expect(out.cols).toBe(1)
    expect(out.rows).toBe(7)
    expect(out.urls).toHaveLength(7)
  })

  it('throws when max edge exceeds GRID_SLICE_MAX_EDGE', async () => {
    const png = await createTestPng(GRID_SLICE_MAX_EDGE + 1, 10)
    vi.mocked(readImageBuffer).mockResolvedValue(png)

    await expect(svc.slice(baseInput)).rejects.toBeInstanceOf(BadRequestException)
    expect(saveUserFile).not.toHaveBeenCalled()
  })

  it('throws when readImageBuffer fails', async () => {
    vi.mocked(readImageBuffer).mockRejectedValue(new Error('参考图下载失败 (404): bad'))

    await expect(svc.slice({ ...baseInput, sourceUrl: 'https://bad/url.png' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(saveUserFile).not.toHaveBeenCalled()
  })

  it('throws without returning partial urls when a save fails', async () => {
    const png = await createTestPng(40, 40)
    vi.mocked(readImageBuffer).mockResolvedValue(png)
    saveUserFile
      .mockResolvedValueOnce({ url: 'https://cdn.example/slice-1.png' })
      .mockResolvedValueOnce({ url: 'https://cdn.example/slice-2.png' })
      .mockRejectedValueOnce(new Error('disk full'))

    await expect(svc.slice(baseInput)).rejects.toThrow('disk full')
    expect(saveUserFile).toHaveBeenCalledTimes(3)
  })

  it('throws BadRequest when buffer is not a valid image', async () => {
    vi.mocked(readImageBuffer).mockResolvedValue(Buffer.from('not-an-image'))

    await expect(svc.slice(baseInput)).rejects.toBeInstanceOf(BadRequestException)
    expect(saveUserFile).not.toHaveBeenCalled()
  })
})
