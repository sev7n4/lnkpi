import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GridSliceDropdown from './GridSliceDropdown.vue'

async function openMenu() {
  const wrapper = mount(GridSliceDropdown)
  await wrapper.get('button').trigger('click')
  return wrapper
}

describe('GridSliceDropdown (grid picker)', () => {
  it('renders trigger and a 7x7 cell matrix after open', async () => {
    const wrapper = await openMenu()
    expect(wrapper.get('button').text()).toContain('宫格裁剪')
    expect(wrapper.findAll('[data-cell]')).toHaveLength(49)
    wrapper.unmount()
  })

  it('highlights top-left sub-rect on hover and shows live label', async () => {
    const wrapper = await openMenu()
    const cell = wrapper.get('[data-cell="3-2"]')
    await cell.trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.text()).toContain('3 × 2 · 共 6 张')
    expect(wrapper.findAll('[data-cell][data-active="true"]')).toHaveLength(6)
    wrapper.unmount()
  })

  it('emits slice(cols, rows) on cell click', async () => {
    const wrapper = await openMenu()
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })

  it('touch: first tap highlights, second tap on same cell slices', async () => {
    const wrapper = await openMenu()
    const cell = wrapper.get('[data-cell="2-2"]')
    await cell.trigger('click') // touch 无 hover，第一次点选
    expect(wrapper.emitted('slice')).toBeUndefined()
    expect(wrapper.text()).toContain('2 × 2 · 共 4 张')
    await cell.trigger('click') // 第二次确认
    expect(wrapper.emitted('slice')).toEqual([[2, 2]])
    wrapper.unmount()
  })

  it('keeps 精确输入… emitting open-custom', async () => {
    const wrapper = await openMenu()
    const custom = wrapper.findAll('button').find((b) => b.text().includes('精确输入'))
    expect(custom).toBeTruthy()
    await custom!.trigger('click')
    expect(wrapper.emitted('open-custom')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not open when disabled or loading', async () => {
    const wrapper = mount(GridSliceDropdown, { props: { disabled: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[data-cell]').exists()).toBe(false)
    await wrapper.setProps({ disabled: false, loading: true })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[data-cell]').exists()).toBe(false)
    wrapper.unmount()
  })
})
