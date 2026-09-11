import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MentionInput from './MentionInput.vue'

describe('MentionInput', () => {
  it('prevents Escape from closing the parent dock when dismissing mentions', async () => {
    const wrapper = mount(MentionInput, {
      props: {
        modelValue: '@',
        mentions: [{ id: 'ref-1', label: '参考图' }],
      },
    })
    const textarea = wrapper.get('textarea')
    await textarea.trigger('input')

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    textarea.element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.find('ul').exists()).toBe(false)
  })
})
