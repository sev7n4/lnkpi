import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { resolveVideoModelCapabilities, SEEDANCE_20_GATEWAYS } from '@lnkpi/shared'
import VideoCapabilityBadges from './VideoCapabilityBadges.vue'

describe('VideoCapabilityBadges', () => {
  it('agnes shows keyframes label without V·A or 4K', () => {
    const capabilities = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    const wrapper = mount(VideoCapabilityBadges, { props: { capabilities } })
    expect(wrapper.text()).toContain('关键帧过渡')
    expect(wrapper.text()).not.toContain('V·A 参考')
    expect(wrapper.text()).not.toContain('4K')
    expect(wrapper.text()).not.toContain('连续镜')
  })

  it('seedance standard shows first-last, V·A, 4K, and continue-shot badges', () => {
    const capabilities = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
    const wrapper = mount(VideoCapabilityBadges, { props: { capabilities } })
    expect(wrapper.text()).toContain('严格首尾帧')
    expect(wrapper.text()).toContain('V·A 参考')
    expect(wrapper.text()).toContain('4K')
    expect(wrapper.text()).toContain('连续镜')
  })

  it('renders nothing when no badges apply', () => {
    const capabilities = resolveVideoModelCapabilities('unknown-model', 'unknown-model')
    const wrapper = mount(VideoCapabilityBadges, { props: { capabilities } })
    expect(wrapper.find('.neo-chip').exists()).toBe(false)
  })
})
