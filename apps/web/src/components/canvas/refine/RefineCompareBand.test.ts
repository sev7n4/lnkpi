import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import RefineCompareBand from './RefineCompareBand.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const mountBand = (
  props: {
    beforeUrl: string
    afterUrl?: string
    versionMetadata?: Record<string, unknown>
  } = { beforeUrl: 'blob:before' },
) => {
  // R8: share the single active pinia with the mounted component so the test's
  // useCanvasEditorStore() reads the same store instance the component uses.
  const pinia = getActivePinia() as Pinia
  return mount(RefineCompareBand, { props, global: { plugins: [pinia] } })
}

describe('RefineCompareBand', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('顶部固定带：标题 + 默认态说明 + 去全屏按钮', () => {
    const w = mountBand()
    expect(w.find('[data-testid="refine-compare-band"]').exists()).toBe(true)
    expect(w.text()).toContain('对照预览')
    expect(w.text()).toContain('默认左右')
    expect(w.find('[data-testid="compare-band-maximize"]').exists()).toBe(true)
  })

  it('去全屏按钮切换 store 的 compareLightboxOpen', async () => {
    const store = useCanvasEditorStore()
    const w = mountBand()
    await w.find('[data-testid="compare-band-maximize"]').trigger('click')
    expect(store.compareLightboxOpen).toBe(true)
    await w.find('[data-testid="compare-band-maximize"]').trigger('click')
    expect(store.compareLightboxOpen).toBe(false)
  })

  it('不再有左右 / 滑竿两枚模式按钮（默认态即唯一态）', () => {
    const w = mountBand()
    expect(w.find('[title="左右对照"]').exists()).toBe(false)
    expect(w.find('[title="重叠滑竿"]').exists()).toBe(false)
  })

  it('不再有放大镜按钮及其子控件', () => {
    const w = mountBand()
    expect(w.find('[title="放大镜"]').exists()).toBe(false)
    expect(w.find('[title="圆形放大区"]').exists()).toBe(false)
    expect(w.find('[title="矩形放大区"]').exists()).toBe(false)
    expect(w.find('[title="放大镜倍数"]').exists()).toBe(false)
  })

  it('预览本体锁定左右对照：即使 store 里是对滑竿，CompareView 仍收到 split', () => {
    const store = useCanvasEditorStore()
    store.setRefineCompareMode('wipe')
    const w = mountBand({ beforeUrl: 'blob:before', afterUrl: 'blob:after' })
    const compareView = w.findComponent({ name: 'CompareView' })
    expect(compareView.exists()).toBe(true)
    expect(compareView.props('mode')).toBe('split')
    expect(compareView.props('beforeUrl')).toBe('blob:before')
    expect(compareView.props('afterUrl')).toBe('blob:after')
  })

  it('follow-up #3：对照带里没有「按住查看原图」眼睛（P0-6 只留 ⛶），CompareView 收到 compact', () => {
    const w = mountBand({ beforeUrl: 'blob:before', afterUrl: 'blob:after' })
    expect(w.find('.compare-view__original').exists()).toBe(false)
    expect(w.findComponent({ name: 'CompareView' }).props('compact')).toBe(true)
  })

  it('follow-up #8：没有「处理后」版本时 After 侧占位，不渲染 CompareView', () => {
    const w = mountBand({ beforeUrl: 'blob:before' })
    expect(w.findComponent({ name: 'CompareView' }).exists()).toBe(false)
    const ph = w.find('[data-testid="compare-band-placeholder"]')
    expect(ph.exists()).toBe(true)
    expect(ph.text()).toContain('待生成')
  })
})

describe('RefineCompareBand 基准画布（扩图版本）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('metadata.editMode=outpaint 时 CompareView 收到以新画布为基准的 baseCanvas（Before 居中偏移）', () => {
    const w = mountBand({
      beforeUrl: 'blob:before',
      afterUrl: 'blob:after',
      versionMetadata: {
        editMode: 'outpaint',
        outpaintFrom: { width: 400, height: 300 },
        outpaintTo: { width: 800, height: 600 },
      },
    })
    expect(w.findComponent({ name: 'CompareView' }).props('baseCanvas')).toEqual({
      width: 800,
      height: 600,
      beforeOffset: { x: 200, y: 150 },
    })
  })

  it('无 metadata 或非扩图版本时不传 baseCanvas（普通对照不受影响）', () => {
    const plain = mountBand({ beforeUrl: 'blob:before', afterUrl: 'blob:after' })
    expect(plain.findComponent({ name: 'CompareView' }).props('baseCanvas')).toBeUndefined()

    const edit = mountBand({
      beforeUrl: 'blob:before',
      afterUrl: 'blob:after',
      versionMetadata: { editMode: 'edit' },
    })
    expect(edit.findComponent({ name: 'CompareView' }).props('baseCanvas')).toBeUndefined()
  })

  it('扩图 metadata 缺几何字段时不传 baseCanvas', () => {
    const w = mountBand({
      beforeUrl: 'blob:before',
      afterUrl: 'blob:after',
      versionMetadata: { editMode: 'outpaint' },
    })
    expect(w.findComponent({ name: 'CompareView' }).props('baseCanvas')).toBeUndefined()
  })
})
