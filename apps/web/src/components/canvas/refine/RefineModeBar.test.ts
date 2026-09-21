import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineModeBar from './RefineModeBar.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

/** 每个用例共用一个 pinia：测试里取的 store 必须与组件内注入的是同一个实例 */
let pinia: Pinia
const mountBar = () => mount(RefineModeBar, { global: { plugins: [pinia] } })

describe('RefineModeBar', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })

  it('工作图态：标题「工作图」，Esc 提示是退出精修', () => {
    const w = mountBar()
    expect(w.find('[data-testid="modebar-workspace"]').text()).toBe('工作图')
    expect(w.find('[data-testid="modebar-esc"]').text()).toContain('退出精修')
  })

  it('对照态：标题带对照方式，Esc 提示是回到工作图', () => {
    const store = useCanvasEditorStore()
    store.setRefineCompareMode('wipe')
    store.setCompareLightboxOpen(true)
    const w = mountBar()
    expect(w.find('[data-testid="modebar-workspace"]').text()).toBe('对照 · 滑竿对照')
    expect(w.find('[data-testid="modebar-esc"]').text()).toContain('回到工作图')
  })

  it('画笔/橡皮显示粗细 + 颜色，不显示容差', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('brush')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(true)
    expect(w.find('[data-testid="modebar-param-wand"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-tool"]').text()).toBe('画笔')
  })

  it('魔棒只显示容差', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('wand')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-param-wand"]').exists()).toBe(true)
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-tool"]').text()).toBe('魔棒')
  })

  it('多边形只给文字提示；矩形与点选无参数', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('polygon')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-hint-polygon"]').exists()).toBe(true)
  })

  it('矩形与点选不出现任何参数控件', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('rect')
    const w = mountBar()
    expect(w.find('[data-testid="modebar-tool"]').text()).toBe('矩形')
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-param-wand"]').exists()).toBe(false)
    expect(w.find('[data-testid="modebar-hint-polygon"]').exists()).toBe(false)
  })

  it('拖粗细滑杆写回 store', async () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('brush')
    const w = mountBar()
    await w.find('[data-testid="modebar-param-brush"] input[type="range"]').setValue('48')
    expect(store.refineBrushSize).toBe(48)
  })

  it('对照态下不显示工具参数（对照不写图片数据）', () => {
    const store = useCanvasEditorStore()
    store.setRefineTool('brush')
    store.setCompareLightboxOpen(true)
    const w = mountBar()
    expect(w.find('[data-testid="modebar-param-brush"]').exists()).toBe(false)
  })
})
