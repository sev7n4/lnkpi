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

  it('左栏不存在「细节放大」入口', () => {
    expect(mountRail().text()).not.toContain('细节放大')
  })
})
