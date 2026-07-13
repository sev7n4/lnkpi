import { ref, watch } from 'vue'

export type MinimapExpandedState = 0 | 1 | 2
export type GridVariant = 'dots' | 'lines'

export interface CanvasViewportSettings {
  gridVisible: boolean
  gridVariant: GridVariant
  gridGap: number
  gridDotSize: number
  gridColor: string
  minimapExpanded: MinimapExpandedState
  snapToGrid: boolean
  edgeAnimated: boolean
  viewLocked: boolean
  bottomToolbarScale: number
}

const STORAGE_KEY = 'lnkpi-canvas-viewport-settings'

const defaults: CanvasViewportSettings = {
  gridVisible: true,
  gridVariant: 'dots',
  gridGap: 20,
  gridDotSize: 1.2,
  gridColor: 'rgba(255,255,255,0.08)',
  minimapExpanded: 0,
  snapToGrid: true,
  edgeAnimated: true,
  viewLocked: false,
  bottomToolbarScale: 1,
}

function loadSettings(): CanvasViewportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) as Partial<CanvasViewportSettings> }
  } catch {
    return { ...defaults }
  }
}

export function useCanvasViewportSettings() {
  const settings = ref<CanvasViewportSettings>(loadSettings())

  watch(
    settings,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  function setMinimapState(state: MinimapExpandedState) {
    settings.value.minimapExpanded = state
  }

  function toggleMinimap() {
    settings.value.minimapExpanded = settings.value.minimapExpanded === 0 ? 1 : 0
  }

  function cycleMinimap() {
    const next = ((settings.value.minimapExpanded + 1) % 3) as MinimapExpandedState
    settings.value.minimapExpanded = next
  }

  function toggleSnapToGrid() {
    settings.value.snapToGrid = !settings.value.snapToGrid
  }

  return {
    settings,
    setMinimapState,
    toggleMinimap,
    cycleMinimap,
    toggleSnapToGrid,
  }
}
