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

/** 底部读数条已移除（常驻读数在右栏 OutpaintPanel），落像素后的权威值在 store。 */
const readoutDims = (w: ReturnType<typeof mountCanvas>) => {
  void w
  const rect = useCanvasEditorStore().refineOutpaintRect
  return { w: Math.floor(rect?.width ?? 0), h: Math.floor(rect?.height ?? 0) }
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

  it('渲染 8 个拖拽手柄，且不再有底部读数条', () => {
    const w = mountCanvas()
    for (const dir of HANDLES) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-readout"]').exists()).toBe(false)
  })

  it('进入扩图即把初始矩形写入 store（画布与面板同源）', () => {
    mountCanvas()
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(useCanvasEditorStore().refineOutpaintBase).toEqual({ width: 400, height: 300 })
  })

  it('原图尺寸未知（0×0）时不写退化矩形：store 保持 null（守卫据此禁用 CTA）', () => {
    mountCanvas({ baseWidth: 0, baseHeight: 0 })
    expect(useCanvasEditorStore().refineOutpaintRect).toBeNull()
    expect(useCanvasEditorStore().refineOutpaintBase).toEqual({ width: 0, height: 0 })
  })

  it('角手柄与边手柄带各自的形状类（角圆 / 边胶囊的样式挂点）', () => {
    const w = mountCanvas()
    for (const dir of ['nw', 'ne', 'se', 'sw']) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).classes()).toContain(`refine-outpaint__handle--${dir}`)
    }
    for (const dir of ['n', 'e', 's', 'w']) {
      expect(w.find(`[data-testid="outpaint-handle-${dir}"]`).classes()).toContain(`refine-outpaint__handle--${dir}`)
    }
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

  it('store 侧改动（比例预设）即时反映到画布矩形', async () => {
    const w = mountCanvas()
    useCanvasEditorStore().applyOutpaintAspectPreset({ w: 1, h: 1 })
    await flushPromises()
    expect(readoutDims(w)).toEqual({ w: 400, h: 400 })
  })

  it('拖拽中显示 3×3 网格与顶部尺寸胶囊，松手后消失且范围保留', async () => {
    const w = mountCanvas()
    const handle = w.find('[data-testid="outpaint-handle-e"]')
    handle.element.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }))
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 0 }))
    await flushPromises()

    expect(w.find('[data-testid="outpaint-grid"]').exists()).toBe(true)
    const badge = w.find('[data-testid="outpaint-drag-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('520 × 300')

    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
    await flushPromises()
    expect(w.find('[data-testid="outpaint-grid"]').exists()).toBe(false)
    expect(w.find('[data-testid="outpaint-drag-badge"]').exists()).toBe(false)
    // 松手 = 确定范围，不生成：rect 留在 store
    expect(readoutDims(w)).toEqual({ w: 520, h: 300 })
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

  it('拖拽胶囊含新画布宽×高与比例（规格 §3「宽×高·比例」）', async () => {
    const w = mountCanvas()
    const handle = w.find('[data-testid="outpaint-handle-e"]')
    handle.element.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }))
    await flushPromises()
    const badge = w.find('[data-testid="outpaint-drag-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toMatch(/400\s*×\s*300/)
    expect(badge.text()).toContain('4:3')
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
    await flushPromises()
  })
})

/**
 * 回归（2026-09-22 用户报告）：「先向上扩，再向下扩，之前向上扩出来的蒙版看不到了」，
 * 左右手柄 / 对角手柄同样症状。
 *
 * 根因：画布状态只有 (尺寸, anchor)，而 anchor 被「最后一次拖拽的手柄」整体覆盖，
 * 原图在新画布中的偏移由 anchor 重新解算 → 先前扩出的边被吞掉。
 * 正确语义：每条边独立累积，拖拽只移动手柄所在的那条边，对边固定。
 */
describe('RefineOutpaintCanvas 多边累积扩展', () => {
  // 权威草稿在 store：本组用例必须逐条重置 store，否则上一条拖动出的 rect 会被下一条继承。
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

  const offsetOf = (w: ReturnType<typeof mountCanvas>) => {
    const el = w.find('.refine-outpaint__base').element as HTMLElement
    return { left: el.style.left, top: el.style.top }
  }

  it('n 向上扩 100 后 s 向下扩 100：上方扩出区必须保留（基准偏移 y=100）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountCanvas()
    await drag(w, 'n', { x: 200, y: 0 }, { x: 200, y: -100 })
    expect(readoutDims(w)).toEqual({ w: 400, h: 400 })
    expect(editor.refineOutpaintRect).toMatchObject({ x: 0, y: 100, width: 400, height: 400 })

    await drag(w, 's', { x: 200, y: 400 }, { x: 200, y: 500 })
    expect(readoutDims(w)).toEqual({ w: 400, h: 500 })
    // 关键：原图仍贴在新画布 y=100（上方 100px 扩出区未被吞），下方又多 100
    expect(editor.refineOutpaintRect).toMatchObject({ x: 0, y: 100, width: 400, height: 500 })
    expect(offsetOf(w).top).toBe('100px')
  })

  it('e 向右扩 100 后 w 向左扩 100：右侧扩出区必须保留（基准偏移 x=100）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountCanvas()
    await drag(w, 'e', { x: 400, y: 150 }, { x: 500, y: 150 })
    expect(editor.refineOutpaintRect).toMatchObject({ x: 0, y: 0, width: 500, height: 300 })

    await drag(w, 'w', { x: 0, y: 150 }, { x: -100, y: 150 })
    expect(readoutDims(w)).toEqual({ w: 600, h: 300 })
    expect(editor.refineOutpaintRect).toMatchObject({ x: 100, y: 0, width: 600, height: 300 })
    expect(offsetOf(w).left).toBe('100px')
  })

  it('nw 向左上扩后 se 向右下扩：两个对角扩出区同时在（原图居中偏移 100,100）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountCanvas()
    await drag(w, 'nw', { x: 0, y: 0 }, { x: -100, y: -100 })
    expect(editor.refineOutpaintRect).toMatchObject({ x: 100, y: 100, width: 500, height: 400 })

    await drag(w, 'se', { x: 400, y: 300 }, { x: 500, y: 400 })
    expect(readoutDims(w)).toEqual({ w: 600, h: 500 })
    expect(editor.refineOutpaintRect).toMatchObject({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('向内拖拽只收缩该边，不越过原图边界（对边扩出区不受影响）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountCanvas()
    await drag(w, 'e', { x: 400, y: 150 }, { x: 500, y: 150 }) // 右侧 +100
    await drag(w, 'w', { x: 0, y: 150 }, { x: 50, y: 150 }) // 左侧内拖 50：左扩出量 0 → 停在原图左边界
    expect(editor.refineOutpaintRect).toMatchObject({ x: 0, y: 0, width: 500, height: 300 })
  })

  it('同一边连续两次拖拽按累计位移处理（第二次以上次结果为起点）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountCanvas()
    await drag(w, 'e', { x: 400, y: 150 }, { x: 450, y: 150 })
    await drag(w, 'e', { x: 450, y: 150 }, { x: 500, y: 150 })
    expect(editor.refineOutpaintRect).toMatchObject({ x: 0, y: 0, width: 500, height: 300 })
  })
})
