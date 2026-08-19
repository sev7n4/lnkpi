import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useCanvasEditorStore } from './canvasEditor'

describe('canvasEditor refine target', () => {
  it('starts closed and only opens via openImageEditor', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    expect(editor.imageTarget).toBeNull()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    expect(editor.imageTarget?.nodeId).toBe('n1')
    editor.closeImageEditor()
    expect(editor.imageTarget).toBeNull()
  })

  it('tracks refineBusy and ignores close while busy', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    expect(editor.refineBusy).toBe(false)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.setRefineBusy(true)
    expect(editor.refineBusy).toBe(true)
    editor.closeImageEditor()
    expect(editor.imageTarget?.nodeId).toBe('n1')
    editor.setRefineBusy(false)
    expect(editor.refineBusy).toBe(false)
    editor.closeImageEditor()
    expect(editor.imageTarget).toBeNull()
  })

  it('ignores openImageEditor for a different nodeId while refineBusy', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.setRefineBusy(true)
    editor.openImageEditor({ nodeId: 'n2', url: 'https://cdn/b.png' })
    expect(editor.imageTarget?.nodeId).toBe('n1')
    expect(editor.imageTarget?.url).toBe('https://cdn/a.png')
  })

  it('defaults chrome to docked and resets on close', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.setRefineChrome('floating')
    expect(editor.refineChrome).toBe('floating')
    editor.closeImageEditor()
    expect(editor.imageTarget).toBeNull()
    expect(editor.refineChrome).toBe('docked')
  })

  it('resets overlay tool state when the session closes', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.refineTool = 'eraser'
    editor.refineBrushSize = 48
    editor.refineCoverage = 0.4
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refineTool).toBe('brush')
    expect(editor.refineBrushSize).toBe(24)
    expect(editor.refineCoverage).toBe(0)
  })

  it('registers and clears the mask handle with the session', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    const handle = {
      exportPng: async () => new Blob(),
      clear: () => {},
      getCanvas: () => null,
    }
    editor.registerRefineMask(handle)
    expect(editor.getRefineMask()).toBe(handle)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.getRefineMask()).toBeNull()
  })

  it('resets loupe and panel width when the session closes', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.setRefineLoupe(true)
    editor.setRefineLoupeShape('rect')
    editor.setRefinePanelWidth(520)
    editor.setRefineMaskMenuOpen(true)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refineLoupeOn).toBe(false)
    expect(editor.refineLoupeShape).toBe('circle')
    expect(editor.refinePanelWidth).toBe(400)
    expect(editor.refineLoupeZoom).toBe(2.5)
    expect(editor.refineBrushColor).toBe('#22d3ee')
    expect(editor.refineMaskMenuOpen).toBe(false)
  })

  it('toggles compare workspace back to the work image', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.setCompareLightboxOpen(true)
    expect(editor.compareLightboxOpen).toBe(true)
    editor.setCompareLightboxOpen(false)
    expect(editor.compareLightboxOpen).toBe(false)
  })

  it('clamps loupe zoom to 1.5–6', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.setRefineLoupeZoom(1)
    expect(editor.refineLoupeZoom).toBe(1.5)
    editor.setRefineLoupeZoom(8)
    expect(editor.refineLoupeZoom).toBe(6)
    editor.setRefineBrushColor('#ff0000')
    expect(editor.refineBrushColor).toBe('#ff0000')
  })

  it('resets panel collapsed state when the session closes', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.setRefinePanelCollapsed(true)
    expect(editor.refinePanelCollapsed).toBe(true)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refinePanelCollapsed).toBe(false)
  })
})
