import { describe, expect, it } from 'vitest'
import {
  encodeChannelModel,
  decodeChannelModel,
  modelOptionName,
  inferModelCapability,
  resolvePulledModelCapability,
  modelOptionsForCapability,
  filterModelNames,
  windowedRange,
  type ChannelModelSelectOption,
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

describe('modelOptionsForCapability', () => {
  const pool: ChannelModelSelectOption[] = [
    { value: 'platform::agnes-image', label: 'agnes-image（平台）', capability: 'image' },
    { value: 'platform::gpt', label: 'gpt（平台）', capability: 'text' },
    { value: 'ch1::dall-e-3', label: 'dall-e-3（渠道1）', capability: 'image' },
    { value: 'ch1::gpt-4o', label: 'gpt-4o（渠道1）', capability: 'text' },
    { value: 'ch1::kling', label: 'kling（渠道1）', capability: 'video' },
  ]

  it('defaults to capability-matched models only', () => {
    expect(modelOptionsForCapability(pool, 'image').map((o) => o.value)).toEqual([
      'platform::agnes-image',
      'ch1::dall-e-3',
    ])
  })

  it('includes other BYOK models but never other platform models', () => {
    expect(
      modelOptionsForCapability(pool, 'image', { includeOtherByok: true }).map((o) => o.value),
    ).toEqual(['platform::agnes-image', 'ch1::dall-e-3', 'ch1::gpt-4o', 'ch1::kling'])
  })

  it('keeps currently selected values visible without duplicating matches', () => {
    const opts = modelOptionsForCapability(pool, 'image', {
      selectedValues: ['ch1::dall-e-3', 'ch1::gpt-4o', 'gone::missing'],
    })
    expect(opts.filter((o) => o.value === 'ch1::dall-e-3')).toHaveLength(1)
    expect(opts.map((o) => o.value)).toContain('ch1::gpt-4o')
    expect(opts).toContainEqual({
      value: 'gone::missing',
      label: 'missing',
      capability: 'text',
    })
  })
})

describe('filterModelNames', () => {
  it('returns all names when query is blank', () => {
    expect(filterModelNames(['GPT-4o', 'dall-e-3'], '  ')).toEqual(['GPT-4o', 'dall-e-3'])
  })

  it('filters names case-insensitively', () => {
    expect(filterModelNames(['GPT-4o', 'dall-e-3', 'kling'], 'gpt')).toEqual(['GPT-4o'])
  })
})

describe('windowedRange', () => {
  it('returns an overscanned slice for the current scroll position', () => {
    expect(windowedRange(100, 360, 36, 240, 2)).toEqual({ start: 8, end: 19 })
  })

  it('clamps empty or invalid lists', () => {
    expect(windowedRange(0, 0, 36, 240)).toEqual({ start: 0, end: 0 })
    expect(windowedRange(10, 0, 0, 240)).toEqual({ start: 0, end: 0 })
  })

  it('clamps a stale scroll offset back into a short list', () => {
    expect(windowedRange(2, 5000, 36, 240, 2)).toEqual({ start: 0, end: 2 })
  })
})
