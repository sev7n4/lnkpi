import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RefineWorkViewport from './RefineWorkViewport.vue'

/** 单一 pinia 实例：mount 的 plugins 与 setActivePinia 共用，避免「两个互不相通的 store」计划缺陷（R8）。 */
const pinia = createPinia()

/** MaskEditor / ImageLoupe 依赖真实 canvas 与 mediapipe，jsdom 下换成轻量替身。 */
const mountViewport = () =>
  mount(RefineWorkViewport, {
    props: { url: 'blob:before', width: 100, height: 100, insetRight: 400 },
    global: {
      plugins: [pinia],
      stubs: {
        MaskEditor: { template: '<div class="mask-editor-stub" />' },
        ImageLoupe: { template: '<div class="loupe-stub"><slot /></div>' },
      },
    },
  })

describe('RefineWorkViewport 布局', () => {
  beforeEach(() => { setActivePinia(pinia) })

  it('左栏工具条与模式条都在视口内', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__rail [data-testid="refine-rail"]').exists()).toBe(true)
    expect(w.find('.refine-work__col [data-testid="refine-modebar"]').exists()).toBe(true)
  })

  it('不再有自身 header bar（工作图 / 适应窗口 / 1:1 三件套已移走）', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__bar').exists()).toBe(false)
    expect(w.find('.refine-work__btn').exists()).toBe(false)
  })

  it('stage 仍在，蒙版编辑器与工作图都已挂载', () => {
    const w = mountViewport()
    expect(w.find('.refine-work__stage').exists()).toBe(true)
    expect(w.find('.mask-editor-stub').exists()).toBe(true)
    expect(w.find('img.refine-work__img').attributes('src')).toBe('blob:before')
  })

  it('insetRight 决定 section 的 right 值', () => {
    expect(mountViewport().find('.refine-work').attributes('style')).toContain('right: 400px')
  })

  it('左栏「适配 → 适应窗口」把缩放归位（scale(1)、无平移）', async () => {
    const w = mountViewport()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-fit-window"]').trigger('click')
    const style = w.find('.refine-work__world').attributes('style') ?? ''
    expect(style).toContain('scale(1)')
    expect(style).toContain('translate(0px, 0px)')
  })

  it('左栏「适配 → 原始比例 1:1」不抛错且 world 仍在', async () => {
    const w = mountViewport()
    await w.find('[data-testid="rail-view-fit"]').trigger('click')
    await w.find('[data-testid="rail-fit-option-actual-size"]').trigger('click')
    expect(w.find('.refine-work__world').exists()).toBe(true)
  })
})
