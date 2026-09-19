import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UsageOverviewCards from './UsageOverviewCards.vue'

it('renders five lifetime metrics with thousand separators', () => {
  const wrapper = mount(UsageOverviewCards, {
    props: {
      overview: {
        netConsumedTotal: 14877,
        byCategory: { text: 1, image: 2794, audio: 0, video: 4260 },
        otherNetConsumed: 0,
        generationCount: 6911,
        activeDays: 68,
      },
    },
  })
  expect(wrapper.text()).toContain('净消耗积分')
  expect(wrapper.text()).toContain('图片消耗')
  expect(wrapper.text()).toContain('视频消耗')
  expect(wrapper.text()).toContain('生成次数')
  expect(wrapper.text()).toContain('累计活跃')
  expect(wrapper.text()).toContain('14,877')
  expect(wrapper.findAll('button').length).toBe(0)
})
