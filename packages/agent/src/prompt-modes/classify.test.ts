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

  it('routes commercial brand storyboard by keywords', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('问界M9 30秒商业分镜提示词，官网发布会')
    expect(res.mode).toBe('commercial_storyboard')
  })

  it('routes plain storyboard without commercial keywords', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('蓝牙耳机追逐场景分镜提示词')
    expect(res.mode).toBe('storyboard')
  })

  it('falls back to generic for ambiguous text when no key', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('你好')
    expect(res.mode).toBe('generic')
  })

  it('does not classify product SKU turnaround as character', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode(
      '单张横排四格拼图：最左近景特写，后接正/侧/背；同一产品锁定材质比例与外观，禁止每格换款；干净背景，商业摄影',
    )
    expect(res.mode).toBe('generic')
  })
})
