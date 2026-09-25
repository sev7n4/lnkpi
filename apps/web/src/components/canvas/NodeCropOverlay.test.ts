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
// 原图 400×200（2:1）：「原图比例」初始框 = 卡内居中 2:1 带
vi.mock('@/components/canvas/refine/cropExport', () => ({
  loadCropSourceImage: async () => ({ naturalWidth: 400, naturalHeight: 200 }),
}))

import NodeCropOverlay from './NodeCropOverlay.vue'

function mountOverlay(props: Record<string, unknown> = {}) {
  return mount(NodeCropOverlay, {
    props: { node: { id: 'n1', type: 'image' }, url: 'blob:src', ...props },
  })
}

async function mountReady(props: Record<string, unknown> = {}) {
  const wrapper = mountOverlay(props)
  await flushPromises()
  return wrapper
}

describe('NodeCropOverlay', () => {
  it('渲染确认卡（取消/比例触发/确认）与 8 手柄 + 三分网格', async () => {
    const wrapper = await mountReady()
    expect(wrapper.find('[data-testid="node-crop-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-crop-cancel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-crop-aspect-trigger"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-crop-confirm"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-handle]')).toHaveLength(8)
    expect(wrapper.findAll('.node-crop-grid-line')).toHaveLength(4)
    wrapper.unmount()
  })

  it('原图就绪后「原图比例」初始框为卡内居中 2:1 带；确认上抛 display rect', async () => {
    const wrapper = await mountReady()
    const rectEl = wrapper.get('[data-testid="node-crop-rect"]')
    // 200×200 卡内最大居中 2:1 框：w=200, h=100, y=50
    expect(rectEl.attributes('style')).toContain('width: 200px')
    expect(rectEl.attributes('style')).toContain('height: 100px')
    expect(rectEl.attributes('style')).toContain('top: 50px')
    await wrapper.get('[data-testid="node-crop-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ x: 0, y: 50, width: 200, height: 100 }]])
    wrapper.unmount()
  })

  it('比例下拉：打开菜单含 7 项，点 16:9 重配为 16:9 框', async () => {
    const wrapper = await mountReady()
    await wrapper.get('[data-testid="node-crop-aspect-trigger"]').trigger('click')
    const menu = wrapper.get('[data-testid="node-crop-aspect-menu"]')
    expect(menu.findAll('[data-aspect]')).toHaveLength(7)
    expect(menu.text()).toContain('原图比例')
    await menu.get('[data-aspect="16:9"]').trigger('click')
    const rectEl = wrapper.get('[data-testid="node-crop-rect"]')
    expect(rectEl.attributes('style')).toContain('width: 200px')
    expect(rectEl.attributes('style')).toContain('height: 112.5px')
    // 选完自动收菜单
    expect(wrapper.find('[data-testid="node-crop-aspect-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('取消按钮 / Esc 都 emit cancel；菜单打开时 Esc 只收菜单', async () => {
    const wrapper = await mountReady()
    await wrapper.get('[data-testid="node-crop-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.get('[data-testid="node-crop-aspect-trigger"]').trigger('click')
    expect(wrapper.find('[data-testid="node-crop-aspect-menu"]').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1) // 未新增
    expect(wrapper.find('[data-testid="node-crop-aspect-menu"]').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(2)
    wrapper.unmount()
  })

  it('拖拽裁剪框平移；拖 e 手柄 resize', async () => {
    const wrapper = await mountReady()
    // 切「自定义」（free）避免比例锁定干扰
    await wrapper.get('[data-testid="node-crop-aspect-trigger"]').trigger('click')
    await wrapper.get('[data-testid="node-crop-aspect-menu"]').get('[data-aspect="free"]').trigger('click')
    // 此时框 = 原比例带 (0,50,200,100) 保持不变（free 保留当前框）

    // jsdom 事件坐标只读：defineProperty 构造可带坐标的 pointer 事件
    const pointer = (type: string, x: number, y: number) => {
      const ev = new Event(type, { bubbles: true }) as Event & { clientX: number; clientY: number }
      Object.defineProperty(ev, 'clientX', { value: x })
      Object.defineProperty(ev, 'clientY', { value: y })
      return ev
    }
    const rectEl = wrapper.get('[data-testid="node-crop-rect"]')
    rectEl.element.dispatchEvent(pointer('pointerdown', 100, 100))
    window.dispatchEvent(pointer('pointermove', 100, 130))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(rectEl.attributes('style')).toContain('top: 80px')

    // w 手柄右移 40px：左缘内收 → left 40 / 宽 160
    const wHandle = wrapper.get('[data-handle="w"]')
    wHandle.element.dispatchEvent(pointer('pointerdown', 0, 130))
    window.dispatchEvent(pointer('pointermove', 40, 130))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(rectEl.attributes('style')).toContain('left: 40px')
    expect(rectEl.attributes('style')).toContain('width: 160px')

    // 左移 30px 让出右缘空间 → left 10
    rectEl.element.dispatchEvent(pointer('pointerdown', 60, 130))
    window.dispatchEvent(pointer('pointermove', 30, 130))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(rectEl.attributes('style')).toContain('left: 10px')

    // e 手柄右移 20px：宽 180（右缘 190 未到卡界）
    const eHandle = wrapper.get('[data-handle="e"]')
    eHandle.element.dispatchEvent(pointer('pointerdown', 170, 130))
    window.dispatchEvent(pointer('pointermove', 190, 130))
    window.dispatchEvent(new Event('pointerup'))
    await nextTick()
    expect(rectEl.attributes('style')).toContain('width: 180px')
    wrapper.unmount()
  })

  it('busy 时确认禁用且文案为「裁剪中…」', async () => {
    const wrapper = await mountReady({ busy: true })
    const confirm = wrapper.get('[data-testid="node-crop-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.text()).toBe('裁剪中…')
    wrapper.unmount()
  })

  it('卡片位于节点上沿（placement top）；节点贴视口顶时翻到下方', async () => {
    const wrapper = await mountReady()
    const card = wrapper.get('[data-testid="node-crop-card"]').element.parentElement as HTMLElement
    expect(card.style.transform).toContain('translate(-50%, -100%)')
    wrapper.unmount()
  })

  it('目标尺寸输入：合法值锁定自定义宽高比（触发器显示 W×H）；非法值提示格式', async () => {
    const wrapper = await mountReady()
    await wrapper.get('[data-testid="node-crop-aspect-trigger"]').trigger('click')
    await wrapper.get('[data-testid="node-crop-size-input"]').setValue('1024x768')
    await wrapper.get('[data-testid="node-crop-size-apply"]').trigger('click')
    // 应用后菜单收起，触发器 label 显示目标尺寸
    expect(wrapper.find('[data-testid="node-crop-aspect-menu"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="node-crop-aspect-trigger"]').text()).toContain('1024×768')

    await wrapper.get('[data-testid="node-crop-aspect-trigger"]').trigger('click')
    await wrapper.get('[data-testid="node-crop-size-input"]').setValue('abc')
    await wrapper.get('[data-testid="node-crop-size-apply"]').trigger('click')
    expect(wrapper.get('[data-testid="node-crop-size-hint"]').text()).toBe('格式：宽x高，如 1024x768')
    wrapper.unmount()
  })
})
