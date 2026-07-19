import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveImageSize } from '@lnkpi/shared'
import {
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  generateTextWithImages,
  mergeRefsToPrompt,
} from '@lnkpi/agent'
import { createStudioService } from './studio.test-utils'
import type { StudioService } from './studio.service'

const imageGenerate = vi.fn(async () => ({
  url: 'https://example.com/a.png',
  urls: ['https://example.com/a.png'],
}))
const videoGenerate = vi.fn(async (_prompt: string, _opts?: Record<string, unknown>) => ({
  url: 'https://example.com/v.mp4',
}))
const audioGenerate = vi.fn(async () => ({ url: 'https://example.com/a.mp3' }))
const textGenerate = vi.fn(async (prompt: string) => ({ text: `ok:${prompt}` }))
const visionGenerate = vi.fn(async (prompt: string) => ({ text: `vision:${prompt}` }))

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    mergeRefsToPrompt: vi.fn(async (input: { localPrompt?: string }) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    })),
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
    createVideoProvider: vi.fn(() => ({ generate: videoGenerate })),
    createAudioProvider: vi.fn(() => ({ generate: audioGenerate })),
    createTextProvider: vi.fn(() => ({ generate: textGenerate })),
    generateTextWithImages: vi.fn(async (prompt: string) => visionGenerate(prompt)),
  }
})

describe('StudioService integration (provider params)', () => {
  let svc: StudioService

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(mergeRefsToPrompt).mockImplementation(async (input) => ({
      mergedText: input.localPrompt ?? '',
      skippedMerge: true,
    }))
    svc = await createStudioService()
  })

  it('passes modelId, size, and n to image provider', async () => {
    await svc.generateImage('u1', 'a prompt', 'seedream-5.0-pro', '16:9', [], [], '1K', 2)

    expect(createImageProvider).toHaveBeenCalled()
    expect(imageGenerate).toHaveBeenCalledWith('a prompt', {
      size: resolveImageSize('16:9', '1K'),
      n: 2,
      modelId: 'seedream-5.0-pro',
    })
  })

  it('passes reference image via options.image and native video params', async () => {
    const refUrl = 'https://example.com/ref.png'
    await svc.generateVideo(
      'u1',
      'a prompt',
      'seedance-2.0-min',
      10,
      '16:9',
      [{ refKey: 'i1', mediaType: 'image', url: refUrl }],
      [],
      '720p',
      'none',
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    const [prompt, opts] = videoGenerate.mock.calls[0]
    expect(prompt).toBe('a prompt')
    expect(opts).toMatchObject({
      model: 'seedance-2.0-min',
      duration: 10,
      aspectRatio: '16:9',
      resolution: '720p',
      image: refUrl,
    })
    // crop is metadataOnly — adapter omits native value; service may still pass undefined
    expect(opts?.crop).toBeUndefined()
  })

  it('passes built audio options (model, voice, speed) to audio provider', async () => {
    await svc.generateAudio('u1', 'say hello', {
      model: 'minimax-speech-2.8-hd',
      voice: 'female-shaonv',
      speed: 1.2,
      volume: 0.8,
      pitch: 2,
    })

    expect(createAudioProvider).toHaveBeenCalled()
    expect(audioGenerate).toHaveBeenCalledWith('say hello', {
      model: 'speech-2.8-hd',
      voice: 'female-shaonv',
      speed: 1.2,
      volume: 0.8,
      pitch: 2,
    })
  })

  it('resolves text model via catalog gateway id when no image refs', async () => {
    await svc.generateText('u1', 'hello world', 'gemini-3.1-flash')

    expect(createTextProvider).toHaveBeenCalled()
    expect(textGenerate).toHaveBeenCalledWith('hello world', 'gemini-3.1-flash')
    expect(generateTextWithImages).not.toHaveBeenCalled()
  })

  it('passes catalog gateway model to generateTextWithImages when image refs present', async () => {
    const refUrl = 'https://example.com/dress.jpg'
    await svc.generateText('u1', 'describe dress', 'gemini-3.1-flash', [
      { refKey: 'i1', mediaType: 'image', url: refUrl },
    ])

    expect(generateTextWithImages).toHaveBeenCalledWith('describe dress', [refUrl], {
      model: 'gemini-3.1-flash',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    expect(createTextProvider).not.toHaveBeenCalled()
  })
})
