import { describe, expect, it } from 'vitest'
import {
  buildAssetMediaInfoSummary,
  buildMaterialMediaInfoSummary,
  buildNodeMediaInfoSummary,
} from './useMediaInspector'
import type { GenerationRecord } from '@/services/studio-api'

function rec(partial: Partial<GenerationRecord> & Pick<GenerationRecord, 'id' | 'type' | 'status' | 'prompt' | 'createdAt'>): GenerationRecord {
  return partial as GenerationRecord
}

describe('buildNodeMediaInfoSummary', () => {
  it('builds image summary from top-level mediaInfo', () => {
    const summary = buildNodeMediaInfoSummary(
      rec({
        id: 'g1',
        type: 'image',
        status: 'completed',
        prompt: 'p',
        createdAt: '2026-08-15T00:00:00.000Z',
        mediaInfo: {
          output: { url: 'https://x/a.png', width: 1024, height: 1024, bytes: 900_000, probeStatus: 'ok' },
          probedAt: '2026-08-15T00:00:00.000Z',
        },
        metadata: JSON.stringify({ aspectRatio: '1:1' }),
      }),
    )
    expect(summary).toMatchObject({
      kind: 'image',
      width: 1024,
      height: 1024,
      bytes: 900_000,
      aspectRatio: '1:1',
    })
  })

  it('falls back to metadata.mediaInfo when top-level field is missing', () => {
    const summary = buildNodeMediaInfoSummary(
      rec({
        id: 'g2',
        type: 'image',
        status: 'completed',
        prompt: 'p',
        createdAt: '2026-08-15T00:00:00.000Z',
        metadata: JSON.stringify({
          aspectRatio: '16:9',
          mediaInfo: {
            output: { url: 'https://x/b.png', width: 1312, height: 736, bytes: 500_000, probeStatus: 'ok' },
            probedAt: '2026-08-15T00:00:00.000Z',
          },
        }),
      }),
    )
    expect(summary?.width).toBe(1312)
    expect(summary?.aspectRatio).toBe('16:9')
  })

  it('builds video summary from resolution, aspect ratio, and bytes', () => {
    const summary = buildNodeMediaInfoSummary(
      rec({
        id: 'g3',
        type: 'video',
        status: 'completed',
        prompt: 'p',
        createdAt: '2026-08-15T00:00:00.000Z',
        mediaInfo: {
          output: {
            url: 'https://x/v.mp4',
            bytes: 12_000_000,
            probeStatus: 'ok',
          },
          probedAt: '2026-08-15T00:00:00.000Z',
        },
        metadata: JSON.stringify({ duration: 5, aspectRatio: '16:9', resolution: '720p' }),
      }),
    )
    expect(summary).toMatchObject({
      kind: 'video',
      resolution: '720p',
      aspectRatio: '16:9',
      bytes: 12_000_000,
    })
    expect(summary?.width).toBeUndefined()
  })

  it('builds material summary from metadata.mediaInfo', () => {
    const summary = buildMaterialMediaInfoSummary({
      type: 'image',
      metadata: JSON.stringify({
        aspectRatio: '16:9',
        mediaInfo: {
          output: {
            url: 'https://x/c.png',
            width: 800,
            height: 600,
            bytes: 300_000,
            probeStatus: 'ok',
          },
          probedAt: '2026-08-15T00:00:00.000Z',
        },
      }),
    })
    expect(summary).toMatchObject({
      kind: 'image',
      width: 800,
      height: 600,
      bytes: 300_000,
      aspectRatio: '16:9',
    })
  })

  it('builds asset summary from UserAsset metadata snapshot', () => {
    const summary = buildAssetMediaInfoSummary({
      kind: 'image',
      metadata: JSON.stringify({
        generationRecordId: 'gen-1',
        aspectRatio: '1:1',
        mediaInfo: {
          output: {
            url: 'https://x/d.png',
            width: 512,
            height: 512,
            bytes: 200_000,
            probeStatus: 'ok',
          },
        },
      }),
    })
    expect(summary).toMatchObject({
      kind: 'image',
      width: 512,
      height: 512,
      bytes: 200_000,
      aspectRatio: '1:1',
    })
  })
})
