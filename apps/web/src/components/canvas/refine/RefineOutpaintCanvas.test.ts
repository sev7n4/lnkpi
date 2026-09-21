import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineOutpaintCanvas from './RefineOutpaintCanvas.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

let pinia: Pinia
const mountCanvas = (props: Record<string, unknown> = {}) =>
  mount(RefineOutpaintCanvas, {
    // 基图 400×300（均 ≥ 256 下限），避免短边 clamp 干扰手柄读数断言
    props: { baseUrl: 'blob:before', baseWidth: 400, baseHeight: 300, ...props },
    global: { plugins: [pinia] },
  })

const drag = async (
  w: ReturnType<typeof mountCanvas>,
  dir: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const handle = w.find(`[data-testid="outpaint-handle-${dir}"]`)
  handle.element.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: from.x, clientY: from.y }))
  window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: to.x, clientY: to.y }))
  window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
  await flushPromises()
}

const readoutDims = (w: ReturnType<typeof mountCanvas>) => {
  const text = w.find('[data-testid="outpaint-readout"]').text()
  const m = text.match(/(\d+)\s*×\s*(\d+)/)
  return { w: Number(m?.[1]), h: Number(m?.[2]) }
}

describe('RefineOutpaintCanvas', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    useCanvasEditorStore().refineMode = 'outpaint'
  })

  it('渲染 8 个拖拽手柄与实时读数', () => {
    const w = mountCanvas()
    for (const dir of HANDLES) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-readout"]').text()).toContain('400 × 300')
  })

  it('斜纹扩出区底存在', () => {
    const w = mountCanvas()
    expect(w.find('.refine-outpaint__stripes').exists()).toBe(true)
  })

  it('拖拽东(handle e)改变读数（宽度增长，高度不变）', async () => {
    const w = mountCanvas()
    await drag(w, 'e', { x: 100, y: 100 }, { x: 300, y: 100 })
    // 400 → 600 宽；高不变
    expect(readoutDims(w)).toEqual({ w: 600, h: 300 })
  })

  it('拖拽超出面积上限时等比 clamp 到 9 倍原图面积以内', async () => {
    const w = mountCanvas()
    await drag(w, 'se', { x: 100, y: 100 }, { x: 6000, y: 6000 })
    const { w: rw, h: rh } = readoutDims(w)
    // 原图面积 400×300=120000，上限 9 倍 = 1_080_000
    expect(rw * rh).toBeLessThanOrEqual(1_080_000)
    expect(rw).toBeGreaterThanOrEqual(400)
    expect(rh).toBeGreaterThanOrEqual(300)
  })

  it('拖拽时实时写入 store 的 refineOutpaintRect（提交链路消费）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountCanvas()
    await drag(w, 'e', { x: 100, y: 100 }, { x: 350, y: 100 })
    expect(editor.refineOutpaintRect).not.toBeNull()
    expect(editor.refineOutpaintRect!.width).toBe(650) // 400 + (350-100)
  })

  it('busy 时手柄 disabled（冻结）', () => {
    const w = mountCanvas({ busy: true })
    for (const dir of HANDLES) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).attributes('disabled')).toBeDefined()
    }
  })

  it('拖拽超出视口时视口自动缩放跟随（fitScale 缩小）', async () => {
    const w = mountCanvas({ viewportWidth: 400, viewportHeight: 300 })
    const fitBefore = Number(w.find('[data-testid="refine-outpaint-canvas"]').attributes('data-fit'))
    // 初始 400×300 恰好铺满 400×300 视口 → fit 1
    expect(fitBefore).toBeCloseTo(1, 5)
    await drag(w, 'se', { x: 100, y: 100 }, { x: 2200, y: 2200 })
    const fitAfter = Number(w.find('[data-testid="refine-outpaint-canvas"]').attributes('data-fit'))
    expect(fitAfter).toBeLessThan(fitBefore)
  })
})
