import { describe, expect, it } from 'vitest'
import {
  listModels,
  resolveModelKey,
  defaultModelKey,
  getModelEntry,
} from './studioModelCatalog'

describe('studioModelCatalog', () => {
  it('lists fixed product models per modality', () => {
    expect(listModels('text').map((m) => m.modelKey)).toEqual([
      'agnes-2.0-flash',
      'gemini-3.1-flash',
      'deepseek-v4',
      'gpt-5.5',
    ])
    expect(listModels('image').map((m) => m.modelKey)).toEqual([
      'agnes-image-2.0-flash',
      'agnes-image-2.1-flash',
      'image2',
      'navo-pro',
      'seedream-5.0-pro',
      'midjourney-8.1',
    ])
    expect(listModels('video')).toHaveLength(7)
    expect(getModelEntry('seedance-2.0')?.gatewayModelId).toBe('doubao-seedance-2.0')
    expect(getModelEntry('seedance-2.0-fast')?.gatewayModelId).toBe('doubao-seedance-2.0-fast')
    expect(getModelEntry('seedance-2.0-face')?.gatewayModelId).toBe('doubao-seedance-2.0-face')
    expect(listModels('audio').map((m) => m.modelKey)).toEqual([
      'seed-audio-1.0',
      'minimax-speech-2.8-hd',
    ])
  })

  it('falls back unknown modelKey and sets fallback flag', () => {
    const r = resolveModelKey('image', 'not-a-real-model')
    expect(r.fallback).toBe(true)
    expect(r.modelKey).toBe(defaultModelKey('image'))
  })

  it('exposes voices for audio models', () => {
    const mini = getModelEntry('minimax-speech-2.8-hd')
    expect(mini?.voices?.length).toBeGreaterThan(0)
  })
})
