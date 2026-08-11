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
  body: {
    text: '方案已写入画布；确认后将生成白底、四视图及 2 张场景图。',
    nodes: [
      { key: 'white_bg', title: '白底主图', category: '基础' },
      { key: 'hero__1', title: '礼盒主视觉', category: '场景', depends_on_labels: ['白底主图'] },
    ],
    eta_min: 4,
    scene_count: 2,
    credits_hint: '约 20 积分',
    mermaid: 'flowchart LR\n  white_bg["白底主图"]',
  },
  primary_action: { label: '开始出图（约 4 分钟）', message: '确认出图' },
}

const doneEnvelope: AgentPresentationEnvelope = {
  kind: 'delivery_summary_table',
  stepper: {
    current: 'done',
    completed: ['image_qa', 'scheme_draft', 'macro_select', 'ssot_persist', 'shot_plan', 'topo_preview', 'generating', 'delivery'],
  },
  context_recap: '巨峰葡萄礼盒',
  body: {
    headline: '✅ 您的巨峰葡萄视觉稿已就绪',
    finalized: [
      { title: '礼盒长什么样', macro: 'A', node_id: 'node-hero', shot_id: 'packaging_hero__1' },
      { title: '有人送人', macro: 'B', node_id: 'node-gift', shot_id: 'model_holding_pack__1' },
    ],
    basics: [{ title: '白底主图', node_id: 'node-seed', optional: true }],
    basics_section_title: '基础资产',
  },
  primary_action: { label: '在画布中定位全部', message: '__focus_all_canvas__' },
  secondary_actions: [{ label: '导出打包（二期）', message: '__export_pack__', disabled: true }],
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

  it('renders delivery summary table and emits focusAll on primary action', async () => {
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: doneEnvelope },
    })
    expect(wrapper.find('[data-testid="delivery-summary-headline"]').text()).toContain('巨峰葡萄')
    expect(wrapper.find('[data-testid="delivery-summary-table"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delivery-basics-title"]').text()).toBe('基础资产')
    expect(wrapper.find('[data-testid="primary-action"]').text()).toBe('在画布中定位全部')
    await wrapper.find('[data-testid="primary-action"]').trigger('click')
    expect(wrapper.emitted('focusAll')?.[0]?.[0]).toEqual(['node-hero', 'node-gift', 'node-seed'])
  })

  it('renders shot_topo_merged with topo cards and merged primary label', () => {
    const mergedEnvelope: AgentPresentationEnvelope = {
      kind: 'shot_topo_merged',
      stepper: {
        current: 'topo_preview',
        completed: ['image_qa', 'scheme_draft', 'macro_select', 'ssot_persist', 'shot_plan'],
      },
      context_recap: '巨峰葡萄礼盒',
      body: {
        text: '共 3 个构图；确认后将生成白底及 2 张场景图。',
        nodes: topoEnvelope.body!.nodes,
        eta_min: 4,
        scene_count: 2,
        credits_hint: '约 20 积分',
      },
      primary_action: { label: '确认构图并开始出图', message: '确认出图' },
    }
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: mergedEnvelope },
    })
    expect(wrapper.find('[data-testid="topo-card-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="primary-action"]').text()).toBe('确认构图并开始出图')
    expect(wrapper.classes()).toContain('agent-presentation-host--gate')
    expect(wrapper.find('.agent-presentation-host__actions').exists()).toBe(true)
  })
})
