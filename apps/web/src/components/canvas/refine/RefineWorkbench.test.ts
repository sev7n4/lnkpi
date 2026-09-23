import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineWorkbench from './RefineWorkbench.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

/** 每个用例共用一个 pinia：测试里取的 store 必须与组件内注入的是同一个实例 */
let pinia: Pinia

// 只验证生产接线：workbench → viewport → rail 的 hasAfter 透传。
// 「处理后」是否存在现由 store 的当前会话结果（editor.currentRefineSessionResult）驱动，
// 不再依赖已退役的 versions prop（Task 7 / VersionStrip 退役）。
// 兄弟组件 RefineSidePanel 较重，按需替身；viewport 的 canvas 依赖（MaskEditor / ImageLoupe）换轻量替身。
const mountWorkbench = (props: Record<string, unknown> = {}) =>
  mount(RefineWorkbench, {
    props: {
      nodeId: 'n1',
      beforeUrl: 'blob:before',
      url: 'blob:before',
      sessionId: 's1',
      width: 100,
      height: 100,
      ...props,
    },
    global: {
      plugins: [pinia],
      stubs: {
        RefineSidePanel: { template: '<div class="side-panel-stub" />' },
        MaskEditor: { template: '<div class="mask-editor-stub" />' },
        ImageLoupe: { template: '<div class="loupe-stub"><slot /></div>' },
      },
    },
  })

const openCompareMenu = async (w: ReturnType<typeof mountWorkbench>) => {
  await w.find('[data-testid="rail-view-compare"]').trigger('click')
}

describe('RefineWorkbench 生产接线', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })

  it('节点无「处理后」会话结果时，左栏对照两项置灰', async () => {
    const editor = useCanvasEditorStore()
    editor.clearRefineSessionResults()
    const w = mountWorkbench()
    await openCompareMenu(w)
    expect(w.find('[data-testid="rail-compare-option-split"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-compare-option-wipe"]').attributes('disabled')).toBeDefined()
  })

  it('节点已有「处理后」会话结果时，左栏对照两项可用', async () => {
    const editor = useCanvasEditorStore()
    editor.clearRefineSessionResults()
    editor.pushRefineSessionResult({ url: 'blob:after', prompt: '抠图' })
    const w = mountWorkbench()
    await openCompareMenu(w)
    expect(w.find('[data-testid="rail-compare-option-split"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="rail-compare-option-wipe"]').attributes('disabled')).toBeUndefined()
  })

  it('Esc 分级退出：扩图模式先退回 select 且不关闭（再按才关精修）', async () => {
    const editor = useCanvasEditorStore()
    editor.refineMode = 'outpaint'
    const w = mountWorkbench()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(editor.refineMode).toBe('select')
    expect(w.emitted('close')).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Esc 分级退出：抠图模式先退回 select 且不关闭（回归：旧实现漏了抠图）', async () => {
    const editor = useCanvasEditorStore()
    editor.refineMode = 'matting'
    const w = mountWorkbench()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(editor.refineMode).toBe('select')
    expect(w.emitted('close')).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('Esc 在普通精修模式下直接关闭', async () => {
    const w = mountWorkbench()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('close')).toHaveLength(1)
  })
})
