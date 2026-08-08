import { describe, expect, it, vi } from 'vitest'
import * as shared from '@lnkpi/shared'
import {
  buildAudioRequest,
  buildEffectiveVideoPrompt,
  buildVideoProviderGenerateOptions,
  buildVideoProviderOptions,
  buildImageProviderOptions,
  buildEffectiveImagePrompt,
  buildImageProviderGenerateOptions,
  ensureSeedanceRefTags,
  Seedance1xUnsupportedError,
} from './generation-adapter'
import { buildVideoReferenceBundle } from './video-refs'

describe('buildAudioRequest', () => {
  it('maps native speed/volume/pitch for minimax and prefixes language when needed', () => {
    const r = buildAudioRequest({
      mergedText: '你好世界',
      modelKey: 'minimax-speech-2.8-hd',
      voice: 'female-tender',
      emotion: 'happy',
      language: 'zh',
      speed: 1.2,
      volume: 1,
      pitch: 0,
    })
    expect(r.options.model).toBeTruthy()
    expect(r.options.speed).toBe(1.2)
    expect(r.meta.droppedFields.every((d) => d.reason)).toBe(true)
    if (r.meta.promptPrefixApplied) {
      expect(r.text.startsWith(r.meta.promptPrefixApplied) || r.text.includes('中文')).toBe(true)
    }
  })

  it('records modelFallback for unknown audio model', () => {
    const r = buildAudioRequest({ mergedText: 'hi', modelKey: 'nope' })
    expect(r.meta.modelFallback).toBe(true)
  })
})

