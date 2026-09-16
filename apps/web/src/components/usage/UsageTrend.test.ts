import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UsageTrend from './UsageTrend.vue'

const days = [
  {
    date: '2026-09-15',
    generationCount: 2,
    netConsumed: 10,
    byCategory: { text: 0, image: 10, audio: 0, video: 0 },
    otherNetConsumed: 0,
  },
  {
    date: '2026-09-16',
    generationCount: 0,
    netConsumed: 0,
    byCategory: { text: 0, image: 0, audio: 0, video: 0 },
    otherNetConsumed: 0,
  },
]

it('emits range change and defaults to generationCount', async () => {
  const wrapper = mount(UsageTrend, { props: { range: '7d', days } })
  expect(wrapper.text()).toContain('用量趋势')
  expect(wrapper.text()).toContain('近 7 天')
  await wrapper.get('button[data-range="30d"]').trigger('click')
  expect(wrapper.emitted('update:range')?.[0]).toEqual(['30d'])
  expect(wrapper.find('polyline').exists()).toBe(true)
})
