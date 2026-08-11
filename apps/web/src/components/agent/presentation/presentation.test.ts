import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentPresentationHost from './AgentPresentationHost.vue'
import AgentStepper from './AgentStepper.vue'
import type { AgentPresentationEnvelope } from './types'

const shotEnvelope: AgentPresentationEnvelope = {
  kind: 'shot_table',
  stepper: { current: 'shot_plan', completed: ['image_qa', 'scheme_draft', 'macro_select', 'ssot_persist'] },
  context_recap: '巨峰葡萄礼盒',
  body: { text: '共 3 个构图任务；确认后将编排出图顺序，尚未开始生成。' },
  primary_action: { label: '确认构图，生成预览', message: '确认出图' },
}

const topoEnvelope: AgentPresentationEnvelope = {
  kind: 'topo_card_list',
  stepper: { current: 'topo_preview', completed: ['image_qa', 'scheme_draft', 'macro_select', 'ssot_persist', 'shot_plan'] },
  context_recap: '巨峰葡萄礼盒',
  body: { text: '方案已写入画布；确认后将生成白底、四视图及 2 张场景图。' },
  primary_action: { label: '开始出图（约 4 分钟）', message: '确认出图' },
}

describe('AgentStepper', () => {
  it('renders nine steps and highlights current', () => {
    const wrapper = mount(AgentStepper, {
      props: { current: 'shot_plan', completed: ['image_qa', 'scheme_draft'] },
    })
    expect(wrapper.find('[data-testid="agent-stepper"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-step-id]').length).toBe(9)
    expect(wrapper.find('[data-step-id="shot_plan"]').attributes('data-step-state')).toBe('current')
    expect(wrapper.find('[data-step-id="image_qa"]').attributes('data-step-state')).toBe('done')
  })
})

describe('AgentPresentationHost', () => {
  it('renders stepper, recap, and shot primary button label', () => {
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: shotEnvelope },
    })
    expect(wrapper.find('[data-testid="context-recap"]').text()).toContain('巨峰葡萄礼盒')
    expect(wrapper.find('[data-testid="primary-action"]').text()).toBe('确认构图，生成预览')
    expect(wrapper.find('[data-testid="presentation-hint"]').text()).toContain('3 个构图任务')
  })

  it('emits primary action message on click', async () => {
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: topoEnvelope },
    })
    expect(wrapper.find('[data-testid="primary-action"]').text()).toContain('开始出图')
    await wrapper.find('[data-testid="primary-action"]').trigger('click')
    expect(wrapper.emitted('primaryAction')).toEqual([['确认出图']])
  })
})
