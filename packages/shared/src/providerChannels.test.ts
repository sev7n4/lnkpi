import { describe, expect, it } from 'vitest'
import { encodeChannelModel, decodeChannelModel, modelOptionName } from './providerChannels'

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
})
