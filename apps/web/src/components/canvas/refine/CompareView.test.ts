import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import CompareView from './CompareView.vue'
import type { CompareMode } from '@/utils/refineChrome'

const BASE_CANVAS = {
  width: 800,
  height: 600,
  beforeOffset: { x: 200, y: 100 },
}

const mountView = (
  props: {
    beforeUrl: string
    afterUrl?: string
    mode?: CompareMode
    wipeRatio?: number
    compact?: boolean
    baseCanvas?: typeof BASE_CANVAS
  } = { beforeUrl: 'blob:before', afterUrl: 'blob:after' },
) => {
  const pinia = getActivePinia() as Pinia
  return mount(CompareView, { props, global: { plugins: [pinia] } })
}

describe('CompareView 回归：不传 baseCanvas 时渲染与现状一致', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('wipe：无斜纹占位、容器无 aspect-ratio、Before 图仍是全幅 clip 贴法', () => {
    const w = mountView({ beforeUrl: 'blob:before', afterUrl: 'blob:after', mode: 'wipe' })
    expect(w.find('[data-testid="compare-base-hatch"]').exists()).toBe(false)
    const wipe = w.find('.compare-view__wipe')
    expect(wipe.attributes('style')).toBeUndefined()
    const before = w.find('.compare-view__wipe-img--before')
    expect(before.attributes('style')).toContain('clip-path: inset(0 50% 0 0)')
    expect((before.element as HTMLElement).style.left).toBe('')
    expect((before.element as HTMLElement).style.width).toBe('')
  })

  it('split：Before 侧无基准画布 stage，两侧各一张平铺图', () => {
    const w = mountView()
    expect(w.find('[data-testid="compare-base-stage"]').exists()).toBe(false)
    expect(w.find('[data-testid="compare-base-hatch"]').exists()).toBe(false)
    const imgs = w.findAll('img.compare-view__image')
    expect(imgs.length).toBe(2)
    expect(imgs[0].attributes('src')).toBe('blob:before')
    expect(imgs[1].attributes('src')).toBe('blob:after')
  })
})

describe('CompareView 基准画布模式（wipe）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('容器以新画布比例为基准（aspect-ratio）', () => {
    const w = mountView({
      beforeUrl: 'blob:before',
      afterUrl: 'blob:after',
      mode: 'wipe',
      baseCanvas: BASE_CANVAS,
    })
    const style = w.find('.compare-view__wipe').attributes('style') ?? ''
    expect(style).toContain('aspect-ratio')
    expect(style).toContain('800')
    expect(style).toContain('600')
  })

  it('Before 图按 beforeOffset 偏移贴入新画布框', () => {
    const w = mountView({
      beforeUrl: 'blob:before',
      afterUrl: 'blob:after',
      mode: 'wipe',
      baseCanvas: BASE_CANVAS,
    })
    const before = w.find('.compare-view__wipe-img--before')
    expect((before.element as HTMLElement).style.left).toBe('25%')
    expect((before.element as HTMLElement).style.top).toBe('16.6667%')
    expect((before.element as HTMLElement).style.width).toBe('50%')
    expect((before.element as HTMLElement).style.height).toBe('66.6667%')
    // wipe 滑竿行为不变：Before 侧仍有 clip
    expect((before.element as HTMLElement).style.clipPath).toBe('inset(0 50% 0 0)')
  })

  it('扩出区渲染斜纹占位元素（与 Before 侧同 clip）', () => {
    const w = mountView({
      beforeUrl: 'blob:before',
      afterUrl: 'blob:after',
      mode: 'wipe',
      baseCanvas: BASE_CANVAS,
    })
    const hatch = w.find('[data-testid="compare-base-hatch"]')
    expect(hatch.exists()).toBe(true)
    expect((hatch.element as HTMLElement).style.clipPath).toBe('inset(0 50% 0 0)')
  })
})

describe('CompareView 基准画布模式（split）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('Before 侧：基准画布 stage 尺寸=新画布比例，Before 图偏移正确，扩出区有斜纹', () => {
    const w = mountView({ beforeUrl: 'blob:before', afterUrl: 'blob:after', baseCanvas: BASE_CANVAS })
    const stage = w.find('[data-testid="compare-base-stage"]')
    expect(stage.exists()).toBe(true)
    const style = stage.attributes('style') ?? ''
    expect(style).toContain('aspect-ratio')
    expect(style).toContain('800')
    expect(style).toContain('600')
    const before = stage.find('img')
    expect(before.attributes('src')).toBe('blob:before')
    expect((before.element as HTMLElement).style.left).toBe('25%')
    expect((before.element as HTMLElement).style.top).toBe('16.6667%')
    expect((before.element as HTMLElement).style.width).toBe('50%')
    expect((before.element as HTMLElement).style.height).toBe('66.6667%')
    expect(stage.find('[data-testid="compare-base-hatch"]').exists()).toBe(true)
  })

  it('After 侧渲染不变：仍是整幅平铺图', () => {
    const w = mountView({ beforeUrl: 'blob:before', afterUrl: 'blob:after', baseCanvas: BASE_CANVAS })
    const panes = w.findAll('.compare-view__pane')
    expect(panes.length).toBe(2)
    const afterPane = panes[1]
    const img = afterPane.find('img.compare-view__image')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:after')
    expect(afterPane.find('[data-testid="compare-base-stage"]').exists()).toBe(false)
  })
})
