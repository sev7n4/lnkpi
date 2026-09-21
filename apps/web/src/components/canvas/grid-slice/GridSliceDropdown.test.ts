import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import GridSliceDropdown from './GridSliceDropdown.vue'

async function openMenu(props: Record<string, unknown> = {}) {
  const wrapper = mount(GridSliceDropdown, { props })
  await wrapper.get('button').trigger('click')
  return wrapper
}

async function showCustomPanel(wrapper: VueWrapper) {
  const toggle = wrapper.get('[data-testid="custom-toggle"]')
  await toggle.trigger('pointerenter', { pointerType: 'mouse' })
  return toggle
}

describe('GridSliceDropdown (dual-panel picker)', () => {
  it('renders 宫格切分 trigger and left preset list, without the old dense matrix', async () => {
    const wrapper = await openMenu()
    expect(wrapper.get('button').text()).toContain('宫格切分')
    const menu = wrapper.get('[role="menu"]')
    expect(menu.classes()).toContain('grid-slice-menu')
    // 实底背景样式类（杜绝图片透出混叠）
    expect(menu.classes()).toContain('grid-slice-solid')
    const presets = wrapper.findAll('[data-panel="presets"] [data-preset]')
    expect(presets.map((p) => p.text())).toEqual([
      '4宫格 (2×2)',
      '9宫格 (3×3)',
      '16宫格 (4×4)',
      '25宫格 (5×5)',
    ])
    expect(wrapper.get('[data-testid="custom-toggle"]').text()).toContain('自定义')
    // 右面板默认不出现；旧密集格阵与「精确输入…」已删除
    expect(wrapper.find('[data-panel="custom"]').exists()).toBe(false)
    expect(wrapper.find('[data-cell]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('精确输入')
    wrapper.unmount()
  })

  it('hovering 自定义 opens the right panel with 7×7 matrix, title and readout', async () => {
    const wrapper = await openMenu()
    await showCustomPanel(wrapper)
    const panel = wrapper.get('[data-panel="custom"]')
    expect(panel.text()).toContain('自定义宫格')
    expect(wrapper.findAll('[data-cell]')).toHaveLength(49)
    expect(wrapper.get('[data-testid="readout"]').text()).toBeTruthy()
    expect(wrapper.get('[data-testid="preview-entry"]').text()).toContain('预览切分效果')
    wrapper.unmount()
  })

  it('hovering cells updates the live readout and highlights the cols×rows region', async () => {
    const wrapper = await openMenu()
    await showCustomPanel(wrapper)
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.get('[data-testid="readout"]').text()).toContain('3 x 2')
    expect(wrapper.findAll('[data-cell][data-active="true"]')).toHaveLength(6)
    wrapper.unmount()
  })

  it('clicking a preset emits slice and closes the menu', async () => {
    const wrapper = await openMenu()
    await wrapper.get('[data-preset="4"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[2, 2]])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clicking a custom cell emits slice(cols, rows)', async () => {
    const wrapper = await openMenu()
    await showCustomPanel(wrapper)
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })

  it('touch: first tap highlights, second tap on same cell slices', async () => {
    const wrapper = await openMenu()
    await showCustomPanel(wrapper)
    const cell = wrapper.get('[data-cell="2-2"]')
    await cell.trigger('click') // touch 无 hover，第一次点选
    expect(wrapper.emitted('slice')).toBeUndefined()
    expect(wrapper.get('[data-testid="readout"]').text()).toContain('2 x 2')
    await cell.trigger('click') // 第二次确认
    expect(wrapper.emitted('slice')).toEqual([[2, 2]])
    wrapper.unmount()
  })

  it('「预览切分效果…」 emits open-custom (降级入口进既有工作台)', async () => {
    const wrapper = await openMenu()
    await showCustomPanel(wrapper)
    await wrapper.get('[data-testid="preview-entry"]').trigger('click')
    expect(wrapper.emitted('open-custom')).toHaveLength(1)
    wrapper.unmount()
  })

  it('disables presets and cells whose cell size would fall below 64px, with title hint', async () => {
    const wrapper = await openMenu({ image: { width: 300, height: 200 } })
    const preset25 = wrapper.get('[data-preset="25"]')
    expect(preset25.attributes('disabled')).toBeDefined()
    expect(preset25.attributes('title')).toContain('64')
    expect(wrapper.get('[data-preset="4"]').attributes('disabled')).toBeUndefined()

    await showCustomPanel(wrapper)
    expect(wrapper.get('[data-cell="7-7"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-cell="7-7"]').attributes('title')).toContain('64')
    expect(wrapper.get('[data-cell="2-2"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not open when disabled or loading', async () => {
    const wrapper = mount(GridSliceDropdown, { props: { disabled: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    await wrapper.setProps({ disabled: false, loading: true })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    // 请求级 loading 文案钉死（单请求，无 n/N 进度）
    expect(wrapper.get('button').text()).toContain('切分中')
    expect(wrapper.get('button').text()).toContain('大图约需数十秒')
    expect(wrapper.get('button').attributes('title')).toContain('大图约需数十秒')
    wrapper.unmount()
  })
})
