import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentDeliveryCards from './AgentDeliveryCards.vue'
import type { DeliveryCardGroup } from './types'

const groups: DeliveryCardGroup[] = [
  {
    label: '礼盒好看',
    subtitle: '[方案A] 礼盒主视觉',
    shot_id: 'packaging_hero__1',
    recommended: true,
    selected_variant_key: 'packaging_hero__1__v1',
    candidates: [
      { variant_key: 'packaging_hero__1__v1', url: 'https://example.com/a.jpg', title: 'v1', recommended: true },
      { variant_key: 'packaging_hero__1__v2', url: 'https://example.com/b.jpg', title: 'v2' },
    ],
  },
]

describe('AgentDeliveryCards', () => {
  it('renders user request label and macro subtitle', () => {
    const wrapper = mount(AgentDeliveryCards, {
      props: {
        groups,
        selections: { packaging_hero__1: 'packaging_hero__1__v1' },
      },
    })
    expect(wrapper.text()).toContain('礼盒好看')
    expect(wrapper.text()).toContain('[方案A] 礼盒主视觉')
    expect(wrapper.text()).toContain('推荐')
  })

  it('emits switchVariant when candidate clicked', async () => {
    const wrapper = mount(AgentDeliveryCards, {
      props: {
        groups,
        selections: { packaging_hero__1: 'packaging_hero__1__v1' },
      },
    })
    const buttons = wrapper.findAll('button')
    await buttons[1]?.trigger('click')
    expect(wrapper.emitted('switchVariant')?.[0]).toEqual(['packaging_hero__1', 'packaging_hero__1__v2'])
  })
})
