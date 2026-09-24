import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    nodes: ref([]),
    findNode: () => undefined,
  }),
}))
vi.mock('@/composables/useCanvasGrouping', () => ({
  getAbsolutePosition: () => ({ x: 100, y: 100 }),
  getNodeSize: () => ({ w: 200, h: 200 }),
}))
// 原图 400×200（蒙版 canvas 按此自然分辨率建立）
vi.mock('@/components/canvas/refine/cropExport', () => ({
  loadCropSourceImage: async () => ({ naturalWidth: 400, naturalHeight: 200 }),
}))

// jsdom 无 2D context：桩一个「圆刷写入像素缓冲」的最小 fake（stroke/lineTo 为 no-op，
// fill() 把上一个 arc 圆域写入 alpha；destination-out 擦除）。
const W = 400
const H = 200
const buffer = new Uint8ClampedArray(W * H * 4)
let circle: { x: number; y: number; r: number } | null = null
const fakeCtx = {
  globalCompositeOperation: 'source-over',
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  lineCap: '',
  lineJoin: 'round',
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  arc(x: number, y: number, r: number) {
    circle = { x, y, r }
  },
  fill() {
    if (!circle) return
    const { x, y, r } = circle
    const eraser = fakeCtx.globalCompositeOperation === 'destination-out'
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue
        const px = Math.round(x + dx)
        const py = Math.round(y + dy)
        if (px < 0 || py < 0 || px >= W || py >= H) continue
        const o = (py * W + px) * 4
        if (eraser) {
          // 真实 canvas 的 destination-out 会连 premultiplied rgb 一起清零
          buffer[o] = 0
          buffer[o + 1] = 0
          buffer[o + 2] = 0
          buffer[o + 3] = 0
        } else {
          buffer[o] = 255
          buffer[o + 1] = 255
          buffer[o + 2] = 255
          buffer[o + 3] = 255
        }
      }
    }
    circle = null
  },
  clearRect() {
    buffer.fill(0)
  },
  getImageData() {
    return { width: W, height: H, data: new Uint8ClampedArray(buffer) }
  },
  putImageData(img: { data: Uint8ClampedArray }) {
    buffer.set(img.data)
  },
} as unknown as CanvasRenderingContext2D

HTMLCanvasElement.prototype.getContext = function getContext() {
  return fakeCtx
} as unknown as typeof HTMLCanvasElement.prototype.getContext

import NodeInpaintOverlay from './NodeInpaintOverlay.vue'

function mountOverlay(props: Record<string, unknown> = {}) {
  return mount(NodeInpaintOverlay, {
    props: { node: { id: 'n1', type: 'image' }, url: 'blob:src', ...props },
  })
}

async function mountReady(props: Record<string, unknown> = {}) {
  const wrapper = mountOverlay(props)
  await flushPromises()
  return wrapper
}

const pointer = (type: string, x: number, y: number) => {
  const ev = new Event(type, { bubbles: true }) as Event & { clientX: number; clientY: number }
  Object.defineProperty(ev, 'clientX', { value: x })
  Object.defineProperty(ev, 'clientY', { value: y })
  return ev
}

/** 蒙版 canvas 显示层映射：getBoundingClientRect 桩为 200×200（节点卡尺寸） */
function stubCanvasRect(wrapper: ReturnType<typeof mount>) {
  const canvas = wrapper.get('[data-testid="node-inpaint-canvas"]').element as HTMLCanvasElement
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, x: 0, y: 0 }) as DOMRect
}

describe('NodeInpaintOverlay（节点直出局部重绘）', () => {
  beforeEach(() => {
    // fake canvas 像素缓冲跨用例共享，逐用例清零防串扰
    buffer.fill(0)
  })

  it('渲染蒙版画布 + 工具卡（画笔/橡皮/大小/撤销/重做/清空）+ prompt 卡（无张数）', async () => {
    const wrapper = await mountReady()
    expect(wrapper.find('[data-testid="node-inpaint-canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-inpaint-toolbar"]').exists()).toBe(true)
    for (const id of ['brush', 'eraser', 'size', 'undo', 'redo', 'clear']) {
      expect(wrapper.find(`[data-testid="node-inpaint-${id}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-testid="node-inpaint-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-inpaint-prompt"]').exists()).toBe(true)
    // 无「张数」选择（用户微调要求）
    expect(wrapper.text()).not.toContain('张数')
    // 初始（未涂抹/未输入）确认禁用
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('涂抹 + 输入描述后确认可用，emit { prompt, maskCanvas }', async () => {
    const wrapper = await mountReady()
    stubCanvasRect(wrapper)
    const stage = wrapper.get('[data-testid="node-inpaint-stage"]')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(pointer('pointermove', 120, 60))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()

    await wrapper.get('[data-testid="node-inpaint-prompt"]').setValue('眼珠换成绿色，发蓝光')
    const confirm = wrapper.get('[data-testid="node-inpaint-confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    const emitted = wrapper.emitted('confirm')
    expect(emitted).toHaveLength(1)
    const payload = emitted![0]![0] as { prompt: string; maskCanvas: HTMLCanvasElement }
    expect(payload.prompt).toBe('眼珠换成绿色，发蓝光')
    expect(payload.maskCanvas.tagName).toBe('CANVAS')
    expect(payload.maskCanvas.width).toBe(400)
    expect(payload.maskCanvas.height).toBe(200)
    wrapper.unmount()
  })

  it('橡皮擦回涂抹区域后确认重新禁用；清空同样禁用', async () => {
    const wrapper = await mountReady()
    stubCanvasRect(wrapper)
    const stage = wrapper.get('[data-testid="node-inpaint-stage"]')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    await wrapper.get('[data-testid="node-inpaint-prompt"]').setValue('重绘')
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeUndefined()

    // 橡皮在同位置擦除
    await wrapper.get('[data-testid="node-inpaint-eraser"]').trigger('click')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeDefined()

    // 画笔重涂后再清空
    await wrapper.get('[data-testid="node-inpaint-brush"]').trigger('click')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="node-inpaint-clear"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('撤销涂抹后确认禁用（蒙版历史栈生效）', async () => {
    const wrapper = await mountReady()
    stubCanvasRect(wrapper)
    const stage = wrapper.get('[data-testid="node-inpaint-stage"]')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    await wrapper.get('[data-testid="node-inpaint-undo"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-testid="node-inpaint-prompt"]').setValue('重绘')
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeDefined()
    // 重做恢复
    await wrapper.get('[data-testid="node-inpaint-redo"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('Esc 退出（emit cancel）', async () => {
    const wrapper = await mountReady()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })
})
