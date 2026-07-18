import { describe, expect, it } from 'vitest'
import { buildAudioRequest, buildVideoProviderOptions, buildImageProviderOptions } from './generation-adapter'

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
    // language 若为 promptPrefix：
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
  it('passes modelId size n and keeps all reference URLs in meta', () => {
    const r = buildImageProviderOptions({
      modelKey: 'seedream-5.0-pro',
      size: '1024x1024',
      n: 2,
      referenceImages: ['https://cdn.example/a.png'],
    })
    expect(r.modelId).toBeTruthy()
    expect(r.n).toBe(2)
    expect(r.meta.referenceImageCount).toBe(1)
  })
})
