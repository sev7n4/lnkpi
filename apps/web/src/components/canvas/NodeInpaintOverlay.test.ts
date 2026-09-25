import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
// 原图 400×200（蒙版按此自然分辨率建立）
vi.mock('@/components/canvas/refine/cropExport', () => ({
  loadCropSourceImage: async () => ({ naturalWidth: 400, naturalHeight: 200 }),
}))

// jsdom 无 2D context：桩最小 fake（fillRect 写入像素缓冲，供 paintElementEditMask 断言）
const W = 400
const H = 200
const buffer = new Uint8ClampedArray(W * H * 4)
const fakeCtx = {
  globalCompositeOperation: 'source-over',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  lineCap: '',
  lineJoin: 'round',
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  arc() {},
  fill() {},
  stroke() {},
  fillRect(x: number, y: number, w: number, h: number) {
    if (fakeCtx.globalCompositeOperation === 'destination-out') return
    for (let py = Math.max(0, Math.round(y)); py < Math.min(H, Math.round(y + h)); py += 1) {
      for (let px = Math.max(0, Math.round(x)); px < Math.min(W, Math.round(x + w)); px += 1) {
        const o = (py * W + px) * 4
        buffer[o] = 255
        buffer[o + 1] = 255
        buffer[o + 2] = 255
        buffer[o + 3] = 255
      }
    }
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

// 非破坏性桩：真实 2d context 可用（CI canvas mock / canvas 包）时透传；
// 仅 jsdom 无 2d 实现时回落 fakeCtx。直接覆盖原型会泄漏到同进程后续测试文件。
const originalGetContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function getContext(
  this: HTMLCanvasElement,
  ...args: Parameters<typeof HTMLCanvasElement.prototype.getContext>
) {
  const real = originalGetContext.apply(this, args)
  if (real) return real
  return fakeCtx
} as unknown as typeof HTMLCanvasElement.prototype.getContext

// singleFork 顺序执行下必须还原：否则后续测试文件的「无 2d context」前提被破坏
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
})

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

/** stage 显示层映射：getBoundingClientRect 桩为 200×200（节点卡尺寸） */
function stubStageRect(wrapper: ReturnType<typeof mount>) {
  const stage = wrapper.get('[data-testid="node-inpaint-stage"]').element as HTMLElement
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, x: 0, y: 0 }) as DOMRect
}

/** 切到矩形工具后拖框（display 40,40 → 120,100） */
async function drawRect(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="node-inpaint-rect"]').trigger('click')
  const stage = wrapper.get('[data-testid="node-inpaint-stage"]')
  stage.element.dispatchEvent(pointer('pointerdown', 40, 40))
  window.dispatchEvent(pointer('pointermove', 120, 100))
  window.dispatchEvent(new Event('pointerup'))
  await nextTick()
}

