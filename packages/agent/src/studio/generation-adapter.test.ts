import { describe, expect, it, vi } from 'vitest'
import * as shared from '@lnkpi/shared'
import {
  buildAudioRequest,
  buildVideoProviderOptions,
  buildImageProviderOptions,
  buildEffectiveImagePrompt,
  buildImageProviderGenerateOptions,
} from './generation-adapter'

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
  it('puts first reference image into options.image', () => {
    const r = buildVideoProviderOptions({
      modelKey: 'seedance-2.0-min',
      referenceImages: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
    })
    expect(r.image).toBe('https://cdn.example/a.png')
    expect(r.meta.refImageMode).toBe('primary_image')
    expect(r.meta.referenceImageCount).toBe(2)
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
