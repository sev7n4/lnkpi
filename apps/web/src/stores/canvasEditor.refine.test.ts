import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  hasOutpaintExtension,
  initialOutpaintRect,
  outpaintExtensionAmounts,
} from '@/components/canvas/refine/outpaintGeometry'
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
      invert: () => {},
    }
    editor.registerRefineMask(handle)
    expect(editor.getRefineMask()).toBe(handle)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.getRefineMask()).toBeNull()
  })

  it('resets loupe state when the session closes', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.setRefineLoupe(true)
    editor.setRefineLoupeShape('rect')
    editor.setRefineMaskMenuOpen(true)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refineLoupeOn).toBe(false)
    expect(editor.refineLoupeShape).toBe('circle')
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

  it('resets wand tolerance when the session closes', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.refineTool = 'wand'
    editor.setRefineWandTolerance(40)
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refineTool).toBe('brush')
    expect(editor.refineWandTolerance).toBe(24)
  })

  it('tracks refineMaskOp from eraser/brush and keeps it for wand/polygon/rect/point', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    expect(editor.refineMaskOp).toBe('add')
    editor.setRefineTool('eraser')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('wand')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('polygon')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('brush')
    expect(editor.refineMaskOp).toBe('add')
    // 规格修订：rect 不再硬编码 add——保持当前开关值
    editor.setRefineTool('rect')
    expect(editor.refineMaskOp).toBe('add')
    editor.setRefineTool('eraser')
    editor.setRefineTool('rect')
    expect(editor.refineMaskOp).toBe('subtract') // 回归先红 ①：旧实现会把这里翻回 'add'
  })

  it('keeps refineMaskOp when switching to point', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.setRefineTool('eraser')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('point')
    expect(editor.refineTool).toBe('point')
    expect(editor.refineMaskOp).toBe('subtract')
  })

  it('resets refineMaskOp and polygon tool on close', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.setRefineTool('eraser')
    editor.setRefineTool('polygon')
    editor.closeImageEditor()
    expect(editor.refineTool).toBe('brush')
    expect(editor.refineMaskOp).toBe('add')
  })

  it('opens editor from preview target carrying nodeId, guarded by refineBusy', () => {
    const editor = useCanvasEditorStore()
    editor.openMediaPreview({ url: 'https://cdn/a.png', kind: 'image', nodeId: 'n1' })
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    expect(editor.imageTarget?.nodeId).toBe('n1')
    editor.closeImageEditor()
    expect(editor.imageTarget).toBeNull()
  })

  it('no longer exposes floating chrome state', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    expect('refineChrome' in editor).toBe(false)
    expect('refinePanelWidth' in editor).toBe(false)
    expect('refinePanelCollapsed' in editor).toBe(false)
  })
})

describe('refineSessionResults', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('push 后 current 指向新结果，最多保留 8 张挤旧', () => {
    const editor = useCanvasEditorStore()
    for (let i = 0; i < 9; i++) editor.pushRefineSessionResult({ url: `u${i}`, prompt: '' })
    expect(editor.refineSessionResults.length).toBe(8)
    expect(editor.refineSessionResults[0].url).toBe('u1')
    expect(editor.refineSessionResults[7].url).toBe('u8')
    expect(editor.currentRefineSessionResult?.url).toBe('u8')
  })

  it('selectRefineSessionResult 切换 current', () => {
    const editor = useCanvasEditorStore()
    editor.pushRefineSessionResult({ url: 'u0', prompt: '' })
    editor.pushRefineSessionResult({ url: 'u1', prompt: '' })
    const first = editor.refineSessionResults[0]!
    editor.selectRefineSessionResult(first.id)
    expect(editor.currentRefineSessionResult?.url).toBe('u0')
  })

  it('换图/退出清空：clearRefineSessionResults 后为空且 current 为 null', () => {
    const editor = useCanvasEditorStore()
    editor.pushRefineSessionResult({ url: 'u0', prompt: '' })
    editor.clearRefineSessionResults()
    expect(editor.refineSessionResults).toEqual([])
    expect(editor.currentRefineSessionResult).toBeNull()
  })

  it('挤掉最旧若为 current，current 顺移到新的最旧', () => {
    const editor = useCanvasEditorStore()
    for (let i = 0; i < 8; i++) editor.pushRefineSessionResult({ url: `u${i}`, prompt: '' })
    const oldest = editor.refineSessionResults[0]!
    editor.selectRefineSessionResult(oldest.id)
    editor.pushRefineSessionResult({ url: 'u8', prompt: '' })
    expect(editor.refineSessionResults.length).toBe(8)
    expect(editor.refineSessionResults.some((r) => r.id === oldest.id)).toBe(false)
    expect(editor.currentRefineSessionResult?.url).toBe('u1')
  })

  it('退出精修会话时清空（closeImageEditor）', () => {
    const editor = useCanvasEditorStore()
    editor.pushRefineSessionResult({ url: 'u0', prompt: '' })
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.closeImageEditor()
    expect(editor.refineSessionResults).toEqual([])
    expect(editor.currentRefineSessionResult).toBeNull()
  })

  it('模式切换保留会话结果（setRefineMode("select") 不清空，spec §2.4）', () => {
    const editor = useCanvasEditorStore()
    editor.pushRefineSessionResult({ url: 'u0', prompt: '' })
    editor.setRefineMode('outpaint')
    editor.setRefineMode('select')
    expect(editor.refineSessionResults.length).toBe(1)
    expect(editor.currentRefineSessionResult?.url).toBe('u0')
  })

  it('换图清空：openImageEditor nodeId 变化时清空会话结果', () => {
    const editor = useCanvasEditorStore()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.pushRefineSessionResult({ url: 'u0', prompt: '' })
    editor.openImageEditor({ nodeId: 'n2', url: 'https://cdn/b.png' })
    expect(editor.refineSessionResults).toEqual([])
    expect(editor.currentRefineSessionResult).toBeNull()
  })

  it('换图保留：openImageEditor nodeId 不变时保留会话结果', () => {
    const editor = useCanvasEditorStore()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    editor.pushRefineSessionResult({ url: 'u0', prompt: '' })
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a2.png' })
    expect(editor.refineSessionResults.length).toBe(1)
  })
})

