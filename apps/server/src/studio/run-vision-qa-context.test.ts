import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { generateVisionQaJson } from '@lnkpi/agent'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { MediaProbeService } from '../media/media-probe.service'
import { UploadService } from '../upload/upload.service'
import { inlineUpstreamReferenceImages } from '../media/upstream-ref-inline'
import { StudioService } from './studio.service'

vi.mock('../media/upstream-ref-inline', () => ({
  inlineUpstreamReferenceImages: vi.fn(async (urls: string[]) => urls),
}))

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    generateVisionQaJson: vi.fn(async () => ({
      text: JSON.stringify({ pass: true, reason: 'ok', product_summary: 'p' }),
      visionUsed: true,
    })),
  }
})

describe('runVisionQaInternal ProviderContext', () => {
  let svc: StudioService
  let resolveForGeneration: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    resolveForGeneration = vi.fn(async () => {
      throw new Error('resolveForGeneration must not be called on vision path')
    })

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PointsService,
          useValue: { consume: vi.fn(), refund: vi.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            generationRecord: {
              create: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
              findFirst: vi.fn(),
              findMany: vi.fn(async () => []),
            },
          },
        },
        {
          provide: ProviderResolverService,
          useValue: { resolveForGeneration },
        },
        {
          provide: MediaProbeService,
          useValue: { probeUrl: vi.fn(async (url: string) => ({ url, probeStatus: 'ok' as const })) },
        },
        {
          provide: UploadService,
          useValue: { saveUserFile: vi.fn(async () => ({ url: 'https://cdn/comp.png' })) },
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  it('runVisionQaInternal with incomplete provider does not call generateVisionQaJson', async () => {
    const result = await svc.runVisionQaInternal('u1', {
      systemPrompt: 's',
      userContent: 'u',
      imageUrls: ['http://127.0.0.1/x.png'],
      provider: {
        providerRef: 'ch_x::deepseek-flash',
        model: 'deepseek-flash',
        apiKey: '',
        baseUrl: 'https://byok.example/v1',
        source: 'user',
      },
    })

    expect(result.visionUsed).toBe(false)
    const payload = JSON.parse(result.text) as { errorClass?: string; reason?: string }
    expect(payload.errorClass).toMatch(/PROVIDER_CONTEXT|BYOK_MISSING/i)
    expect(generateVisionQaJson).not.toHaveBeenCalled()
    expect(resolveForGeneration).not.toHaveBeenCalled()
  })

  it('runVisionQaInternal uses provider.apiKey/baseUrl/model not resolveForGeneration', async () => {
    await svc.runVisionQaInternal('u1', {
      systemPrompt: 's',
      userContent: 'u',
      imageUrls: ['http://127.0.0.1/x.png'],
      provider: {
        providerRef: 'ch_x::deepseek-flash',
        model: 'deepseek-flash',
        apiKey: 'sk-byok',
        baseUrl: 'https://byok.example/v1',
        source: 'user',
      },
    })

    expect(resolveForGeneration).not.toHaveBeenCalled()
    expect(generateVisionQaJson).toHaveBeenCalledWith(
      's',
      'u',
      ['http://127.0.0.1/x.png'],
      expect.objectContaining({
        model: 'deepseek-flash',
        apiKey: 'sk-byok',
        baseUrl: 'https://byok.example/v1',
        maxRetries: 0,
      }),
    )
    expect(inlineUpstreamReferenceImages).toHaveBeenCalledWith(['http://127.0.0.1/x.png'])
  })

  it('maps catch 429 to VISION_RATE_LIMIT with neutral Chinese reason', async () => {
    vi.mocked(generateVisionQaJson).mockRejectedValueOnce(
      new Error('Vision API 429: rate limit — Upgrade to a Token Plan for more'),
    )
    const result = await svc.runVisionQaInternal('u1', {
      systemPrompt: 's',
      userContent: 'u',
      imageUrls: ['http://127.0.0.1/x.png'],
      provider: {
        providerRef: 'ch_x::deepseek-flash',
        model: 'deepseek-flash',
        apiKey: 'sk-byok',
        baseUrl: 'https://byok.example/v1',
        source: 'user',
      },
    })
    expect(result.visionUsed).toBe(false)
    const payload = JSON.parse(result.text) as { errorClass?: string; reason?: string }
    expect(payload.errorClass).toBe('VISION_RATE_LIMIT')
    expect(payload.reason).toBe('识图请求过于频繁，请稍后再试')
    expect(payload.reason).not.toMatch(/Upgrade/i)
  })

  it('maps catch timeout / fetch / other to structured errorClass', async () => {
    const cases: Array<[Error, string, string]> = [
      [new Error('Request timed out after 120s'), 'VISION_TIMEOUT', '识图超时，请稍后重试'],
      [new Error('fetch failed: download error'), 'VISION_FETCH_FAILED', '参考图读取失败，请重新上传'],
      [new Error('Vision LLM 返回空内容'), 'VISION_UPSTREAM', '识图失败'],
    ]
    for (const [err, errorClass, reason] of cases) {
      vi.mocked(generateVisionQaJson).mockRejectedValueOnce(err)
      const result = await svc.runVisionQaInternal('u1', {
        systemPrompt: 's',
        userContent: 'u',
        imageUrls: ['http://127.0.0.1/x.png'],
        provider: {
          providerRef: 'ch_x::deepseek-flash',
          model: 'deepseek-flash',
          apiKey: 'sk-byok',
          baseUrl: 'https://byok.example/v1',
          source: 'user',
        },
      })
      const payload = JSON.parse(result.text) as { errorClass?: string; reason?: string }
      expect(payload.errorClass).toBe(errorClass)
      expect(payload.reason).toBe(reason)
    }
  })

  it('rejects missing provider context without env OPENAI fallback', async () => {
    const prevKey = process.env.OPENAI_API_KEY
    const prevBase = process.env.OPENAI_BASE_URL
    process.env.OPENAI_API_KEY = 'sk-env-must-not-use'
    process.env.OPENAI_BASE_URL = 'https://env.example/v1'
    try {
      const result = await svc.runVisionQaInternal('u1', {
        systemPrompt: 's',
        userContent: 'u',
        imageUrls: ['http://127.0.0.1/x.png'],
        provider: undefined as never,
      })
      expect(result.visionUsed).toBe(false)
      const payload = JSON.parse(result.text) as { errorClass?: string }
      expect(payload.errorClass).toBe('VISION_PROVIDER_CONTEXT_INVALID')
      expect(generateVisionQaJson).not.toHaveBeenCalled()
      expect(resolveForGeneration).not.toHaveBeenCalled()
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prevKey
      if (prevBase === undefined) delete process.env.OPENAI_BASE_URL
      else process.env.OPENAI_BASE_URL = prevBase
    }
  })
})
