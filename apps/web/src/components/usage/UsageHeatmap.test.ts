import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UsageHeatmap from './UsageHeatmap.vue'

it('renders active day copy and does not use buttons for cells', () => {
  const wrapper = mount(UsageHeatmap, {
    props: {
      from: '2026-09-16',
      to: '2026-09-16',
      activeDays: 1,
      days: [{ date: '2026-09-16', netConsumed: 10, generationCount: 1 }],
    },
  })
  expect(wrapper.text()).toContain('1 个活跃日')
  expect(wrapper.findAll('button').length).toBe(0)
})
