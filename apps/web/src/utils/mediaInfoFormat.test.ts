import { describe, expect, it } from 'vitest'
import {
  formatMediaBytes,
  formatMediaDimensions,
  formatMediaDuration,
  formatMediaFormat,
  aspectRatioLabel,
} from './mediaInfoFormat'

describe('formatMediaDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatMediaDuration(3)).toBe('0:03')
    expect(formatMediaDuration(65)).toBe('1:05')
  })
  it('formats hours as h:mm:ss', () => {
    expect(formatMediaDuration(3661)).toBe('1:01:01')
  })
  it('returns null for invalid', () => {
    expect(formatMediaDuration(undefined)).toBeNull()
    expect(formatMediaDuration(Number.NaN)).toBeNull()
    expect(formatMediaDuration(-1)).toBeNull()
  })
})

describe('formatMediaFormat', () => {
  it('maps common audio mime types', () => {
    expect(formatMediaFormat('audio/mpeg')).toBe('MP3')
    expect(formatMediaFormat('audio/wav')).toBe('WAV')
    expect(formatMediaFormat('mp3')).toBe('MP3')
  })
  it('returns null for empty', () => {
    expect(formatMediaFormat(undefined)).toBeNull()
    expect(formatMediaFormat('')).toBeNull()
  })
})

describe('aspectRatioLabel', () => {
  it('reduces dimensions', () => {
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9')
    expect(aspectRatioLabel(1024, 1024)).toBe('1:1')
  })
  it('returns null when incomplete', () => {
    expect(aspectRatioLabel(100, undefined)).toBeNull()
  })
})

describe('existing helpers still work', () => {
  it('bytes and dims', () => {
    expect(formatMediaBytes(1024)).toBe('1.0KB')
    expect(formatMediaDimensions(10, 20)).toBe('10×20')
  })
})
