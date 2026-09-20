import { createApp, defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchPanel } from './useWorkbenchPanel'

// The composable attaches listeners / runs syncNarrow inside onMounted, so it must
// be exercised from within a mounted component instance. A tiny harness captures the
// returned API so the assertions keep their original semantics.
let captured: ReturnType<typeof useWorkbenchPanel> | null = null
let app: ReturnType<typeof createApp> | null = null

const Harness = defineComponent({
  props: {
    defaultWidth: { type: Number, required: true },
    busy: { type: Function, required: true },
    onClose: { type: Function, required: true },
  },
  setup(props) {
    captured = useWorkbenchPanel({
      defaultWidth: props.defaultWidth,
      busy: props.busy as () => boolean,
      onClose: props.onClose as () => void,
    })
    return () => h('div')
  },
})

function mountHarness(opts: {
  defaultWidth: number
  busy: () => boolean
  onClose: () => void
}) {
  const el = document.createElement('div')
  app = createApp(Harness, {
    defaultWidth: opts.defaultWidth,
    busy: opts.busy,
    onClose: opts.onClose,
  })
  app.mount(el)
}

afterEach(() => {
  app?.unmount()
  app = null
  captured = null
  vi.unstubAllGlobals()
})

describe('useWorkbenchPanel', () => {
  it('clamps panel width into [360, 560] and syncs narrow below 640px', () => {
    vi.stubGlobal('innerWidth', 500)
    const onClose = vi.fn()
    mountHarness({ defaultWidth: 400, busy: () => false, onClose })
    expect(captured!.isNarrow.value).toBe(true)
    captured!.setPanelWidth(999)
    expect(captured!.panelWidth.value).toBeLessThanOrEqual(560)
    captured!.setCollapsed(true)
    // narrow 下折叠被禁止：collapse 不生效，宽度保持（不被重置）
    expect(captured!.collapsed.value).toBe(false)
    expect(captured!.panelWidth.value).toBeLessThanOrEqual(560)
    expect(onClose).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('escape triggers onClose unless busy', () => {
    let busy = false
    const onClose = vi.fn()
    mountHarness({ defaultWidth: 400, busy: () => busy, onClose })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    busy = true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
