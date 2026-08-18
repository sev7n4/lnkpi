import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasKeyboard } from './useCanvasKeyboard'

function mountKeyboardHarness(options?: { onDuplicate?: () => void }) {
  let duplicateCalls = 0
  const Harness = defineComponent({
    setup() {
      const enabled = ref(true)
      useCanvasKeyboard({
        enabled,
        onZoomIn: () => {},
        onZoomOut: () => {},
        onPan: () => {},
        onDelete: () => {},
        onDuplicate: options?.onDuplicate ?? (() => {
          duplicateCalls += 1
        }),
      })
      return () => null
    },
  })
  mount(Harness)
  return {
    get duplicateCalls() {
      return duplicateCalls
    },
  }
}

function dispatchWindowKey(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }))
}

afterEach(() => {
  dispatchWindowKey('keyup', { key: 'd' })
  dispatchWindowKey('keyup', { key: 'Meta' })
  dispatchWindowKey('keyup', { key: 'Control' })
})

describe('useCanvasKeyboard duplicate shortcut', () => {
  it('calls onDuplicate for Meta+D', () => {
    const harness = mountKeyboardHarness()
    dispatchWindowKey('keydown', { key: 'd', metaKey: true })
    expect(harness.duplicateCalls).toBe(1)
  })

  it('calls onDuplicate for Ctrl+D', () => {
    const harness = mountKeyboardHarness()
    dispatchWindowKey('keydown', { key: 'd', ctrlKey: true })
    expect(harness.duplicateCalls).toBe(1)
  })

  it('does not call onDuplicate when typing in an input', () => {
    const harness = mountKeyboardHarness()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }))
    expect(harness.duplicateCalls).toBe(0)
    input.remove()
  })

  it('does not treat plain D as duplicate (reserved for pan)', () => {
    const onDuplicate = vi.fn()
    mountKeyboardHarness({ onDuplicate })
    dispatchWindowKey('keydown', { key: 'd' })
    expect(onDuplicate).not.toHaveBeenCalled()
  })
})
