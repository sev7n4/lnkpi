import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentProseBlock from './AgentProseBlock.vue'
import AgentMacroSchemeCards from './AgentMacroSchemeCards.vue'
import {
  hasSchemeDraftSections,
  splitAssistantDraftMessage,
  splitSchemeDraftSections,
  truncateMacroSummary,
} from './schemeDraftProse'

const FOUR_SECTION_PROSE = `## 我理解您的需求
用户需要巨峰葡萄礼盒视觉。

## 设计方向摘要
- 礼盒主视觉
- 防压结构

## 完整方案说明
完整行业方案正文，包含材质、结构与场景描述，字数足够长以满足规格要求。

## 接下来请您
请在下方卡片中选择宏观风格。`

describe('schemeDraftProse', () => {
  it('detects four-section prose', () => {
    expect(hasSchemeDraftSections(FOUR_SECTION_PROSE)).toBe(true)
    expect(hasSchemeDraftSections('plain text')).toBe(false)
  })

  it('splits assistant draft message footer', () => {
    const content = `${FOUR_SECTION_PROSE}\n\n---\n已生成视觉方案正文，请选择宏观方案后继续。`
    const parsed = splitAssistantDraftMessage(content)
    expect(parsed.footer).toContain('请选择宏观方案')
    expect(splitSchemeDraftSections(parsed.prose)).toHaveLength(4)
  })

  it('truncates macro summary to 80 chars', () => {
    expect(truncateMacroSummary('x'.repeat(100)).length).toBeLessThanOrEqual(80)
  })
})

describe('AgentProseBlock', () => {
  it('shows first two sections by default', () => {
    const wrapper = mount(AgentProseBlock, {
      props: { content: FOUR_SECTION_PROSE },
    })
    expect(wrapper.find('[data-testid="agent-prose-block"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="我理解您的需求"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="设计方向摘要"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="完整方案说明"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="prose-expand-toggle"]').text()).toContain('展开完整方案')
  })

  it('expands hidden sections on toggle', async () => {
    const wrapper = mount(AgentProseBlock, {
      props: { content: FOUR_SECTION_PROSE },
    })
    await wrapper.find('[data-testid="prose-expand-toggle"]').trigger('click')
    expect(wrapper.find('[data-section="完整方案说明"]').exists()).toBe(true)
    expect(wrapper.find('[data-section="接下来请您"]').exists()).toBe(true)
  })
})

describe('AgentMacroSchemeCards', () => {
  it('renders summary, tags, and recommend_reason on separate lines', () => {
    const wrapper = mount(AgentMacroSchemeCards, {
      props: {
        schemes: [
          {
            id: 'A',
            label: '红金礼盒',
            summary: 'y'.repeat(100),
            tags: ['轻奢', '牛皮纸'],
            recommended: true,
            recommend_reason: '契合节日氛围',
          },
        ],
        selectedIds: ['A'],
      },
    })
    const summary = wrapper.find('[data-testid="macro-scheme-summary"]').text()
    expect(summary.length).toBeLessThanOrEqual(80)
    expect(wrapper.find('[data-testid="macro-scheme-tags"]').text()).toContain('#轻奢')
    expect(wrapper.find('[data-testid="macro-scheme-reason"]').text()).toBe('契合节日氛围')
  })
})
