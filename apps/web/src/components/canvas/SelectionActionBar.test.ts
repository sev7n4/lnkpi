import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    nodes: ref([]),
    findNode: () => undefined,
  }),
}))
vi.mock('@/composables/useCanvasGrouping', () => ({
  getAbsolutePosition: () => ({ x: 100, y: 100 }),
  getNodeSize: () => ({ w: 200, h: 200 }),
}))

import SelectionActionBar from './SelectionActionBar.vue'

describe('SelectionActionBar', () => {
  it('forwards grid picker slice(cols, rows)', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: { node: { id: 'n1', type: 'image' }, gridSlice: true },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })

  it('emits download and save-asset, hides them without url', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: { node: { id: 'n1', type: 'image' }, gridSlice: true, hasUrl: true },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('[data-action="download"]').trigger('click')
    await wrapper.get('[data-action="save-asset"]').trigger('click')
    expect(wrapper.emitted('download')).toBeTruthy()
    expect(wrapper.emitted('save-asset')).toBeTruthy()
    await wrapper.setProps({ hasUrl: false })
    expect(wrapper.find('[data-action="download"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="save-asset"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders exactly the expected action buttons (no extra/missing)', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: { node: { id: 'n1', type: 'image' }, gridSlice: true, hasUrl: true },
      global: { stubs: { teleport: true } },
    })
    const actions = wrapper.findAll('.toolbar-action')
    expect(actions).toHaveLength(4)
    const labeled = actions.map((b) => b.text().trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
    expect(labeled).toEqual(['宫格裁剪 ▾', '编辑'])
    // icon-only file-group buttons carry stable data-action hooks
    expect(wrapper.find('[data-action="download"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="save-asset"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('emits edit', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: { node: { id: 'n1', type: 'image' }, gridSlice: true, hasUrl: true },
      global: { stubs: { teleport: true } },
    })
    const edit = wrapper.findAll('button').find((b) => b.text().includes('编辑'))!
    await edit.trigger('click')
    expect(wrapper.emitted('edit')).toBeTruthy()
    wrapper.unmount()
  })
})
