import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CanvasContextMenu from './CanvasContextMenu.vue'

describe('CanvasContextMenu upscale', () => {
  it('lists 放大 before 编辑图像 and disables when imageUpscale is false', async () => {
    const wrapper = mount(CanvasContextMenu, {
      props: {
        x: 10,
        y: 20,
        nodeId: 'img-1',
        nodeType: 'image',
        hasUrl: true,
        imageUpscale: false,
      },
    })

    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels[0]).toBe('放大')
    expect(labels[1]).toBe('编辑图像')

    const upscale = wrapper.findAll('button')[0]
    expect(upscale.attributes('disabled')).toBeDefined()
    expect(upscale.attributes('title')).toContain('未启用')

    await upscale.trigger('click')
    expect(wrapper.emitted('action')).toBeUndefined()
    wrapper.unmount()
  })

  it('emits upscale-image when capability is on', async () => {
    const wrapper = mount(CanvasContextMenu, {
      props: {
        x: 10,
        y: 20,
        nodeId: 'img-1',
        nodeType: 'image',
        hasUrl: true,
        imageUpscale: true,
      },
    })

    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('action')?.[0]?.[0]).toBe('upscale-image')
    wrapper.unmount()
  })
})
