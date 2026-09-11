import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DockRefPreview from './DockRefPreview.vue'

describe('DockRefPreview', () => {
  it('prevents Escape from closing the parent dock when closing the preview', () => {
    const wrapper = mount(DockRefPreview, {
      props: {
        refItem: {
          refId: 'ref-1',
          refKey: 'T1',
          mediaType: 'text',
          sourceKind: 'edge',
          label: '文本引用',
          preview: '示例',
          payload: { text: '示例' },
        },
        x: 20,
        y: 20,
      },
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })

    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
