import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { refineWorkInsetRight } from '@/components/canvas/refine/refineWorkLayout'

const MIN_W = 360
const MAX_W = 560

export function useWorkbenchPanel(options: {
  defaultWidth: number
  busy: () => boolean
  onClose: () => void
}): {
  panelWidth: Ref<number>
  collapsed: Ref<boolean>
  isNarrow: Ref<boolean>
  insetRight: ComputedRef<number>
  setPanelWidth: (w: number) => void
  setCollapsed: (v: boolean) => void
} {
  const panelWidth = ref(Math.min(MAX_W, Math.max(MIN_W, options.defaultWidth)))
  const collapsed = ref(false)
  const isNarrow = ref(false)

  const insetRight = computed(() =>
    refineWorkInsetRight({
      innerWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
      collapsed: collapsed.value,
      panelWidth: panelWidth.value,
    }),
  )

  function syncNarrow() {
    isNarrow.value = typeof window !== 'undefined' && window.innerWidth < 640
    if (isNarrow.value) collapsed.value = false
  }

  function setPanelWidth(w: number) {
    panelWidth.value = Math.min(MAX_W, Math.max(MIN_W, w))
  }

  function setCollapsed(v: boolean) {
    if (isNarrow.value && v) return
    collapsed.value = v
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || options.busy()) return
    event.preventDefault()
    options.onClose()
  }

  onMounted(() => {
    syncNarrow()
    window.addEventListener('resize', syncNarrow)
    window.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', syncNarrow)
    window.removeEventListener('keydown', onKeydown)
  })

  return { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed }
}