describe('buildVideoProviderOptions', () => {
  it('uses native image_urls for seedance multi-ref', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
      { refKey: 'I2', mediaType: 'image', url: 'https://cdn/b.png' },
    ])
    const r = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      referenceBundle: bundle,
    })
    expect(r.meta.refImageMode).toBe('native')
    expect(r.meta.refWire).toBe('apimart_multimodal')
    expect(r.providerOptions.referenceImages).toEqual([
      'https://cdn/a.png',
      'https://cdn/b.png',
    ])
    expect(r.meta.nativeParams.image_urls).toEqual([
      'https://cdn/a.png',
      'https://cdn/b.png',
    ])
    expect(r.meta.nativeParams.size).toBe('16:9')
    expect(r.meta.nativeParams.aspectRatio).toBeUndefined()
    expect(r.effectivePromptSuffix).toBeUndefined()
  })

  it.each(['S2', 'S3'] as const)(
    'requests the last frame for seedance %s generations',
    (scenario) => {
      const bundle = buildVideoReferenceBundle([
        { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
      ])
      const r = buildVideoProviderOptions({
        modelKey: 'seedance-2.0-min',
        referenceBundle: bundle,
        scenario,
      })

      expect(r.providerOptions.returnLastFrame).toBe(true)
    },
  )

  it('does not request the last frame for seedance first-last generation', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/first.png' },
      { refKey: 'I2', mediaType: 'image', url: 'https://cdn/last.png' },
    ])
    const r = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      videoMode: 'first_last_frame',
      referenceBundle: bundle,
    })

    expect(r.providerOptions.returnLastFrame).toBeUndefined()
  })

  it('uses agnes keyframes for 2+ images on agnes', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
      { refKey: 'I2', mediaType: 'image', url: 'https://cdn/b.png' },
    ])
    const r = buildVideoProviderOptions({
      modelKey: 'agnes-video-v2.0',
      referenceBundle: bundle,
    })
    expect(r.meta.refWire).toBe('agnes_keyframes')
    expect(r.providerOptions.referenceImages).toHaveLength(2)
    expect(r.image).toBeUndefined()
  })

  it('keeps referenceImages backward compatibility', () => {
    const r = buildVideoProviderOptions({
      modelKey: 'agnes-video-v2.0',
      referenceImages: ['https://cdn.example/a.png'],
    })
    expect(r.image).toBe('https://cdn.example/a.png')
    expect(r.meta.refWire).toBe('agnes_single_image')
    expect(r.meta.referenceImageCount).toBe(1)
  })

  it('builds seedance tags, consistency prompt, and server options', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png', label: '人物' },
      { refKey: 'V1', mediaType: 'video', url: 'https://cdn/v.mp4', label: '运镜' },
    ])
    const built = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      referenceBundle: bundle,
    })
    expect(ensureSeedanceRefTags('保持 @Image1', bundle)).toBe('保持 @Image1 @Video1')
    expect(buildEffectiveVideoPrompt('保持角色', built)).toMatch(
      /保持角色 @Image1 @Video1[\s\S]*【参考图一致性】/,
    )
    expect(buildVideoProviderGenerateOptions(built)).toEqual(built.providerOptions)
    expect(built.meta).toMatchObject({
      scenario: 'S6',
      refVideoMode: 'native',
      refAudioMode: 'none',
      responseMode: 'async_task',
    })
  })

  it('strips user @Image10 when bundle has only 9 images', () => {
    const bundle = buildVideoReferenceBundle(
      Array.from({ length: 9 }, (_, index) => ({
        refKey: `I${index + 1}`,
        mediaType: 'image' as const,
        url: `https://cdn/${index + 1}.png`,
      })),
    )
    expect(ensureSeedanceRefTags('参考 @Image10 风格', bundle)).not.toContain('@Image10')
    expect(ensureSeedanceRefTags('参考 @Image10 风格', bundle)).toContain('@Image1')
  })

  it('strips zero-index @Image0/@Video0/@Audio0 tags (1-based only)', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/1.png' },
      { refKey: 'V1', mediaType: 'video', url: 'https://cdn/v.mp4' },
      { refKey: 'A1', mediaType: 'audio', url: 'https://cdn/a.mp3' },
    ])
    const result = ensureSeedanceRefTags(
      '参考 @Image0 @Video0 @Audio0 @图片0 风格',
      bundle,
    )
    expect(result).not.toContain('@Image0')
    expect(result).not.toContain('@Video0')
    expect(result).not.toContain('@Audio0')
    expect(result).not.toContain('@图片0')
    expect(result).toContain('@Image1')
    expect(result).toContain('@Video1')
    expect(result).toContain('@Audio1')
  })

  it('preserves @Image1 and does not treat @Image10 as a match', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/1.png' },
    ])
    expect(ensureSeedanceRefTags('保持 @Image1', bundle)).toBe('保持 @Image1')
    const withTen = ensureSeedanceRefTags('use @Image10 only', bundle)
    expect(withTen).not.toContain('@Image10')
    expect(withTen).toMatch(/@Image1\b/)
  })

  it('clamps seedance prompt image tags to the 9 provider references', () => {
    const bundle = buildVideoReferenceBundle(
      Array.from({ length: 10 }, (_, index) => ({
        refKey: `I${index + 1}`,
        mediaType: 'image' as const,
        url: `https://cdn/${index + 1}.png`,
      })),
    )
    const built = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      referenceBundle: bundle,
    })

    const prompt = buildEffectiveVideoPrompt('保持角色 @Image10', built)

    expect(built.providerOptions.referenceImages).toHaveLength(9)
    expect(prompt).toContain('@Image9')
    expect(prompt).not.toContain('@Image10')
  })

  it('resolves BYOK BytePlus base gateway hint to apimart_multimodal with mini variant', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
      { refKey: 'V1', mediaType: 'video', url: 'https://cdn/v.mp4' },
    ])
    const r = buildVideoProviderOptions({
      modelKey: 'doubao-seedance-2-0-260128',
      gatewayModelHint: 'doubao-seedance-2-0-260128',
      referenceBundle: bundle,
      channelBaseUrl: 'https://api.apimart.ai/v1',
    })
    expect(r.meta.refWire).toBe('apimart_multimodal')
    expect(r.model).toBe('doubao-seedance-2-0-260128')
    expect(r.meta.gatewayModelId).toBe('doubao-seedance-2-0-260128')
    expect(r.meta.variantTag).toBe('mini')
    expect(r.providerOptions.referenceImages).toEqual(['https://cdn/a.png'])
  })

  it('resolves BYOK fast gateway hint to apimart_multimodal with fast variant clamp', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/a.png' },
    ])
    const r = buildVideoProviderOptions({
      modelKey: 'unknown-byok-video',
      gatewayModelHint: 'doubao-seedance-2.0-fast',
      resolution: '1080p',
      referenceBundle: bundle,
      channelBaseUrl: 'https://api.apimart.ai/v1',
    })
    expect(r.meta.refWire).toBe('apimart_multimodal')
    expect(r.model).toBe('doubao-seedance-2.0-fast')
    expect(r.meta.gatewayModelId).toBe('doubao-seedance-2.0-fast')
    expect(r.meta.variantTag).toBe('fast')
    expect(r.resolution).toBe('720p')
    expect(r.meta.droppedFields.some((d) => d.field === 'resolution')).toBe(true)
  })

  it('includes variantTag in meta for catalog seedance standard', () => {
    const r = buildVideoProviderOptions({
      modelKey: 'seedance-2.0',
      resolution: '1080p',
    })
    expect(r.meta.variantTag).toBe('standard')
    expect(r.resolution).toBe('1080p')
    expect(r.model).toBe('doubao-seedance-2.0')
  })

  it('includes variantTag in meta for catalog seedance fast with resolution clamp', () => {
    const r = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-fast',
      resolution: '1080p',
    })
    expect(r.meta.variantTag).toBe('fast')
    expect(r.resolution).toBe('720p')
    expect(r.meta.droppedFields.some((d) => d.field === 'resolution')).toBe(true)
  })

  it('throws Seedance1xUnsupportedError for 1.x BYOK gateway hint', () => {
    expect(() =>
      buildVideoProviderOptions({
        modelKey: 'doubao-seedance-1-0-lite-i2v-250428',
        gatewayModelHint: 'doubao-seedance-1-0-lite-i2v-250428',
        channelBaseUrl: 'https://api.apimart.ai/v1',
      }),
    ).toThrow(Seedance1xUnsupportedError)
    try {
      buildVideoProviderOptions({
        modelKey: 'doubao-seedance-1-0-lite-i2v-250428',
        gatewayModelHint: 'doubao-seedance-1-0-lite-i2v-250428',
        channelBaseUrl: 'https://api.apimart.ai/v1',
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Seedance1xUnsupportedError)
      expect((err as Error).message).toMatch(/不支持.*Seedance 1\.x/)
    }
  })

  it('drops video and audio prompt tags before first-last scenario inference', () => {
    const bundle = buildVideoReferenceBundle([
      { refKey: 'I1', mediaType: 'image', url: 'https://cdn/first.png' },
      { refKey: 'I2', mediaType: 'image', url: 'https://cdn/last.png' },
      { refKey: 'V1', mediaType: 'video', url: 'https://cdn/style.mp4' },
      { refKey: 'A1', mediaType: 'audio', url: 'https://cdn/music.mp3' },
    ])
    const built = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      videoMode: 'first_last_frame',
      referenceBundle: bundle,
    })

    const prompt = buildEffectiveVideoPrompt(
      '首尾帧从 @Image1 过渡到 @图片2，忽略 @Video1 和 @Audio1',
      built,
    )

    expect(prompt).toContain('首帧')
    expect(prompt).toContain('末帧')
    expect(prompt).not.toMatch(/@(?:Image|图片)\d+\b/)
    expect(prompt).not.toContain('@Video1')
    expect(prompt).not.toContain('@Audio1')
    expect(built.meta.scenario).toBe('S5')
  })
})

