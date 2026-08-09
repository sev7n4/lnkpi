import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  appendImageRefsForTextOnlyPrompt,
  generateTextForRefs,
  supportsVisionTextModel,
} from './text-generation'

describe('supportsVisionTextModel', () => {
  it('allows gemini and gpt-4o family', () => {
    expect(supportsVisionTextModel('gemini-3.5-flash-lite')).toBe(true)
    expect(supportsVisionTextModel('ch_x::gemini-3.1-flash')).toBe(true)
    expect(supportsVisionTextModel('gpt-4o')).toBe(true)
    expect(supportsVisionTextModel('agnes-2.0-flash')).toBe(true)
  })

  it('rejects deepseek and reasoning-only models', () => {
    expect(supportsVisionTextModel('deepseek-v4-pro')).toBe(false)
    expect(supportsVisionTextModel('ch_x::deepseek-v3.2')).toBe(false)
    expect(supportsVisionTextModel('o3-mini')).toBe(false)
  })
})

describe('appendImageRefsForTextOnlyPrompt', () => {
  it('appends ref-image tags for text-only fallback', () => {
    const out = appendImageRefsForTextOnlyPrompt('写方案', ['https://cdn.example/a.png'])
    expect(out).toContain('写方案')
    expect(out).toContain('[ref-image:https://cdn.example/a.png]')
    expect(out).toContain('不支持直接识图')
  })
})

describe('generateTextForRefs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  it('uses vision chat for gemini when refs present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'vision ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateTextForRefs('describe', ['https://cdn.example/a.png'], {
      apiKey: 'k',
      model: 'gemini-3.5-flash-lite',
    })

    expect(result).toEqual({ text: 'vision ok', visionUsed: true })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.stream).toBe(false)
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://cdn.example/a.png' },
    })
  })

  it('falls back to text-only provider for deepseek when refs present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'text ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateTextForRefs('describe', ['https://cdn.example/a.png'], {
      apiKey: 'k',
      model: 'deepseek-v4-pro',
    })

    expect(result).toEqual({ text: 'text ok', visionUsed: false })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.stream).toBe(false)
    expect(typeof body.messages[1].content).toBe('string')
    expect(body.messages[1].content).toContain('[ref-image:https://cdn.example/a.png]')
    expect(body.messages[1].content).not.toContain('image_url')
  })

  it('uses text provider without refs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'plain' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateTextForRefs('hello', [], {
      apiKey: 'k',
      model: 'deepseek-v4-pro',
    })

    expect(result).toEqual({ text: 'plain', visionUsed: false })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.messages[1].content).toBe('hello')
  })
})
