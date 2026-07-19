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
      'gemini-3.1-flash',
      'deepseek-v4',
      'gpt-5.5',
    ])
    expect(listModels('image')).toHaveLength(4)
    expect(listModels('video')).toHaveLength(3)
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
