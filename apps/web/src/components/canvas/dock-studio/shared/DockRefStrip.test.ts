import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { NodeRef } from '@/composables/useNodeRefs'
import DockRefStrip from './DockRefStrip.vue'

function imageRef(refKey: string): NodeRef {
  return {
    refId: refKey,
    refKey,
    mediaType: 'image',
    sourceKind: 'upload',
    label: refKey,
    preview: '',
    payload: { url: `https://example.com/${refKey}.jpg` },
  }
}

describe('DockRefStrip', () => {
  it('shows 首帧/末帧 role badges for first_last_frame with 2 image refs', () => {
    const wrapper = mount(DockRefStrip, {
      props: {
        refs: [imageRef('I1'), imageRef('I2')],
        videoMode: 'first_last_frame',
      },
    })

    expect(wrapper.text()).toContain('首帧')
    expect(wrapper.text()).toContain('末帧')
  })

  it('hides strip when empty and upload not enabled', () => {
    const wrapper = mount(DockRefStrip, { props: { refs: [] } })
    expect(wrapper.find('.dock-ref-strip').exists()).toBe(false)
  })

  it('shows muted + when upload enabled with no refs', () => {
    const wrapper = mount(DockRefStrip, {
      props: { refs: [], showAddUpload: true },
    })
    const add = wrapper.find('.dock-ref-strip__add')
    expect(add.exists()).toBe(true)
    expect(add.classes()).not.toContain('is-prominent')
  })

  it('makes + prominent when refs exist and emits addUpload', async () => {
    const wrapper = mount(DockRefStrip, {
      props: { refs: [imageRef('I1')], showAddUpload: true },
    })
    const add = wrapper.find('.dock-ref-strip__add')
    expect(add.classes()).toContain('is-prominent')
    await add.trigger('click')
    expect(wrapper.emitted('addUpload')).toHaveLength(1)
  })
})
