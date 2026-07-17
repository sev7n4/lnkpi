import { describe, it, expect, vi, afterEach } from 'vitest'
import { generatePromptContent } from './generate'

describe('generatePromptContent without key', () => {
  it('returns placeholder that includes user prompt and is longer than input', async () => {
    delete process.env.OPENAI_API_KEY
    const input = '美女模特车模展会'
    const { mode, content } = await generatePromptContent(input, 'image_prompt_multi_style')
    expect(mode).toBe('image_prompt_multi_style')
    expect(content).toContain(input)
    expect(content.length).toBeGreaterThan(input.length)
    expect(content).not.toBe(input)
  })
})

describe('generatePromptContent with key', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
  })

  it('throws when API returns !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))
    await expect(
      generatePromptContent('test', 'generic', { apiKey: 'test-key' }),
    ).rejects.toThrow(/LLM 请求失败/)
  })

  it('throws when API returns empty content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    }))
    await expect(
      generatePromptContent('test', 'generic', { apiKey: 'test-key' }),
    ).rejects.toThrow(/LLM 返回空内容/)
  })
})
