import { describe, expect, it } from 'vitest'
import { FAL_H3_MAX_ENDPOINTS } from '@lnkpi/agent'
import {
  falH3MaxVideoRecordMeta,
  minimaxH3VideoRecordMeta,
  videoCredits,
  videoCreditsForModel,
} from './video-credits'

describe('videoCreditsForModel', () => {
  it.each([
    {
      name: 'non-h3-max returns base for 5s',
      duration: 5,
      modelKey: 'seedance-2.0-min',
      resolution: '720p',
      expected: 30,
    },
    {
      name: 'turbo+480 uses ×1.0 for 5s',
      duration: 5,
      modelKey: 'h3-max-turbo',
      resolution: '480p',
      expected: 30,
    },
    {
      name: 'turbo+768 uses ×1.2 for 5s',
      duration: 5,
      modelKey: 'h3-max-turbo',
      resolution: '768p',
      expected: 36,
    },
    {
      name: 'turbo with omitted resolution defaults to 768p ×1.2 for 5s',
      duration: 5,
      modelKey: 'h3-max-turbo',
      expected: 36,
    },
    {
      name: 'max+480 uses ×1.2 for 5s',
      duration: 5,
      modelKey: 'h3-max',
      resolution: '480p',
      expected: 36,
    },
    {
      name: 'max+768 uses ×1.5 for 5s',
      duration: 5,
      modelKey: 'h3-max',
      resolution: '768p',
      expected: 45,
    },
    {
      name: 'non-h3-max returns base for 10s',
      duration: 10,
      modelKey: 'agnes-video-v2.0',
      resolution: '720p',
      expected: 50,
    },
    {
      name: 'turbo+768 uses ×1.2 for 10s',
      duration: 10,
      modelKey: 'minimax/h3-max-turbo',
      resolution: '768p',
      expected: 60,
    },
    {
      name: 'max+768 uses ×1.5 for 10s',
      duration: 10,
      modelKey: 'h3-max',
      resolution: '768p',
      expected: 75,
    },
    {
      name: 'max+480 uses ×1.2 for 15s',
      duration: 15,
      modelKey: 'h3-max',
      resolution: '480P',
      expected: 84,
    },
    {
      name: 'official H3 768p uses ×1.2 for 5s',
      duration: 5,
      modelKey: 'minimax-h3',
      resolution: '768p',
      expected: 36,
    },
    {
      name: 'official H3 2k uses ×1.8 for 5s',
      duration: 5,
      modelKey: 'minimax-h3',
      resolution: '2k',
      expected: 54,
    },
    {
      name: 'official H3 omitted resolution defaults to 768p ×1.2 for 5s',
      duration: 5,
      modelKey: 'minimax-h3',
      expected: 36,
    },
    {
      name: 'official H3 gateway id 768p uses ×1.2 for 5s',
      duration: 5,
      modelKey: 'MiniMax-H3',
      resolution: '768p',
      expected: 36,
    },
  ])('$name', ({ duration, modelKey, resolution, expected }) => {
    expect(videoCreditsForModel({ duration, modelKey, resolution })).toBe(expected)
    const key = modelKey.toLowerCase()
    const isOfficialH3 =
      key === 'minimax-h3' || (key.includes('minimax-h3') && !key.includes('h3-max'))
    if (!key.includes('h3-max') && !isOfficialH3) {
      expect(videoCredits(duration)).toBe(expected)
    }
  })
})

describe('falH3MaxVideoRecordMeta', () => {
  it('omits fal providerId for non-H3 models', () => {
    expect(
      falH3MaxVideoRecordMeta({
        modelKey: 'seedance-2.0-min',
        hasStartImage: true,
        credentialSource: 'platform',
      }),
    ).toEqual({})
  })

  it('maps turbo/max × t2v/i2v endpoints', () => {
    expect(
      falH3MaxVideoRecordMeta({
        modelKey: 'h3-max-turbo',
        credentialSource: 'platform',
      }),
    ).toEqual({
      providerId: 'fal',
      credentialSource: 'platform',
      falEndpoint: FAL_H3_MAX_ENDPOINTS['h3-max-turbo'].t2v,
    })
    expect(
      falH3MaxVideoRecordMeta({
        modelKey: 'minimax/h3-max',
        hasStartImage: true,
        credentialSource: 'user',
      }),
    ).toEqual({
      providerId: 'fal',
      credentialSource: 'user',
      falEndpoint: FAL_H3_MAX_ENDPOINTS['h3-max'].i2v,
    })
  })
})

describe('minimaxH3VideoRecordMeta', () => {
  it('omits minimax providerId for non-family models', () => {
    expect(
      minimaxH3VideoRecordMeta({
        modelKey: 'agnes-video-v2.0',
        credentialSource: 'platform',
      }),
    ).toEqual({})
    expect(
      minimaxH3VideoRecordMeta({
        modelKey: 'seedance-2.0-min',
        credentialSource: 'platform',
      }),
    ).toEqual({})
    expect(
      minimaxH3VideoRecordMeta({
        modelKey: 'h3-max-turbo',
        credentialSource: 'platform',
      }),
    ).toEqual({})
  })

  it('records official H3 provider metadata', () => {
    expect(
      minimaxH3VideoRecordMeta({
        modelKey: 'minimax-h3',
        credentialSource: 'platform',
      }),
    ).toEqual({
      providerId: 'minimax',
      credentialSource: 'platform',
      minimaxModel: 'MiniMax-H3',
    })
    expect(
      minimaxH3VideoRecordMeta({
        modelKey: 'MiniMax-H3',
        credentialSource: 'user',
      }),
    ).toEqual({
      providerId: 'minimax',
      credentialSource: 'user',
      minimaxModel: 'MiniMax-H3',
    })
  })
})
