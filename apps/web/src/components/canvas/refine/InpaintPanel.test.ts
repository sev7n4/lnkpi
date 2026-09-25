import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import InpaintPanel from './InpaintPanel.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

function mountPanel() {
  setActivePinia(createPinia())
  const store = useCanvasEditorStore()
  const wrapper = mount(InpaintPanel, { props: { busy: false } })
  return { wrapper, store }
}

function makePiece(w = 10, h = 10): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

describe('InpaintPanel（refine-inpaint 模式面板，2026-09-25 芯片化）', () => {
  it('渲染标题、画笔、笔刷大小与覆盖读数（芯片化后不再有橡皮/清空）', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.get('[data-testid="inpaint-panel"]').text()).toContain('局部重绘')
    expect(wrapper.find('[data-testid="inpaint-tool-brush"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inpaint-tool-eraser"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="inpaint-clear"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="inpaint-brush-size"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('覆盖读数分档：空 → 引导涂抹；有芯片 → 切换为芯片条列表', async () => {
    const { wrapper, store } = mountPanel()
    expect(wrapper.get('[data-testid="inpaint-coverage"]').text()).toContain('尚未涂抹')
    store.refineCoverage = 0.5
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="inpaint-coverage"]').text()).toContain('已圈出重绘区域')
    const item = store.addInpaintStrokeChip(makePiece())
    expect(item).not.toBeNull()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="inpaint-chips"]').exists()).toBe(true)
    // name 是 input：jsdom text() 不含 input value，直接断言元素值
    const nameInput = wrapper.get(`[data-testid="ecr-name-${item!.id}"]`).element as HTMLInputElement
    expect(nameInput.value).toBe('重绘区域')
    wrapper.unmount()
  })

  it('芯片条：× 删除芯片（主蒙版同步擦除走 store）；撤销上一处按钮', async () => {
    const { wrapper, store } = mountPanel()
    const a = store.addInpaintStrokeChip(makePiece())
    const b = store.addInpaintStrokeChip(makePiece())
    expect(a && b).toBeTruthy()
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-testid^="ecr-"]').length).toBeGreaterThan(0)
    await wrapper.get(`[data-testid="ecr-remove-${a!.id}"]`).trigger('click')
    expect(store.refineElementItems.map((it) => it.id)).toEqual([b!.id])
    await wrapper.get('[data-testid="inpaint-undo-chip"]').trigger('click')
    expect(store.refineElementItems).toHaveLength(0)
    wrapper.unmount()
  })
})