describe('扩图基准与面板动作（§7）', () => {
  const BASE = { width: 400, height: 300 }

  beforeEach(() => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    editor.refineMode = 'outpaint'
    editor.setRefineOutpaintBase(BASE)
    editor.setRefineOutpaintRect(initialOutpaintRect(BASE))
  })

  it('applyOutpaintAspectPreset(1:1) → 对称扩展，rect 可被 hasOutpaintExtension 识别', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintAspectPreset({ w: 1, h: 1 })
    const rect = editor.refineOutpaintRect!
    expect(rect.width).toBe(400)
    expect(rect.height).toBe(400)
    expect(hasOutpaintExtension(BASE, rect)).toBe(true)
    expect(outpaintExtensionAmounts(BASE, rect)).toEqual({ west: 0, east: 0, north: 50, south: 50 })
  })

  it('applyOutpaintAspectPreset(null) → 等价 resetOutpaintRect', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintAspectPreset({ w: 9, h: 16 })
    editor.applyOutpaintAspectPreset(null)
    expect(editor.refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })

  it('applyOutpaintSize(600, 500) → 绝对值语义 + 对称均分', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintSize(600, 500)
    expect(editor.refineOutpaintRect).toEqual({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('applyOutpaintSize 收到非法值 → 保持合法值（不写 NaN）', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintSize(600, 500)
    editor.applyOutpaintSize(Number.NaN, 500)
    expect(editor.refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })

  it('resetOutpaintRect() → 恢复原图矩形', () => {
    const editor = useCanvasEditorStore()
    editor.applyOutpaintSize(600, 500)
    editor.resetOutpaintRect()
    expect(editor.refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })

  it('基准缺失（未进入扩图）时三个动作均 no-op', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineOutpaintBase(null)
    editor.setRefineOutpaintRect(null)
    editor.applyOutpaintAspectPreset({ w: 1, h: 1 })
    editor.applyOutpaintSize(600, 500)
    editor.resetOutpaintRect()
    expect(editor.refineOutpaintRect).toBeNull()
  })

  it('busy 时三个动作均 no-op（不打断任务、不写坏 rect）', () => {
    const editor = useCanvasEditorStore()
    const before = editor.refineOutpaintRect
    editor.setRefineBusy(true)
    editor.applyOutpaintAspectPreset({ w: 1, h: 1 })
    editor.applyOutpaintSize(600, 500)
    editor.resetOutpaintRect()
    expect(editor.refineOutpaintRect).toEqual(before)
    editor.setRefineBusy(false)
  })

  it('setRefineMode("select") 同时清空 rect 与基准', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('select')
    expect(editor.refineOutpaintRect).toBeNull()
    expect(editor.refineOutpaintBase).toBeNull()
  })
})
