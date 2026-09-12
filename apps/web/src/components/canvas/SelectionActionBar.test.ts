import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import SelectionActionBar from './SelectionActionBar.vue'

vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    nodes: ref([]),
    findNode: () => undefined,
  }),
}))

describe('SelectionActionBar', () => {
  const node = {
    id: 'img-1',
    type: 'image',
    position: { x: 100, y: 80 },
    data: { url: 'https://cdn/a.png' },
  }

  it('renders 放大 and 编辑; disables upscale with tooltip when capability off', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: {
        node: node as never,
        imageUpscale: false,
        loading: false,
      },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['放大', '编辑'])

    const upscale = buttons[0]
    expect(upscale.attributes('disabled')).toBeDefined()
    expect(upscale.attributes('title')).toContain('未启用')

    await upscale.trigger('click')
    expect(wrapper.emitted('upscale')).toBeUndefined()

    await buttons[1].trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
    wrapper.unmount()
  })

  it('emits upscale when enabled; shows loading label', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: {
        node: node as never,
        imageUpscale: true,
        loading: false,
      },
    })

    await wrapper.get('button.accent').trigger('click')
    expect(wrapper.emitted('upscale')).toHaveLength(1)

    await wrapper.setProps({ loading: true })
    expect(wrapper.get('button.accent').text()).toContain('放大中')
    expect(wrapper.get('button.accent').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