describe('buildImageProviderOptions', () => {
  it('passes modelId size n with none refImageMode when no references', () => {
    const r = buildImageProviderOptions({
      modelKey: 'seedream-5.0-pro',
      aspectRatio: '16:9',
      resolution: '2K',
      n: 2,
      referenceImages: [],
    })
    expect(r.modelId).toBe('doubao-seedream-5-0-pro')
    expect(r.n).toBe(1)
    expect(r.size).toBe('16:9')
    expect(r.meta.nativeParams.resolution).toBe('2K')
    expect(r.meta.refImageMode).toBe('none')
    expect(r.meta.responseMode).toBe('async_task')
  })

  it('uses native apimart image_urls for seedream references', () => {
    const r = buildImageProviderOptions({
      modelKey: 'seedream-5.0-pro',
      aspectRatio: '16:9',
      resolution: '2K',
      n: 1,
      referenceImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
    })
    expect(r.referenceImages).toEqual([
      'https://cdn.example/a.png',
      'https://cdn.example/b.png',
    ])
    expect(r.meta.refImageMode).toBe('native')
    expect(r.meta.refWire).toBe('apimart_image_urls')
    expect(r.meta.nativeParams).toMatchObject({
      image_urls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
      resolution: '2K',
      size: '16:9',
    })
  })

  it('uses native apimart image_urls for image2 multi-ref', () => {
    const r = buildImageProviderOptions({
      modelKey: 'image2',
      aspectRatio: '1:1',
      resolution: '4K',
      n: 2,
      referenceImages: ['https://cdn.example/a.png'],
    })
    expect(r.modelId).toBe('gpt-image-2-official')
    expect(r.meta.refImageMode).toBe('native')
    expect(r.meta.nativeParams.image_urls).toEqual(['https://cdn.example/a.png'])
    expect(r.meta.nativeParams.resolution).toBe('4k')
    expect(r.meta.nativeParams.quality).toBe('high')
    expect(r.n).toBe(2)
  })

  it('uses agnes extra_body.image for agnes-image refs', () => {
    const r = buildImageProviderOptions({
      modelKey: 'agnes-image-2.1-flash',
      aspectRatio: '16:9',
      resolution: '1K',
      pixelSize: '1024x576',
      n: 1,
      referenceImages: ['https://cdn.example/a.png'],
    })
    expect(r.meta.refImageMode).toBe('native')
    expect(r.meta.responseMode).toBe('sync_url')
    expect(r.meta.nativeParams).toMatchObject({
      image: ['https://cdn.example/a.png'],
      size: '1024x576',
    })
  })

  it('buildEffectiveImagePrompt omits ref-image tags for native mode but keeps consistency', () => {
    const built = buildImageProviderOptions({
      modelKey: 'agnes-image-2.1-flash',
      aspectRatio: '16:9',
      resolution: '1K',
      n: 1,
      referenceImages: ['https://cdn.example/a.png'],
    })
    const prompt = buildEffectiveImagePrompt('draw a cat', built, [
      { refKey: 'I1', label: '产品实拍' },
    ])
    expect(prompt).toContain('draw a cat')
    expect(prompt).not.toContain('[ref-image:')
    expect(prompt).toContain('【参考图一致性】')
    expect(prompt).toContain('I1')
  })

  it('uses legacy prompt tags for unknown models', () => {
    const r = buildImageProviderOptions({
      modelKey: 'navo-pro',
      aspectRatio: '16:9',
      resolution: '1K',
      n: 1,
      referenceImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
    })
    expect(r.meta.refImageMode).toBe('primary_image')
    expect(r.effectivePromptSuffix).toBe('[ref-image:https://cdn.example/b.png]')
  })

  it('BYOK passthrough keeps unknown gateway id off platform catalog default', () => {
    const r = buildImageProviderOptions({
      modelKey: 'brand-new-upstream-image',
      aspectRatio: '16:9',
      resolution: '1K',
      n: 1,
      referenceImages: ['https://cdn.example/a.png'],
      byok: true,
      channelBaseUrl: 'https://api.apimart.ai/v1',
    })
    expect(r.modelId).toBe('brand-new-upstream-image')
    expect(r.meta.gatewayModelId).toBe('brand-new-upstream-image')
    expect(r.meta.modelFallback).toBeUndefined()
    expect(r.meta.responseMode).toBe('async_task')
    expect(r.meta.refWire).toBe('apimart_image_urls')
  })

  it('recognizes APIMart gemini-3.6-flash alias as image2 with multi-ref wire', () => {
    const r = buildImageProviderOptions({
      modelKey: 'gemini-3.6-flash',
      aspectRatio: '16:9',
      resolution: '1K',
      n: 1,
      referenceImages: [
        'https://cdn.example/model.png',
        'https://cdn.example/product.png',
      ],
    })
    expect(r.modelId).toBe('gpt-image-2-official')
    expect(r.meta.gatewayModelId).toBe('gpt-image-2-official')
    expect(r.meta.responseMode).toBe('async_task')
    expect(r.meta.refWire).toBe('apimart_image_urls')
    expect(r.meta.modelFallback).toBeUndefined()
    expect(r.meta.nativeParams.image_urls).toHaveLength(2)
  })

  it('recognizes BYOK APIMart gateway model ids for async profile', () => {
    const r = buildImageProviderOptions({
      modelKey: 'doubao-seedream-5-0-pro',
      aspectRatio: '1:1',
      resolution: '1K',
      n: 1,
      referenceImages: [],
    })
    expect(r.meta.modelKey).toBe('doubao-seedream-5-0-pro')
    expect(r.meta.gatewayModelId).toBe('doubao-seedream-5-0-pro')
    expect(r.meta.responseMode).toBe('async_task')
    expect(r.meta.modelFallback).toBeUndefined()
  })

  it('buildImageProviderGenerateOptions forwards async profile fields', () => {
    const built = buildImageProviderOptions({
      modelKey: 'seedream-5.0-pro',
      aspectRatio: '16:9',
      resolution: '2K',
      n: 1,
      referenceImages: ['https://cdn.example/a.png'],
    })
    expect(buildImageProviderGenerateOptions(built)).toMatchObject({
      modelId: 'doubao-seedream-5-0-pro',
      size: '16:9',
      resolution: '2K',
      refWire: 'apimart_image_urls',
      responseMode: 'async_task',
      referenceImages: ['https://cdn.example/a.png'],
    })
  })
})
