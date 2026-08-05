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

  it('retries commercial_storyboard once when validation fails', async () => {
    const valid = `## 1. 商业策略上下文\nx\n## 2. 规则映射摘要\nx\n## 3. 分镜执行脚本\n| 序号 | 时长(秒) | 景别与视角 | 画面内容 | 镜头运动 | 营销文案(旁白/大字) | 声音设计 | 剪辑节奏 |\n| 1 | 0-3 | 中景+平视 | 手指点击，居中，冷蓝 | 固定 | 无 | 无 | 硬切 |\n| 2 | 3-6 | 特写+平视 | 屏幕亮，居中，冷蓝 | 固定 | 无 | 无 | 硬切 |\n| 3 | 6-9 | 近景+平视 | 离盘，居中，冷蓝 | 固定 | 无 | 无 | 硬切 |\n| 4 | 9-12 | 微距+平视 | 雷达，居中，冷蓝 | 固定 | 无 | 无 | 硬切 |\n| 5 | 12-15 | 全景+平视 | 转弯，居中，冷蓝 | 固定 | 无 | 无 | 硬切 |\n| 6 | 15-18 | 中景+平视 | 后排，居中，暖 | 固定 | 无 | 无 | 硬切 |\n| 7 | 18-21 | 特写+平视 | 上扬，居中，暖 | 固定 | 无 | 无 | 硬切 |\n| 8 | 21-24 | 特写+平视 | Logo，居中，黑金 | 固定 | 无 | 无 | 硬切 |\n## 4. 质量校验锁\n- [x] 开头3秒验证：ok\n- [x] 产品露出验证：ok\n- [x] 文字可读性验证：ok\n- [x] 声音独占验证：ok\n- [x] 物理可行性验证：ok`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '只有散文，没有表格' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: valid } }] }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const { content } = await generatePromptContent('问界M9 30秒商业分镜', 'commercial_storyboard', {
      apiKey: 'test-key',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(content).toContain('分镜执行脚本')
  })
})
