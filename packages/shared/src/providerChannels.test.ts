import { describe, expect, it } from 'vitest'
import {
  encodeChannelModel,
  decodeChannelModel,
  modelOptionName,
  inferModelCapability,
  resolvePulledModelCapability,
} from './providerChannels'

describe('providerChannels', () => {
  it('round-trips channel::model', () => {
    const v = encodeChannelModel('platform', 'seedream-5.0-pro')
    expect(v).toBe('platform::seedream-5.0-pro')
    expect(decodeChannelModel(v)).toEqual({ channelId: 'platform', modelName: 'seedream-5.0-pro' })
    expect(modelOptionName(v)).toBe('seedream-5.0-pro')
  })

  it('returns null for legacy bare model keys', () => {
    expect(decodeChannelModel('seedream-5.0-pro')).toBeNull()
    expect(modelOptionName('seedream-5.0-pro')).toBe('seedream-5.0-pro')
  })

  it('infers modality from common model name patterns', () => {
    expect(inferModelCapability('dall-e-3')).toBe('image')
    expect(inferModelCapability('flux-kontext-pro')).toBe('image')
    expect(inferModelCapability('seedream-5.0-pro')).toBe('image')
    expect(inferModelCapability('kling-v2')).toBe('video')
    expect(inferModelCapability('seedance-1.0')).toBe('video')
    expect(inferModelCapability('sora-2')).toBe('video')
    expect(inferModelCapability('whisper-1')).toBe('audio')
    expect(inferModelCapability('tts-1-hd')).toBe('audio')
    expect(inferModelCapability('gpt-4o')).toBe('text')
  })

  it('preserves previously tagged capability when re-pulling models', () => {
    expect(
      resolvePulledModelCapability('my-custom-img', { 'my-custom-img': 'image' }),
    ).toBe('image')
    expect(resolvePulledModelCapability('brand-new-model', {})).toBe('text')
    expect(resolvePulledModelCapability('dall-e-3', {})).toBe('image')
  })
})
