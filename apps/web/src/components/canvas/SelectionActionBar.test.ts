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
      props: { node: { id: 'n1', type: 'image' }, imageUpscale: true, gridSlice: true },
      global: { stubs: { teleport: true } },
    })
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })
})
