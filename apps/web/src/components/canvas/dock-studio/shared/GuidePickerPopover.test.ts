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
      attachTo: document.body,
    })

    expect(wrapper.find('.guide-picker-popover--above-end').exists()).toBe(true)
    wrapper.unmount()
  })

  it('applies below-end placement for top-of-panel pickers (Refine)', () => {
    const wrapper = mount(GuidePickerPopover, {
      props: { ...defaultProps, mode: 'edit_intent', placement: 'below-end' },
      attachTo: document.body,
    })

    expect(wrapper.find('.guide-picker-popover--below-end').exists()).toBe(true)
    wrapper.unmount()
  })

  it('portals to body with fixed coords so overflow parents cannot clip', async () => {
    const anchor = document.createElement('button')
    anchor.getBoundingClientRect = () =>
      ({
        top: 120,
        bottom: 148,
        left: 400,
        right: 520,
        width: 120,
        height: 28,
        x: 400,
        y: 120,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.appendChild(anchor)

    const wrapper = mount(GuidePickerPopover, {
      props: {
        ...defaultProps,
        mode: 'edit_intent',
        placement: 'below-end',
        portal: true,
        anchorEl: anchor,
      },
      attachTo: document.body,
    })

    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const panel = document.body.querySelector('.guide-picker-popover--portal') as HTMLElement | null
    expect(panel).toBeTruthy()
    expect(panel?.style.position).toBe('fixed')
    expect(panel?.style.top).toBe('156px')
    expect(Number.parseFloat(panel?.style.left || '0')).toBeGreaterThanOrEqual(12)
    expect(document.body.contains(panel)).toBe(true)

    wrapper.unmount()
    anchor.remove()
  })

  it('emits close on window Escape even without focus inside', async () => {
    const wrapper = mount(GuidePickerPopover, {
      props: defaultProps,
      attachTo: document.body,
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(wrapper.emitted('close') ?? []).toHaveLength(1)
    wrapper.unmount()
  })

  it('defaultPrevents Escape so dock handlers can bail', async () => {
    const wrapper = mount(GuidePickerPopover, {
      props: defaultProps,
      attachTo: document.body,
    })

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })
})
