import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineSelectionPanel from './RefineSelectionPanel.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

let pinia: Pinia
const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(RefineSelectionPanel, { props, global: { plugins: [pinia] } })

describe('RefineSelectionPanel', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })

  it('渲染三组 7 枚工具、选择方式两开关、选区操作两命令', () => {
    const w = mountPanel()
    for (const tool of ['point', 'wand', 'rect', 'ellipse', 'polygon', 'brush', 'eraser']) {
      expect(w.find(`[data-testid="refine-selection-tool-${tool}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="refine-selection-op-add"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-selection-op-subtract"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-selection-command-invert"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-selection-command-clear"]').exists()).toBe(true)
  })

  it('busy 时选择方式 / 工具 / 命令全部禁用', () => {
    const w = mountPanel({ busy: true })
    const nodes = [
      ...w.findAll('[data-testid^="refine-selection-op-"]'),
      ...w.findAll('[data-testid^="refine-selection-tool-"]'),
      ...w.findAll('[data-testid^="refine-selection-command-"]'),
    ]
    expect(nodes.length).toBe(11) // 2 选择方式 + 7 工具 + 2 命令
    for (const node of nodes) expect(node.attributes('disabled')).toBeDefined()
  })

  it('点工具写 store，参数区随 param 三态切换', async () => {
    const editor = useCanvasEditorStore()
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-tool-wand"]').trigger('click')
    expect(editor.refineTool).toBe('wand')
    expect(w.find('[data-testid="refine-selection-param-wand"]').exists()).toBe(true)
    await w.find('[data-testid="refine-selection-tool-rect"]').trigger('click')
    expect(w.find('[data-testid="refine-selection-param-none"]').exists()).toBe(true)
    await w.find('[data-testid="refine-selection-tool-brush"]').trigger('click')
    expect(w.find('[data-testid="refine-selection-param-brush"]').exists()).toBe(true)
  })

  it('工具与开关联动：画笔→加选、橡皮→减选、矩形保持当前开关', async () => {
    const editor = useCanvasEditorStore()
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-op-subtract"]').trigger('click')
    await w.find('[data-testid="refine-selection-tool-rect"]').trigger('click')
    expect(editor.refineMaskOp).toBe('subtract')
    await w.find('[data-testid="refine-selection-tool-brush"]').trigger('click')
    expect(editor.refineMaskOp).toBe('add')
    await w.find('[data-testid="refine-selection-tool-eraser"]').trigger('click')
    expect(editor.refineMaskOp).toBe('subtract')
  })

  it('选择方式开关立即写 store', async () => {
    const editor = useCanvasEditorStore()
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-op-subtract"]').trigger('click')
    expect(editor.refineMaskOp).toBe('subtract')
    expect(w.find('[data-testid="refine-selection-op-subtract"]').classes()).toContain('is-on')
  })

  it('反选 / 清除选区调 refineMask handle', async () => {
    const editor = useCanvasEditorStore()
    let inverted = 0
    let cleared = 0
    editor.registerRefineMask({
      exportPng: async () => new Blob(),
      clear: () => { cleared += 1 },
      getCanvas: () => null,
      invert: () => { inverted += 1 },
    })
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-command-invert"]').trigger('click')
    await w.find('[data-testid="refine-selection-command-clear"]').trigger('click')
    expect(inverted).toBe(1)
    expect(cleared).toBe(1)
  })

  it('提示行随工具切换（椭圆的 Shift 提示）', async () => {
    const w = mountPanel()
    await w.find('[data-testid="refine-selection-tool-ellipse"]').trigger('click')
    expect(w.find('[data-testid="refine-selection-param-hint"]').text()).toContain('Shift')
  })
})
