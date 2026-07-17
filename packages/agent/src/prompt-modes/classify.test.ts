import { describe, it, expect, afterEach } from 'vitest'
import { tryRuleShortcut, classifyPromptMode } from './classify'

describe('tryRuleShortcut', () => {
  it('returns null in phase 1', () => {
    expect(tryRuleShortcut('帮我生成一个分镜提示词')).toBeNull()
  })
})

describe('classifyPromptMode without API key', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('uses keyword heuristic for turnaround when no key', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('帮我生成一个包含人物三视图的提示词')
    expect(res.mode).toBe('character_turnaround')
    expect(res.confidence).toBeLessThan(1)
  })

  it('falls back to generic for ambiguous text when no key', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('你好')
    expect(res.mode).toBe('generic')
  })
})
