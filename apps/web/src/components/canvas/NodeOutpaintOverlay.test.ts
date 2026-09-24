import { describe, expect, it, vi } from 'vitest'
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
// 原图 400×200：kx = 200/400 = 0.5，ky = 200/200 = 1（显示↔像素双轴映射）
vi.mock('@/components/canvas/refine/cropExport', () => ({
  loadCropSourceImage: async () => ({ naturalWidth: 400, naturalHeight: 200 }),
}))

import NodeOutpaintOverlay from './NodeOutpaintOverlay.vue'

function mountOverlay(props: Record<string, unknown> = {}) {
  return mount(NodeOutpaintOverlay, {
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

describe('NodeOutpaintOverlay（节点直出扩图）', () => {
  it('渲染扩图框 + 8 手柄 + 参数卡（取消/比例/确认）；初始无扩出时确认禁用', async () => {
    const wrapper = await mountReady()
    expect(wrapper.find('[data-testid="node-outpaint-stage"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-outpaint-base"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-handle]')).toHaveLength(8)
    expect(wrapper.find('[data-testid="node-outpaint-card"]').exists()).toBe(true)
    const confirm = wrapper.get('[data-testid="node-outpaint-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('初始 stage 与节点框重合（无扩出）；拖 e 手柄向外扩展，确认上抛像素矩形', async () => {
    const wrapper = await mountReady()
    const stage = wrapper.get('[data-testid="node-outpaint-stage"]')
    // base 400×200 → 显示 200×200（kx=0.5, ky=1），初始 rect = 原图矩形
    expect(stage.attributes('style')).toContain('left: 100px')
    expect(stage.attributes('style')).toContain('top: 100px')
    expect(stage.attributes('style')).toContain('width: 200px')
    expect(stage.attributes('style')).toContain('height: 200px')

    // e 手柄：clientX +50 → 显示 dx=50 → 像素 dpx=100 → width 400→500
    const eHandle = wrapper.get('[data-handle="e"]')
    eHandle.element.dispatchEvent(pointer('pointerdown', 300, 200))
    window.dispatchEvent(pointer('pointermove', 350, 200))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(stage.attributes('style')).toContain('width: 250px')

    const confirm = wrapper.get('[data-testid="node-outpaint-confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ x: 0, y: 0, width: 500, height: 200 }]])
    wrapper.unmount()
  })

  it('比例下拉 7 项；点 1:1 重配为包含原图的最小 1:1 画布', async () => {
    const wrapper = await mountReady()
    await wrapper.get('[data-testid="node-outpaint-aspect-trigger"]').trigger('click')
    const menu = wrapper.get('[data-testid="node-outpaint-aspect-menu"]')
    expect(menu.findAll('[data-aspect]')).toHaveLength(7)
    expect(menu.text()).toContain('原图比例')
    await menu.get('[data-aspect="1:1"]').trigger('click')
    const stage = wrapper.get('[data-testid="node-outpaint-stage"]')
    // fitRectToAspect({400,200},{1,1}) = {x:0, y:72, w:400, h:400}
    // → stage: top = 100 - 72*1 = 28，height = 400*1 = 400
    expect(stage.attributes('style')).toContain('top: 28px')
    expect(stage.attributes('style')).toContain('height: 400px')
    expect(wrapper.find('[data-testid="node-outpaint-aspect-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('参数卡默认挂在扩图框下方，比例菜单向下弹（不覆盖图片）', async () => {
    const wrapper = await mountReady()
    await wrapper.get('[data-testid="node-outpaint-aspect-trigger"]').trigger('click')
    const menu = wrapper.get('[data-testid="node-outpaint-aspect-menu"]')
    expect(menu.classes()).toContain('is-below')
    wrapper.unmount()
  })

  it('取消按钮 / Esc 都 emit cancel；菜单打开时 Esc 只收菜单', async () => {
    const wrapper = await mountReady()
    await wrapper.get('[data-testid="node-outpaint-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.get('[data-testid="node-outpaint-aspect-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="node-outpaint-aspect-menu"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.find('[data-testid="node-outpaint-aspect-menu"]').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(2)
    wrapper.unmount()
  })
})
