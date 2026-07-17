import { describe, it, expect } from 'vitest'
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
