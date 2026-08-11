import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentTopoCardList from './AgentTopoCardList.vue'
import AgentPresentationHost from './AgentPresentationHost.vue'
import type { AgentPresentationEnvelope } from './types'

const sampleNodes = [
  { key: 'white_bg', title: '白底主图', category: '基础', node_id: 'n1' },
  {
    key: 'hero__1',
    title: '礼盒主视觉',
    category: '场景',
    depends_on_labels: ['白底主图'],
    node_id: 'n2',
  },
]

const mermaidSource = 'flowchart LR\n  white_bg["白底主图 (white_bg)"]\n  hero__1["礼盒主视觉 (hero__1)"]\n  white_bg --> hero__1'

describe('AgentTopoCardList', () => {
  it('default snapshot hides mermaid flowchart source', () => {
    const wrapper = mount(AgentTopoCardList, {
      props: {
        nodes: sampleNodes,
        etaMin: 5,
        sceneCount: 2,
        creditsHint: '约 30 积分',
        mermaid: mermaidSource,
      },
    })

    expect(wrapper.html()).not.toContain('flowchart LR')
    expect(wrapper.find('[data-testid="topo-mermaid-source"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="topo-card-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="topo-footer-callout"]').text()).toContain('约 5 分钟')
    expect(wrapper.text()).toContain('白底主图')
    expect(wrapper.text()).toContain('礼盒主视觉')
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('reveals mermaid only when details expanded', async () => {
    const wrapper = mount(AgentTopoCardList, {
      props: {
        nodes: sampleNodes,
        mermaid: mermaidSource,
      },
    })

    expect(wrapper.html()).not.toContain('flowchart LR')
    const details = wrapper.find('[data-testid="topo-mermaid-collapse"]').element as HTMLDetailsElement
    details.open = true
    await details.dispatchEvent(new Event('toggle'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="topo-mermaid-source"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="topo-mermaid-source"]').text()).toContain('flowchart LR')
  })

  it('emits focusNode when row with node_id clicked', async () => {
    const wrapper = mount(AgentTopoCardList, {
      props: { nodes: sampleNodes },
    })
    await wrapper.find('[data-topo-key="white_bg"]').trigger('click')
    expect(wrapper.emitted('focusNode')).toEqual([['n1']])
  })
})

describe('AgentPresentationHost topo_card_list', () => {
  const topoEnvelope: AgentPresentationEnvelope = {
    kind: 'topo_card_list',
    stepper: {
      current: 'topo_preview',
      completed: ['image_qa', 'scheme_draft', 'macro_select', 'ssot_persist', 'shot_plan'],
    },
    context_recap: '巨峰葡萄礼盒',
    body: {
      text: '方案已写入画布；确认后将生成白底、四视图及 2 张场景图。',
      nodes: sampleNodes,
      eta_min: 4,
      scene_count: 2,
      credits_hint: '约 30 积分',
      mermaid: mermaidSource,
    },
    primary_action: { label: '开始出图（约 4 分钟）', message: '确认出图' },
  }

  it('renders topo cards without exposing mermaid by default', () => {
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: topoEnvelope },
    })
    expect(wrapper.find('[data-testid="topo-card-list"]').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('flowchart LR')
    expect(wrapper.find('[data-testid="primary-action"]').text()).toContain('开始出图')
  })
})
