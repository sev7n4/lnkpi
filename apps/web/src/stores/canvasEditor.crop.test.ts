import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCanvasEditorStore } from './canvasEditor'

describe('canvasEditor 裁剪状态（crop 模式）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const store = () => useCanvasEditorStore()

  it('setRefineCropBase 初始化适配框（θ=0 free → 全图）', () => {
    const s = store()
    s.setRefineMode('crop')
    s.setRefineCropBase({ width: 400, height: 300 })
    expect(s.refineCropRect).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(s.refineCropRotationDeg).toBe(0)
  })

  it('比例预设：1:1 居中装进 400×300', () => {
    const s = store()
    s.setRefineMode('crop')
    s.setRefineCropBase({ width: 400, height: 300 })
    s.applyCropAspectPreset('1:1')
    const r = s.refineCropRect!
    expect(r.width).toBeCloseTo(300, 6)
    expect(r.height).toBeCloseTo(300, 6)
    expect(r.x).toBeCloseTo(50, 6)
  })

  it('旋转 90°：适配框随图像转置', () => {
    const s = store()
    s.setRefineMode('crop')
    s.setRefineCropBase({ width: 400, height: 300 })
    s.applyCropRotation(1, 0)
    expect(s.refineCropRotationDeg).toBe(90)
    const r = s.refineCropRect!
    expect(r.width).toBeCloseTo(300, 4) // 图像转置后内接框 = 300×400
    expect(r.height).toBeCloseTo(400, 4)
  })

  it('微调角钳在 ±45；旋转后矩形仍在旋转原图内', () => {
    const s = store()
    s.setRefineMode('crop')
    s.setRefineCropBase({ width: 640, height: 480 })
    s.applyCropRotation(0, 60)
    expect(s.refineCropFine).toBe(45)
    const r = s.refineCropRect!
    expect(r.width).toBeGreaterThan(0)
    expect(r.x).toBeGreaterThanOrEqual(-1e-6)
  })

  it('setRefineCropRect 防御性钳制：拖出包围盒被拉回', () => {
    const s = store()
    s.setRefineMode('crop')
    s.setRefineCropBase({ width: 400, height: 300 })
    s.setRefineCropRect({ x: 5000, y: 0, width: 100, height: 100 })
    const r = s.refineCropRect!
    expect(r.x).toBeLessThanOrEqual(300)
  })

  it('退出回 select：裁剪五态全部清空（与扩图清理对称）', () => {
    const s = store()
    s.setRefineMode('crop')
    s.setRefineCropBase({ width: 400, height: 300 })
    s.applyCropRotation(1, 10)
    s.applyCropAspectPreset('1:1')
    s.setRefineMode('select')
    expect(s.refineCropTurns).toBe(0)
    expect(s.refineCropFine).toBe(0)
    expect(s.refineCropAspect).toBe('free')
    expect(s.refineCropBase).toBeNull()
    expect(s.refineCropRect).toBeNull()
  })

  it('busy 时模式切换被拒绝（既有守卫覆盖 crop）', () => {
    const s = store()
    s.setRefineBusy(true)
    s.setRefineMode('crop')
    expect(s.refineMode).toBe('select')
    s.setRefineBusy(false)
  })
})
