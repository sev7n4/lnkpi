import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GuidePickerPopover from './GuidePickerPopover.vue'

const defaultProps = {
  mode: 'generation_scene' as const,
  activeId: null,
  capabilities: {
    transparentBackground: true,
    qualityParam: true,
    maxRefImages: 4,
  },
  open: true,
}

describe('GuidePickerPopover', () => {
  it('applies above-end placement for bottom dock popovers', () => {
    const wrapper = mount(GuidePickerPopover, {
      props: { ...defaultProps, placement: 'above-end' },
    })

    expect(wrapper.classes()).toContain('guide-picker-popover--above-end')
    wrapper.unmount()
  })

  it('applies below-end placement for top-of-panel pickers (Refine)', () => {
    const wrapper = mount(GuidePickerPopover, {
      props: { ...defaultProps, mode: 'edit_intent', placement: 'below-end' },
    })

    expect(wrapper.classes()).toContain('guide-picker-popover--below-end')
    wrapper.unmount()
  })

  it('emits close on window Escape even without focus inside', async () => {
    const wrapper = mount(GuidePickerPopover, { props: defaultProps })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('defaultPrevents Escape so dock handlers can bail', async () => {
    mount(GuidePickerPopover, { props: defaultProps })

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })
})
