import { describe, it, expect } from 'vitest'
import {
  buildPromptNodeCardPreview,
  countMarkdownTableDataRows,
  isProductFourPanelPrompt,
  isTurnaroundLikePrompt,
  summarizePromptCompletion,
  TURNAROUND_PIPELINE_USER_NOTE,
} from './promptContent'

describe('promptContent', () => {
  const table = `| 序号 | 时长(秒) | 景别与视角 |
| :---: | :---: | :--- |
| 1 | 0-4 | 中景+平视 |
| 2 | 4-8 | 特写+俯视45° |`

  it('counts markdown table rows', () => {
    expect(countMarkdownTableDataRows(table)).toBe(2)
  })

  it('summarizes commercial storyboard completion', () => {
    const summary = summarizePromptCompletion(
      'commercial_storyboard',
      `## 3. 分镜执行脚本\n${table}`,
    )
    expect(summary).toContain('2 镜商业分镜表')
  })

  it('builds commercial card preview with shot count', () => {
    const preview = buildPromptNodeCardPreview({
      content: `## 1. 商业策略上下文\n${table}`,
      promptMode: 'commercial_storyboard',
    })
    expect(preview).toContain('2 镜表格')
    expect(preview).not.toContain('| 1 |')
  })

  it('turnaround user note mentions four panels with close-up', () => {
    expect(TURNAROUND_PIPELINE_USER_NOTE).toContain('近景特写')
    expect(TURNAROUND_PIPELINE_USER_NOTE).toContain('四格')
    expect(TURNAROUND_PIPELINE_USER_NOTE).toContain('三视图')
  })

  it('detects turnaround-like prompts', () => {
    expect(isTurnaroundLikePrompt('现代都市白领女主角的三视图')).toBe(true)
    expect(isTurnaroundLikePrompt('蓝牙耳机主图')).toBe(false)
  })

  it('detects colloquial product four-panel prompts', () => {
    expect(isProductFourPanelPrompt('生成这个产品的三视图提示词')).toBe(true)
    expect(isProductFourPanelPrompt('帮我写这个产品的四视图')).toBe(true)
    expect(isProductFourPanelPrompt('产品三视图，白底主图')).toBe(true)
    expect(isProductFourPanelPrompt('帮我生成一个包含人物三视图的提示词')).toBe(false)
    expect(isProductFourPanelPrompt('山海经吞金兽的三视图，CG风格')).toBe(false)
  })
})
