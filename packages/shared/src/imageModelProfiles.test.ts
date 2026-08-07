import { describe, expect, it } from 'vitest'
import {
  clampImageGenerationInput,
  formatImageResolutionForProvider,
  resolveImageGatewayModelId,
  resolveImageModelProfile,
} from './imageModelProfiles'

describe('resolveImageModelProfile', () => {
  it('maps seedream catalog key to doubao gateway with apimart wire', () => {
    const p = resolveImageModelProfile('seedream-5.0-pro', 'seedream-5.0-pro')
    expect(p.gatewayModelId).toBe('doubao-seedream-5-0-pro')
    expect(p.refWire).toBe('apimart_image_urls')
    expect(p.responseMode).toBe('async_task')
    expect(p.maxN).toBe(1)
    expect(p.maxRefs).toBe(10)
  })

  it('maps image2 to gpt-image-2-official with apimart wire', () => {
    const p = resolveImageModelProfile('image2', 'image2')
    expect(p.gatewayModelId).toBe('gpt-image-2-official')
    expect(p.refWire).toBe('apimart_image_urls')
    expect(p.maxN).toBe(4)
    expect(p.maxRefs).toBe(16)
  })

  it('maps APIMart gemini-3.x-flash aliases to gpt-image-2-official', () => {
    for (const alias of ['gemini-3.5-flash', 'gemini-3.6-flash']) {
      const p = resolveImageModelProfile(alias, alias)
      expect(p.gatewayModelId).toBe('gpt-image-2-official')
      expect(p.refWire).toBe('apimart_image_urls')
      expect(p.responseMode).toBe('async_task')
    }
  })

  it('uses APIMart generic async profile for unknown BYOK ids on apimart baseUrl', () => {
    const p = resolveImageModelProfile('some-new-apimart-image', 'some-new-apimart-image', {
      channelBaseUrl: 'https://api.apimart.ai/v1',
    })
    expect(p.gatewayModelId).toBe('some-new-apimart-image')
    expect(p.refWire).toBe('apimart_image_urls')
    expect(p.responseMode).toBe('async_task')
  })

  it('maps gpt-image-2 shorthand to gpt-image-2-official', () => {
    expect(resolveImageGatewayModelId('gpt-image-2', 'gpt-image-2')).toBe('gpt-image-2-official')
  })

  it('keeps agnes on extra_body sync wire', () => {
    const p = resolveImageModelProfile('agnes-image-2.1-flash', 'agnes-image-2.1-flash')
    expect(p.refWire).toBe('agnes_extra_body')
    expect(p.responseMode).toBe('sync_url')
  })

  it('falls back to legacy prompt tags for unknown models', () => {
    const p = resolveImageModelProfile('navo-pro', 'navo-pro')
    expect(p.refWire).toBe('legacy_prompt_tags')
  })
})

describe('clampImageGenerationInput', () => {
  it('clamps seedream n and 4K resolution', () => {
    const profile = resolveImageModelProfile('seedream-5.0-pro', 'seedream-5.0-pro')
    const r = clampImageGenerationInput(profile, {
      n: 3,
      resolution: '4K',
      referenceImages: ['a', 'b'],
    })
    expect(r.n).toBe(1)
    expect(r.resolution).toBe('2K')
    expect(r.droppedFields.length).toBe(2)
  })

  it('truncates gpt-image2 refs beyond 16', () => {
    const profile = resolveImageModelProfile('image2', 'image2')
    const refs = Array.from({ length: 18 }, (_, i) => `https://cdn.example/${i}.png`)
    const r = clampImageGenerationInput(profile, { n: 2, resolution: '2K', referenceImages: refs })
    expect(r.referenceImages).toHaveLength(16)
    expect(r.n).toBe(2)
  })
})

describe('resolveImageGatewayModelId', () => {
  it('normalizes catalog aliases', () => {
    expect(resolveImageGatewayModelId('image2', 'image2')).toBe('gpt-image-2-official')
    expect(resolveImageGatewayModelId('seedream-5.0-pro', 'seedream-5.0-pro')).toBe(
      'doubao-seedream-5-0-pro',
    )
  })
})

describe('formatImageResolutionForProvider', () => {
  it('uses upper case for seedream', () => {
    const profile = resolveImageModelProfile('seedream-5.0-pro', 'seedream-5.0-pro')
    expect(formatImageResolutionForProvider(profile, '2K')).toBe('2K')
  })

  it('uses lower case for gpt-image2', () => {
    const profile = resolveImageModelProfile('image2', 'image2')
    expect(formatImageResolutionForProvider(profile, '2K')).toBe('2k')
  })
})
