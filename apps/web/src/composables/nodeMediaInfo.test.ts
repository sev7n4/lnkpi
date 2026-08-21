import { describe, expect, it } from 'vitest'
import type { ProbedMediaFile } from '@lnkpi/shared'
import {
  hasSummaryPayload,
  needsMediaInfoEnsure,
  summaryFromProbed,
  mergeNodeMediaInfo,
} from './nodeMediaInfo'

const okProbe = (partial: Partial<ProbedMediaFile>): ProbedMediaFile => ({
  url: 'https://x/a.bin',
  probeStatus: 'ok',
  ...partial,
})

describe('hasSummaryPayload', () => {
  it('true when display fields present', () => {
    expect(hasSummaryPayload({ kind: 'image', width: 1, height: 1 })).toBe(true)
    expect(hasSummaryPayload({ kind: 'audio', format: 'MP3' })).toBe(true)
    expect(hasSummaryPayload({ kind: 'image' })).toBe(false)
  })
})

describe('needsMediaInfoEnsure', () => {
  it('false without url', () => {
    expect(needsMediaInfoEnsure('image', undefined, '')).toBe(false)
  })
  it('true when missing payload', () => {
    expect(needsMediaInfoEnsure('image', undefined, 'https://x')).toBe(true)
  })
  it('false when image payload complete enough', () => {
    expect(needsMediaInfoEnsure('image', { kind: 'image', bytes: 10 }, 'https://x')).toBe(false)
  })
  it('true for audio missing duration even if format present', () => {
    expect(
      needsMediaInfoEnsure('audio', { kind: 'audio', format: 'MP3', bytes: 1 }, 'https://x'),
    ).toBe(true)
  })
})

describe('summaryFromProbed', () => {
  it('builds image summary', () => {
    const s = summaryFromProbed('image', okProbe({ width: 1920, height: 1080, bytes: 100 }))
    expect(s).toMatchObject({ kind: 'image', width: 1920, height: 1080, bytes: 100, aspectRatio: '16:9' })
  })
  it('builds audio format from mime', () => {
    const s = summaryFromProbed('audio', okProbe({ mimeType: 'audio/mpeg', bytes: 50 }))
    expect(s).toMatchObject({ kind: 'audio', format: 'MP3', bytes: 50 })
  })
  it('builds video with dims as resolution fallback', () => {
    const s = summaryFromProbed('video', okProbe({ width: 1280, height: 720, bytes: 9 }))
    expect(s?.kind).toBe('video')
    expect(s?.bytes).toBe(9)
    expect(s?.aspectRatio).toBe('16:9')
    expect(s?.resolution).toBe('1280×720')
  })
})

describe('mergeNodeMediaInfo', () => {
  it('does not clobber with empty next fields', () => {
    const merged = mergeNodeMediaInfo(
      { kind: 'audio', format: 'MP3', bytes: 10, durationSec: 3 },
      { kind: 'audio', format: undefined, bytes: 20 },
    )
    expect(merged).toEqual({ kind: 'audio', format: 'MP3', bytes: 20, durationSec: 3 })
  })
})
