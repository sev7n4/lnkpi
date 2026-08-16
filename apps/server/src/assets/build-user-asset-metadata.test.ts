import { describe, expect, it } from 'vitest'
import { buildUserAssetMetadataFromGeneration } from './build-user-asset-metadata'

describe('buildUserAssetMetadataFromGeneration', () => {
  it('copies mediaInfo snapshot from generation record metadata', () => {
    const metadata = buildUserAssetMetadataFromGeneration({
      id: 'gen-1',
      prompt: 'a cute cat',
      model: 'seedream',
      metadata: JSON.stringify({
        aspectRatio: '16:9',
        resolution: '720p',
        mediaInfo: {
          output: {
            url: 'https://x/a.png',
            width: 1024,
            height: 576,
            bytes: 500_000,
            probeStatus: 'ok',
          },
          probedAt: '2026-08-16T00:00:00.000Z',
        },
      }),
    })
    expect(metadata.generationRecordId).toBe('gen-1')
    expect(metadata.promptPreview).toBe('a cute cat')
    expect(metadata.aspectRatio).toBe('16:9')
    expect(metadata.mediaInfo?.output?.width).toBe(1024)
  })
})
