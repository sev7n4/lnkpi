import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CanvasContextMenu from './CanvasContextMenu.vue'

describe('CanvasContextMenu image actions', () => {
  it('shows 下载/存入资产库 for image node with url', async () => {
    const wrapper = mount(CanvasContextMenu, {
      props: { x: 0, y: 0, nodeId: 'n1', nodeType: 'image', hasUrl: true, mediaKind: 'image' },
    })
    const download = wrapper.findAll('button').find((b) => b.text() === '下载图片')
    const save = wrapper.findAll('button').find((b) => b.text() === '存入资产库')
    expect(download).toBeTruthy()
    expect(save).toBeTruthy()
    await download!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['download-image', undefined]])
    wrapper.unmount()
  })

  it('hides image actions without url', () => {
    const wrapper = mount(CanvasContextMenu, {
      props: { x: 0, y: 0, nodeId: 'n1', nodeType: 'image', hasUrl: false, mediaKind: 'image' },
    })
    expect(wrapper.findAll('button').some((b) => b.text() === '下载图片')).toBe(false)
    wrapper.unmount()
  })
})
