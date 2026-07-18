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
const videoGenerate = vi.fn(async () => ({ url: 'https://example.com/v.mp4' }))
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

  it('embeds reference image url in video prompt and passes duration params', async () => {
    const refUrl = 'https://example.com/ref.png'
    await svc.generateVideo(
      'u1',
      'a prompt',
      'agnes-video-v2.0',
      10,
      '16:9',
      [{ refKey: 'i1', mediaType: 'image', url: refUrl }],
      [],
      '720p',
      'none',
    )

    await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
    const [prompt, opts] = videoGenerate.mock.calls[0]
    expect(prompt).toContain(refUrl)
    expect(opts).toMatchObject({
      model: 'agnes-video-v2.0',
      duration: 10,
      aspectRatio: '16:9',
      resolution: '720p',
      crop: 'none',
    })
  })

  it('passes merged text and voice to audio provider', async () => {
    await svc.generateAudio('u1', 'say hello', { voice: 'alloy' })

    expect(createAudioProvider).toHaveBeenCalled()
    expect(audioGenerate).toHaveBeenCalledWith('say hello', 'alloy')
  })

  it('passes model to text provider when no image refs', async () => {
    await svc.generateText('u1', 'hello world', 'gpt-4o')

    expect(createTextProvider).toHaveBeenCalled()
    expect(textGenerate).toHaveBeenCalledWith('hello world', 'gpt-4o')
    expect(generateTextWithImages).not.toHaveBeenCalled()
  })

  it('passes model to generateTextWithImages when image refs present', async () => {
    const refUrl = 'https://example.com/dress.jpg'
    await svc.generateText('u1', 'describe dress', 'gpt-4o', [
      { refKey: 'i1', mediaType: 'image', url: refUrl },
    ])

    expect(generateTextWithImages).toHaveBeenCalledWith('describe dress', [refUrl], {
      model: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    expect(createTextProvider).not.toHaveBeenCalled()
  })
})
