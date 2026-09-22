import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import OutpaintPanel from './OutpaintPanel.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { initialOutpaintRect } from './outpaintGeometry'

const BASE = { width: 400, height: 300 }
let pinia: Pinia

const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(OutpaintPanel, { props, global: { plugins: [pinia] } })

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  const editor = useCanvasEditorStore()
  editor.refineMode = 'outpaint'
  editor.setRefineOutpaintBase(BASE)
  editor.setRefineOutpaintRect(initialOutpaintRect(BASE))
})

describe('OutpaintPanel', () => {
  it('渲染 6 个比例 chips + 宽高输入 + 四向读数 + 重置', () => {
    const w = mountPanel()
    for (const id of ['base', '1-1', '4-3', '3-4', '16-9', '9-16']) {
      expect(w.find(`[data-testid="outpaint-aspect-${id}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-width-input"]').exists()).toBe(true)
    expect(w.find('[data-testid="outpaint-height-input"]').exists()).toBe(true)
    for (const dir of ['west', 'east', 'north', 'south']) {
      expect(w.find(`[data-testid="outpaint-ext-${dir}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="outpaint-reset"]').exists()).toBe(true)
  })

  it('未扩展时「原图」chip 激活且显示守卫提示', () => {
    const w = mountPanel()
    expect(w.find('[data-testid="outpaint-aspect-base"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="outpaint-panel-hint"]').text()).toContain('先拖动')
  })

  it('点 1:1 chip → 调用 store 比例预设（对称扩展），chips 激活态与数字同步', async () => {
    const w = mountPanel()
    await w.find('[data-testid="outpaint-aspect-1-1"]').trigger('click')
    const editor = useCanvasEditorStore()
    expect(editor.refineOutpaintRect).toEqual({ x: 0, y: 50, width: 400, height: 400 })
    expect(w.find('[data-testid="outpaint-aspect-1-1"]').classes()).toContain('is-active')
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('400')
    expect((w.find('[data-testid="outpaint-height-input"]').element as HTMLInputElement).value).toBe('400')
    expect(w.find('[data-testid="outpaint-panel-hint"]').exists()).toBe(false)
  })

  it('四向读数随 rect 变化（1:1 → 上下各 50）', async () => {
    const w = mountPanel()
    await w.find('[data-testid="outpaint-aspect-1-1"]').trigger('click')
    expect(w.find('[data-testid="outpaint-ext-west"]').text()).toContain('0')
    expect(w.find('[data-testid="outpaint-ext-north"]').text()).toContain('50')
    expect(w.find('[data-testid="outpaint-ext-south"]').text()).toContain('50')
  })

  it('改宽度输入 → applyOutpaintSize 绝对值语义', async () => {
    const w = mountPanel()
    const input = w.find('[data-testid="outpaint-width-input"]')
    await input.setValue('600')
    await input.trigger('change')
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual({ x: 100, y: 0, width: 600, height: 300 })
  })

  it('宽度输入非法值（空串）→ 不写坏 rect，输入框回落为落像素值', async () => {
    const w = mountPanel()
    const input = w.find('[data-testid="outpaint-width-input"]')
    await input.setValue('')
    await input.trigger('change')
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('400')
  })

  it('busy 时 chips / 输入 / 重置全部禁用', () => {
    const w = mountPanel({ busy: true })
    expect(w.find('[data-testid="outpaint-aspect-1-1"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="outpaint-width-input"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="outpaint-reset"]').attributes('disabled')).toBeDefined()
  })

  it('store 里是小数矩形（拖拽中）时，输入与读数显示落像素后的整数且不出现 -0', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineOutpaintRect({ x: 0.4, y: 49.6, width: 400.2, height: 400.9 })
    const w = mountPanel()
    await flushPromises()
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('400')
    expect((w.find('[data-testid="outpaint-height-input"]').element as HTMLInputElement).value).toBe('400')
    expect(w.find('[data-testid="outpaint-ext-north"]').text()).not.toContain('-')
    expect(w.find('[data-testid="outpaint-ext-south"]').text()).not.toContain('-')
  })

  it('基准缺失（原图尺寸未知）时面板整体禁用且不渲染数字', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineOutpaintBase(null)
    editor.setRefineOutpaintRect(null)
    const w = mountPanel()
    expect(w.find('[data-testid="outpaint-aspect-1-1"]').attributes('disabled')).toBeDefined()
    expect((w.find('[data-testid="outpaint-width-input"]').element as HTMLInputElement).value).toBe('')
  })

  it('重置 → 恢复原图矩形', async () => {
    const w = mountPanel()
    await w.find('[data-testid="outpaint-aspect-1-1"]').trigger('click')
    await w.find('[data-testid="outpaint-reset"]').trigger('click')
    expect(useCanvasEditorStore().refineOutpaintRect).toEqual(initialOutpaintRect(BASE))
  })
})