describe('NodeInpaintOverlay（节点直出局部重绘 · 芯片化）', () => {
  beforeEach(() => {
    buffer.fill(0)
    fakeCtx.globalCompositeOperation = 'source-over'
  })

  it('渲染工具卡（画笔/矩形/大小/撤销）+ prompt 卡；确认初始禁用且带积分', async () => {
    const wrapper = await mountReady()
    expect(wrapper.find('[data-testid="node-inpaint-toolbar"]').exists()).toBe(true)
    for (const id of ['brush', 'rect', 'size', 'undo']) {
      expect(wrapper.find(`[data-testid="node-inpaint-${id}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-testid="node-inpaint-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-inpaint-prompt"]').exists()).toBe(true)
    // 无「张数」选择（用户微调要求）
    expect(wrapper.text()).not.toContain('张数')
    const confirm = wrapper.get('[data-testid="node-inpaint-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.text()).toContain('10积分')
    wrapper.unmount()
  })

  it('画笔涂抹松手成芯片；输入描述后确认 emit { prompt, maskCanvas, refUrls }', async () => {
    const wrapper = await mountReady()
    stubStageRect(wrapper)
    const stage = wrapper.get('[data-testid="node-inpaint-stage"]')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(pointer('pointermove', 120, 60))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()

    // 芯片条出现（1处）
    expect(wrapper.find('[data-testid="node-inpaint-chips"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="node-inpaint-count"]').text()).toBe('1处')

    await wrapper.get('[data-testid="node-inpaint-prompt"]').setValue('眼珠换成绿色，发蓝光')
    const confirm = wrapper.get('[data-testid="node-inpaint-confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    const emitted = wrapper.emitted('confirm')
    expect(emitted).toHaveLength(1)
    const payload = emitted![0]![0] as { prompt: string; maskCanvas: HTMLCanvasElement; refUrls: string[] }
    expect(payload.prompt).toBe('眼珠换成绿色，发蓝光')
    expect(payload.maskCanvas.tagName).toBe('CANVAS')
    expect(payload.maskCanvas.width).toBe(400)
    expect(payload.maskCanvas.height).toBe(200)
    expect(payload.refUrls).toEqual([])
    wrapper.unmount()
  })

  it('矩形框选成芯片并出现 8 手柄；仅芯片修改内容也可确认（prompt 组合替换语义）', async () => {
    const wrapper = await mountReady()
    stubStageRect(wrapper)
    await drawRect(wrapper)

    // 选中态出现 8 手柄框
    const frame = wrapper.get('[data-testid="rect-handle-frame"]')
    for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(frame.find(`[data-handle="${dir}"]`).exists()).toBe(true)
    }

    // 芯片填修改内容 + 替换图 → 确认（无全局 prompt 也可用）
    const nameTestid = wrapper.get('[data-testid^="ecr-name-"]').attributes('data-testid')!
    const chipId = nameTestid.replace('ecr-name-', '')
    await wrapper.get(`[data-testid="ecr-name-${chipId}"]`).setValue('logo')
    await wrapper.get(`[data-testid="ecr-modify-toggle-${chipId}"]`).trigger('click')
    await wrapper.get(`[data-testid="ecr-modify-${chipId}"]`).setValue('换成乔丹 logo')
    const confirm = wrapper.get('[data-testid="node-inpaint-confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    // 等缩略图/替换图副作用 settle
    await flushPromises()
    await wrapper.get('[data-testid="node-inpaint-confirm"]').trigger('click')
    const payload = wrapper.emitted('confirm')![0]![0] as { prompt: string; refUrls: string[] }
    expect(payload.prompt).toContain('logo 换成乔丹 logo')
    expect(payload.refUrls).toEqual([])
    wrapper.unmount()
  })

  it('矩形芯片 8 手柄调整：更新矩形并刷新蒙版（拖拽后 emit rect 变化）', async () => {
    const wrapper = await mountReady()
    stubStageRect(wrapper)
    await drawRect(wrapper)
    buffer.fill(0)

    const frame = wrapper.get('[data-testid="rect-handle-frame"]')
    // 真实交互：拖 se 手柄 clientX/Y +100（zoom=1 → display 增量 100）
    frame.get('[data-handle="se"]').element.dispatchEvent(pointer('pointerdown', 120, 100))
    window.dispatchEvent(pointer('pointermove', 220, 200))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    await wrapper.get('[data-testid="node-inpaint-prompt"]').setValue('重绘')
    await wrapper.get('[data-testid="node-inpaint-confirm"]').trigger('click')
    // 蒙版 buffer 中应有白色像素（fillRect 落过）
    expect(buffer.some((v) => v === 255)).toBe(true)
    wrapper.unmount()
  })

  it('撤销移除最后一枚芯片后确认禁用；× 删除指定芯片', async () => {
    const wrapper = await mountReady()
    stubStageRect(wrapper)
    const stage = wrapper.get('[data-testid="node-inpaint-stage"]')
    stage.element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    await wrapper.get('[data-testid="node-inpaint-prompt"]').setValue('重绘')
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="node-inpaint-undo"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-testid="node-inpaint-confirm"]').attributes('disabled')).toBeDefined()
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
