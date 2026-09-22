import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { MediaProbeService } from '../media/media-probe.service'
import { UploadService } from '../upload/upload.service'
import { StudioService } from './studio.service'

// 1x1 PNG（仅够通过 PNG 签名 / IHDR 尺寸解析，不依赖真实解码）
const PNG_1X1 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]),
  Buffer.from([8, 6, 0, 0, 0]),
  Buffer.from([0, 0, 0, 0]),
])

vi.mock('../media/composite-unmasked', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media/composite-unmasked')>()
  return {
    ...actual,
    readImageBuffer: vi.fn(async () => PNG_1X1),
  }
})

const REMBG_URL = 'http://rembg.test'

describe('StudioService.mattingImage', () => {
  let svc: StudioService
  let pointsConsume: ReturnType<typeof vi.fn>
  let saveUserFile: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>
  const savedMattingUrl = process.env.MATTING_SERVICE_URL

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.MATTING_SERVICE_URL = REMBG_URL
    pointsConsume = vi.fn(async () => {})
    saveUserFile = vi.fn(async () => ({ url: 'https://saved/matting.png' }))
    fetchMock = vi.fn(async () => new Response(PNG_1X1, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PointsService,
          useValue: {
            consume: pointsConsume,
            refund: vi.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ProviderResolverService,
          useValue: {},
        },
        {
          provide: MediaProbeService,
          useValue: {},
        },
        {
          provide: UploadService,
          useValue: { saveUserFile },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (savedMattingUrl === undefined) delete process.env.MATTING_SERVICE_URL
    else process.env.MATTING_SERVICE_URL = savedMattingUrl
  })

  it('未配置 MATTING_SERVICE_URL 返回 503', async () => {
    delete process.env.MATTING_SERVICE_URL

    await expect(svc.mattingImage('u1', { imageUrl: 'https://a.png' })).rejects.toMatchObject({
      status: 503,
      response: { message: '抠图服务未启用' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rembg 非 200 返回 502', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))

    await expect(
      svc.mattingImage('u1', { imageUrl: 'https://a.png' }),
    ).rejects.toBeInstanceOf(BadGatewayException)
    await expect(
      svc.mattingImage('u1', { imageUrl: 'https://a.png' }),
    ).rejects.toMatchObject({ response: { message: '抠图服务暂时不可用' } })
    expect(saveUserFile).not.toHaveBeenCalled()
  })

  it('rembg 成功时上传 PNG 并返回 url，不查积分', async () => {
    const out = await svc.mattingImage('u1', { imageUrl: 'https://a.png' })

    expect(out).toEqual({ url: 'https://saved/matting.png' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://rembg.test/matting',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(saveUserFile).toHaveBeenCalledWith('u1', expect.any(Buffer), 'matting.png', 'image/png')
    expect(pointsConsume).not.toHaveBeenCalled()
  })

  it('imageUrl 为空返回 400', async () => {
    await expect(svc.mattingImage('u1', { imageUrl: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
