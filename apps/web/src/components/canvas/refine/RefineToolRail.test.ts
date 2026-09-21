import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineToolRail from './RefineToolRail.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

/** 每个用例共用一个 pinia：测试里取的 store 必须与组件内注入的是同一个实例 */
let pinia: Pinia
const mountRail = (props: Record<string, unknown> = {}) =>
  mount(RefineToolRail, { props, global: { plugins: [pinia] } })

describe('RefineToolRail', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })

  it('渲染 3 个输入工具与 2 个查看工具', () => {
    const w = mountRail()
    for (const id of ['smart', 'marquee', 'paint']) {
      expect(w.find(`[data-testid="rail-input-${id}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="rail-view-compare"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-view-fit"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-rail"]').attributes('aria-label')).toBe('画布工具')
  })

  it('子菜单默认关闭；点「涂抹」展开后 6 个工具都能点到', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(false)

    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    expect(w.find('[data-testid="rail-variant-brush"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(true)

    await w.find('[data-testid="rail-variant-eraser"]').trigger('click')
    expect(store.refineTool).toBe('eraser')
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(false)
  })

  it('「反选」只在智能选择组、「清除选区」只在涂抹组', async () => {
    const w = mountRail()
    await w.find('[data-testid="rail-input-smart"]').trigger('click')
    expect(w.find('[data-testid="rail-command-invert"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-command-clear"]').exists()).toBe(false)

    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    expect(w.find('[data-testid="rail-command-clear"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-command-invert"]').exists()).toBe(false)
  })

  it('当前工具高亮在它所属的输入组上', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('polygon')
    const w = mountRail()
    expect(w.find('[data-testid="rail-input-marquee"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="rail-input-smart"]').classes()).not.toContain('is-active')
  })

  it('对照：默认左右对照；选滑竿后写入 store 并打开全屏对照', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    expect(store.refineCompareMode).toBe('split')

    await w.find('[data-testid="rail-view-compare"]').trigger('click')
    const split = w.find('[data-testid="rail-compare-option-split"]')
    const wipe = w.find('[data-testid="rail-compare-option-wipe"]')
    expect(split.exists()).toBe(true)
    expect(wipe.exists()).toBe(true)
    expect(split.classes()).toContain('is-on')
    expect(wipe.classes()).not.toContain('is-on')

    await wipe.trigger('click')
    expect(store.refineCompareMode).toBe('wipe')
    expect(store.compareLightboxOpen).toBe(true)
  })

  it('对照：没有「处理后」版本时两项置灰且点不动', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail({ hasAfter: false })
    await w.find('[data-testid="rail-view-compare"]').trigger('click')
    expect(w.find('[data-testid="rail-compare-option-split"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-compare-option-wipe"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="rail-compare-option-split"]').trigger('click')
    expect(store.compareLightboxOpen).toBe(false)
  })

  it('适配：二级菜单两项分别 emit fit / actualSize', async () => {
    const w = mountRail()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-fit-window"]').trigger('click')
    expect(w.emitted('fit')).toHaveLength(1)

    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-actual-size"]').trigger('click')
    expect(w.emitted('actualSize')).toHaveLength(1)
  })

  it('适配：二级菜单含放大 / 缩小（follow-up #10），分别 emit zoomIn / zoomOut', async () => {
    const w = mountRail()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-zoom-zoom-in"]').trigger('click')
    await w.find('[data-testid="rail-zoom-zoom-out"]').trigger('click')
    expect(w.emitted('zoomIn')).toHaveLength(1)
    expect(w.emitted('zoomOut')).toHaveLength(1)
  })

  it('细节放大入口回归左栏（follow-up #9，P0-5 回退）：点击切换 store.refineLoupeOn 并高亮', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    const loupe = w.find('[data-testid="rail-view-loupe"]')
    expect(loupe.exists()).toBe(true)
    expect(store.refineLoupeOn).toBe(false)
    await loupe.trigger('click')
    expect(store.refineLoupeOn).toBe(true)
    expect(w.find('[data-testid="rail-view-loupe"]').classes()).toContain('is-active')
    await w.find('[data-testid="rail-view-loupe"]').trigger('click')
    expect(store.refineLoupeOn).toBe(false)
  })

  it('撤销 / 重做（follow-up #13）：栈空禁用，可用时 emit undo / redo', async () => {
    const w = mountRail()
    expect(w.find('[data-testid="rail-undo"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-redo"]').attributes('disabled')).toBeDefined()

    const w2 = mountRail({ canUndo: true, canRedo: true })
    await w2.find('[data-testid="rail-undo"]').trigger('click')
    await w2.find('[data-testid="rail-redo"]').trigger('click')
    expect(w2.emitted('undo')).toHaveLength(1)
    expect(w2.emitted('redo')).toHaveLength(1)
  })

  it('二级菜单工具项只留图标（follow-up #11/#12）：无文字、带 aria-label', async () => {
    const w = mountRail()
    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    const brush = w.find('[data-testid="rail-variant-brush"]')
    expect(brush.exists()).toBe(true)
    expect(brush.attributes('aria-label')).toBe('画笔')
    expect(brush.text()).not.toContain('画笔')
    expect(brush.find('svg').exists()).toBe(true)
  })

  it('「查看」分组不再渲染文字标签（follow-up #5），只留发丝分隔线', () => {
    expect(mountRail().find('.refine-rail__seplabel').exists()).toBe(false)
  })

  it('扩图入口存在，点击后激活态（refineMode=outpaint）', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    const btn = w.find('[data-testid="rail-mode-outpaint"]')
    expect(btn.exists()).toBe(true)
    expect(store.refineMode).toBe('select')
    await btn.trigger('click')
    expect(store.refineMode).toBe('outpaint')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).toContain('is-active')
  })

  it('扩图模式 busy 时入口 disabled（冻结，模式不可切换）', () => {
    const store = useCanvasEditorStore()
    store.setRefineBusy(true)
    const w = mountRail()
    expect(w.find('[data-testid="rail-mode-outpaint"]').attributes('disabled')).toBeDefined()
  })

  it('扩图模式下画笔/橡皮变体 disabled', async () => {
    const store = useCanvasEditorStore()
    store.refineMode = 'outpaint'
    const w = mountRail()
    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    expect(w.find('[data-testid="rail-variant-brush"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-variant-eraser"]').attributes('disabled')).toBeDefined()
    // 矩形（marquee）等仍可用，仅画笔/橡皮被禁
    await w.find('[data-testid="rail-input-marquee"]').trigger('click')
    expect(w.find('[data-testid="rail-variant-rect"]').attributes('disabled')).toBeUndefined()
  })

  it('退出扩图模式后画笔/橡皮恢复可用', async () => {
    const store = useCanvasEditorStore()
    store.refineMode = 'outpaint'
    const w = mountRail()
    await w.find('[data-testid="rail-input-paint"]').trigger('click')
    expect(w.find('[data-testid="rail-variant-brush"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(store.refineMode).toBe('select')
    expect(w.find('[data-testid="rail-variant-brush"]').attributes('disabled')).toBeUndefined()
  })
})
