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
})
