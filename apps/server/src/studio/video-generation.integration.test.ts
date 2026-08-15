/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildVideoProviderOptions,
  buildVideoReferenceBundle,
} from '@lnkpi/agent'
import type { GenerationRefPayload, VideoGenerationMode } from '@lnkpi/shared'
import { buildCanonicalVideoRequestFromBody } from './video-generation-request.util'

const IMAGE_A = 'https://cdn.example/a.png'
const IMAGE_B = 'https://cdn.example/b.png'
const VIDEO_REF = 'https://cdn.example/camera.mp4'

function buildProviderOptionsForStartBody(input: {
  videoMode: VideoGenerationMode
  refs: GenerationRefPayload[]
  model?: string
}) {
  const canonical = buildCanonicalVideoRequestFromBody({
    prompt: 'test prompt',
    model: input.model ?? 'seedance-2.0-min',
    videoMode: input.videoMode,
    refs: input.refs,
    sessionId: 'sess_test',
    nodeId: 'node_test',
  })
  const referenceBundle = buildVideoReferenceBundle(canonical.refs)
  return buildVideoProviderOptions({
    modelKey: canonical.model,
    duration: canonical.videoSettings.duration,
    aspectRatio: canonical.videoSettings.aspectRatio,
    resolution: canonical.videoSettings.resolution,
    crop: canonical.videoSettings.crop,
    videoMode: canonical.videoMode,
    referenceBundle,
    generateAudio: canonical.videoSettings.generateAudio,
    seed: canonical.seed,
    negativePrompt: canonical.negativePrompt,
  })
}

describe('POST /studio/video/start refs × videoMode matrix (G-12)', () => {
  it('image_to_video + 1×I → S2', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'image_to_video',
      refs: [{ refKey: 'I1', mediaType: 'image', url: IMAGE_A }],
    })

    expect(built.meta.scenario).toBe('S2')
    expect(built.meta.refWire).toBe('apimart_multimodal')
    expect(built.providerOptions.returnLastFrame).toBe(true)
    expect(built.providerOptions.referenceImages).toEqual([IMAGE_A])
  })

  it('first_last_frame + 2×I → S5 (Seedance)', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'first_last_frame',
      refs: [
        { refKey: 'I1', mediaType: 'image', url: IMAGE_A },
        { refKey: 'I2', mediaType: 'image', url: IMAGE_B },
      ],
      model: 'seedance-2.0-min',
    })

    expect(built.meta.scenario).toBe('S5')
    expect(built.meta.refWire).toBe('apimart_first_last')
    expect(built.providerOptions.returnLastFrame).toBeUndefined()
    expect(built.providerOptions.imageWithRoles).toEqual([
      { url: IMAGE_A, role: 'first_frame' },
      { url: IMAGE_B, role: 'last_frame' },
    ])
  })

  it('image_to_video + 2×I → S4', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'image_to_video',
      refs: [
        { refKey: 'I1', mediaType: 'image', url: IMAGE_A },
        { refKey: 'I2', mediaType: 'image', url: IMAGE_B },
      ],
    })

    expect(built.meta.scenario).toBe('S4')
    expect(built.meta.refWire).toBe('apimart_multimodal')
    expect(built.providerOptions.referenceImages).toEqual([IMAGE_A, IMAGE_B])
  })

  it('text_to_video + 1×V → S6', () => {
    const built = buildProviderOptionsForStartBody({
      videoMode: 'text_to_video',
      refs: [{ refKey: 'V1', mediaType: 'video', url: VIDEO_REF }],
    })

    expect(built.meta.scenario).toBe('S6')
    expect(built.meta.refWire).toBe('apimart_multimodal')
    expect(built.meta.refVideoMode).toBe('native')
    expect(built.providerOptions.referenceVideos).toEqual([VIDEO_REF])
  })
})
