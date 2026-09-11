import { afterEach, describe, expect, it } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import DockStudioToolbar from './DockStudioToolbar.vue'
import DockToolbarShell from './dock-studio/shared/DockToolbarShell.vue'

describe('DockToolbarShell', () => {
  it('shows the close button by default and emits close', async () => {
    const wrapper = mount(DockToolbarShell)

    await wrapper.get('.bottom-toolbar-close').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders header-end content and can hide the close button', () => {
    const wrapper = mount(DockToolbarShell, {
      props: { showClose: false },
      slots: { 'header-end': '<button class="scene-picker">场景</button>' },
    })

    expect(wrapper.find('.scene-picker').exists()).toBe(true)
    expect(wrapper.find('.bottom-toolbar-close').exists()).toBe(false)
  })
})

describe('DockStudioToolbar', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits close when Escape is pressed while the dock is visible', () => {
    const wrapper = shallowMount(DockStudioToolbar, {
      props: {
        node: { id: 'text-1', type: 'text', data: {} } as never,
        upstream: {} as never,
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not emit close when Escape was defaultPrevented', () => {
    const wrapper = shallowMount(DockStudioToolbar, {
      props: {
        node: { id: 'text-1', type: 'text', data: {} } as never,
        upstream: {} as never,
      },
    })

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()
    window.dispatchEvent(event)

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
})
