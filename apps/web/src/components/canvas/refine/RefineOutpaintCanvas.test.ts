import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  to: { x: number, y: number },
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

/** 最小 ResizeObserver 替身：记录 observe 的元素，测试里手动触发回调（模拟浏览器布局变化）。 */
class ResizeObserverStub {
  static callbacks = new Map<Element, () => void>()
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(el: Element) {
    ResizeObserverStub.callbacks.set(el, () => this.cb([], this as unknown as ResizeObserver))
  }
  unobserve(el: Element) {
    ResizeObserverStub.callbacks.delete(el)
  }
  disconnect() {
    ResizeObserverStub.callbacks.clear()
  }
}

/** 给元素钉上「浏览器里可见时的内容盒尺寸」（jsdom 无布局，clientWidth 恒 0）。 */
const stubClientSize = (el: Element, width: number, height: number) => {
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
}

describe('RefineOutpaintCanvas', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    useCanvasEditorStore().refineMode = 'outpaint'
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    ResizeObserverStub.callbacks.clear()
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
    const w = mountCanvas()
    // 视口从组件自身容器测量（真实浏览器里即扩图画布占据的工作区）
    const root = w.find('[data-testid="refine-outpaint-canvas"]').element as HTMLElement
    stubClientSize(root, 400, 300)
    ResizeObserverStub.callbacks.get(root)?.()
    await flushPromises()
    const fitBefore = Number(w.find('[data-testid="refine-outpaint-canvas"]').attributes('data-fit'))
    // 初始 400×300 在 400×300 视口内留白后略缩小 → fit ≤ 1
    expect(fitBefore).toBeLessThanOrEqual(1)
    await drag(w, 'se', { x: 100, y: 100 }, { x: 2200, y: 2200 })
    const fitAfter = Number(w.find('[data-testid="refine-outpaint-canvas"]').attributes('data-fit'))
    expect(fitAfter).toBeLessThan(fitBefore)
  })

  it('回归：视口由组件自身容器测量，基图大于容器时自动缩小（不再依赖外部隐藏元素）', async () => {
    // 复现 2026-09-22 线上缺陷：viewport 曾由父级从 display:none 的 stage 测得 → 恒 0 → fit 恒 1，
    // 工作图不缩小、8 个手柄整体跑出视口。
    const w = mountCanvas({ baseWidth: 2048, baseHeight: 2048 })
    const rootEl = w.find('[data-testid="refine-outpaint-canvas"]').element as HTMLElement
    stubClientSize(rootEl, 984, 868)
    ResizeObserverStub.callbacks.get(rootEl)?.()
    await flushPromises()

    const fit = Number(w.find('[data-testid="refine-outpaint-canvas"]').attributes('data-fit'))
    expect(fit).toBeLessThan(1)

    const stage = w.find('.refine-outpaint__stage').element as HTMLElement
    const displayW = Number((stage.style.width || '0').replace('px', ''))
    const displayH = Number((stage.style.height || '0').replace('px', ''))
    expect(displayW).toBeLessThanOrEqual(984)
    expect(displayH).toBeLessThanOrEqual(868)
  })

  it('回归：基图尺寸晚到（mediaInfo 缺宽高 → 探测后回填）也能得到合法画布', async () => {
    const w = mountCanvas({ baseWidth: 0, baseHeight: 0 })
    await w.setProps({ baseWidth: 1024, baseHeight: 768 })
    await flushPromises()
    expect(readoutDims(w)).toEqual({ w: 1024, h: 768 })
  })

  it('读数含新画布宽×高与比例（规格 §3「宽×高·比例」）', () => {
    const w = mountCanvas()
    expect(w.find('[data-testid="outpaint-readout"]').text()).toMatch(/400\s*×\s*300/)
    expect(w.find('[data-testid="outpaint-readout"]').text()).toContain('4:3')
  })
})
