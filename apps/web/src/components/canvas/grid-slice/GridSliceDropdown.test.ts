import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GridSliceDropdown from './GridSliceDropdown.vue'

describe('GridSliceDropdown', () => {
  it('renders 宫格裁剪 trigger and emits quick-slice for a square preset', async () => {
    const wrapper = mount(GridSliceDropdown)
    const trigger = wrapper.get('button')
    expect(trigger.text()).toContain('宫格裁剪')

    await trigger.trigger('click')
    const presets = wrapper.findAll('button').filter((b) => /×/.test(b.text()))
    expect(presets.map((b) => b.text())).toEqual(['2×2', '3×3', '4×4', '5×5', '6×6', '7×7'])

    await presets[1].trigger('click')
    expect(wrapper.emitted('quick-slice')).toEqual([[3]])
    wrapper.unmount()
  })

  it('emits open-custom from 自定义…', async () => {
    const wrapper = mount(GridSliceDropdown)
    await wrapper.get('button').trigger('click')
    const custom = wrapper.findAll('button').find((b) => b.text().includes('自定义'))
    expect(custom).toBeTruthy()
    await custom!.trigger('click')
    expect(wrapper.emitted('open-custom')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not open the menu when disabled or loading', async () => {
    const wrapper = mount(GridSliceDropdown, { props: { disabled: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.findAll('button')).toHaveLength(1)

    await wrapper.setProps({ disabled: false, loading: true })
    expect(wrapper.get('button').text()).toContain('裁剪中')
    await wrapper.get('button').trigger('click')
    expect(wrapper.findAll('button')).toHaveLength(1)
    wrapper.unmount()
  })
})
