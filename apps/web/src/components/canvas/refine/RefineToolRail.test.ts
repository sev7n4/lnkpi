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

  it('抠图入口：点击进入 matting 模式，再点击回 select（toggle 语义对称扩图）', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    const btn = w.find('[data-testid="rail-mode-matting"]')
    expect(btn.exists()).toBe(true)
    expect(store.refineMode).toBe('select')
    await btn.trigger('click')
    expect(store.refineMode).toBe('matting')
    expect(w.find('[data-testid="rail-mode-matting"]').classes()).toContain('is-active')
    await w.find('[data-testid="rail-mode-matting"]').trigger('click')
    expect(store.refineMode).toBe('select')
  })

  it('抠图与扩图互斥：激活 matting 后 rail-mode-outpaint 不带 is-active', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-matting"]').trigger('click')
    expect(store.refineMode).toBe('matting')
    expect(w.find('[data-testid="rail-mode-matting"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).not.toContain('is-active')

    // 反向：切回扩图后 matting 失去激活态
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(store.refineMode).toBe('outpaint')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="rail-mode-matting"]').classes()).not.toContain('is-active')
  })

  it('抠图入口 aria-label / title 标注透明 PNG 用途；busy 时 disabled', () => {
    const store = useCanvasEditorStore()
    store.setRefineBusy(true)
    const w = mountRail()
    const btn = w.find('[data-testid="rail-mode-matting"]')
    expect(btn.attributes('aria-label')).toBe('抠图（生成透明 PNG）')
    expect(btn.attributes('title')).toBe('抠图（生成透明 PNG）')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('能力区：分隔线 + 7 项禁用图标（matting 已迁出为 refine-matting 真模式，outpaint 不重复出现在能力区）', () => {
    const w = mountRail()
    expect(w.find('[data-testid="rail-capability-hr"]').exists()).toBe(true)
    expect(w.findAll('button[data-testid^="rail-capability-"]').length).toBe(7)
    expect(w.find('[data-testid="rail-capability-one-click-matting"]').exists()).toBe(false)
    expect(w.find('[data-testid="rail-capability-crop"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-capability-crop"]').attributes('title')).toContain('即将上线')
    expect(w.find('[data-testid="rail-capability-outpaint"]').exists()).toBe(false)
  })

  it('扩图仍是左栏唯一的激活项（能力区只为占位）', async () => {
    const store = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(store.refineMode).toBe('outpaint')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).toContain('is-active')

    // 能力区是禁用占位：点击不改变模式，也不会成为激活项
    const cap = w.find('[data-testid="rail-capability-inpaint"]')
    const activeBefore = w.findAll('.refine-rail__btn.is-active').length
    await cap.trigger('click')
    expect(store.refineMode).toBe('outpaint')
    expect(cap.classes()).not.toContain('is-active')
    // 点击能力占位不新增任何激活项，且能力区自身永不参与激活态
    expect(w.findAll('.refine-rail__btn.is-active').length).toBe(activeBefore)
    expect(w.find('.refine-rail__btn.is-active[data-testid^="rail-capability-"]').exists()).toBe(false)
  })

  it('渲染三枚模式入口 + 两枚查看入口，不存在任何输入组与二级菜单', () => {
    const w = mountRail()
    for (const id of ['rail-mode-outpaint', 'rail-mode-matting', 'rail-mode-select']) {
      expect(w.find(`[data-testid="${id}"]`).exists()).toBe(true)
    }
    expect(w.find('[data-testid="rail-view-compare"]').exists()).toBe(true)
    expect(w.find('[data-testid="rail-view-fit"]').exists()).toBe(true)
    for (const id of ['smart', 'marquee', 'paint']) {
      expect(w.find(`[data-testid="rail-input-${id}"]`).exists()).toBe(false)
    }
    expect(w.find('[data-testid="rail-variant-eraser"]').exists()).toBe(false)
    expect(w.find('[data-testid="rail-command-invert"]').exists()).toBe(false)
  })

  it('select 是基座模式：默认激活，点已激活的选区按钮无变化', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRail()
    expect(editor.refineMode).toBe('select')
    expect(w.find('[data-testid="rail-mode-select"]').classes()).toContain('is-active')
    await w.find('[data-testid="rail-mode-select"]').trigger('click')
    expect(editor.refineMode).toBe('select')
  })

  it('三模式互斥：点扩图进 outpaint，点选区回 select', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(editor.refineMode).toBe('outpaint')
    expect(w.find('[data-testid="rail-mode-outpaint"]').classes()).toContain('is-active')
    expect(w.find('[data-testid="rail-mode-select"]').classes()).not.toContain('is-active')
    await w.find('[data-testid="rail-mode-select"]').trigger('click')
    expect(editor.refineMode).toBe('select')
  })

  it('再点已激活的扩图回 select（toggle 语义保留）', async () => {
    const editor = useCanvasEditorStore()
    const w = mountRail()
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    await w.find('[data-testid="rail-mode-outpaint"]').trigger('click')
    expect(editor.refineMode).toBe('select')
  })

  it('busy 时三枚模式入口全部禁用', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineBusy(true)
    const w = mountRail()
    for (const id of ['rail-mode-outpaint', 'rail-mode-matting', 'rail-mode-select']) {
      expect(w.find(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined()
    }
  })
})
