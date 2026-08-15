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
})
