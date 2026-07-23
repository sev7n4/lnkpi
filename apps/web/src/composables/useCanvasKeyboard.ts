import { onMounted, onUnmounted, type Ref } from 'vue'

interface CanvasKeyboardOptions {
  enabled: Ref<boolean>
  onZoomIn: () => void
  onZoomOut: () => void
  onPan: (dx: number, dy: number) => void
  onDelete: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export function useCanvasKeyboard(options: CanvasKeyboardOptions) {
  const pressed = new Set<string>()

  function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    return target.isContentEditable
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!options.enabled.value || isTypingTarget(event.target)) return

    const key = event.key.toLowerCase()
    pressed.add(key)

    const mod = event.metaKey || event.ctrlKey
    if (mod && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) options.onRedo?.()
      else options.onUndo?.()
      return
    }
    if (event.ctrlKey && !event.metaKey && key === 'y') {
      event.preventDefault()
      options.onRedo?.()
      return
    }

    if (key === 'e') {
      event.preventDefault()
      options.onZoomIn()
      return
    }
    if (key === 'q') {
      event.preventDefault()
      options.onZoomOut()
    }
    if (key === 'delete' || key === 'backspace') {
      if (isTypingTarget(document.activeElement)) return
      event.preventDefault()
      options.onDelete()
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    pressed.delete(event.key.toLowerCase())
  }

  let raf = 0
  function tick() {
    if (options.enabled.value && pressed.size > 0) {
      const fast = pressed.has('shift')
      const step = fast ? 48 : 16
      let dx = 0
      let dy = 0
      if (pressed.has('w')) dy += step
      if (pressed.has('s')) dy -= step
      if (pressed.has('a')) dx += step
      if (pressed.has('d')) dx -= step
      if (dx || dy) options.onPan(dx, dy)
    }
    raf = requestAnimationFrame(tick)
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    raf = requestAnimationFrame(tick)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    cancelAnimationFrame(raf)
  })
}
