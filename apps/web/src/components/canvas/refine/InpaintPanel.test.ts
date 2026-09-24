import { describe, expect, it, vi } from 'vitest'
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

describe('InpaintPanel（refine-inpaint 模式面板）', () => {
  it('渲染标题、画笔/橡皮/清空、笔刷大小与覆盖读数', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.get('[data-testid="inpaint-panel"]').text()).toContain('局部重绘')
    expect(wrapper.find('[data-testid="inpaint-tool-brush"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inpaint-tool-eraser"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inpaint-clear"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inpaint-brush-size"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="inpaint-coverage"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('覆盖读数分档：空 → 引导涂抹；full → 全图提示', async () => {
    const { wrapper, store } = mountPanel()
    expect(wrapper.get('[data-testid="inpaint-coverage"]').text()).toContain('尚未涂抹')
    store.refineCoverage = 0.5
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="inpaint-coverage"]').text()).toContain('已圈出重绘区域')
    store.refineCoverage = 1
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="inpaint-coverage"]').text()).toContain('全图蒙版')
    wrapper.unmount()
  })

  it('画笔/橡皮写入 store.refineTool（与 MaskEditor 共享蒙版通道）；清空调 mask handle', async () => {
    const { wrapper, store } = mountPanel()
    const clear = vi.fn()
    store.registerRefineMask({ exportPng: async () => new Blob(), clear, getCanvas: () => null, invert: () => {} })
    expect(store.refineTool).toBe('brush')
    await wrapper.get('[data-testid="inpaint-tool-eraser"]').trigger('click')
    expect(store.refineTool).toBe('eraser')
    await wrapper.get('[data-testid="inpaint-tool-brush"]').trigger('click')
    expect(store.refineTool).toBe('brush')
    await wrapper.get('[data-testid="inpaint-clear"]').trigger('click')
    expect(clear).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
