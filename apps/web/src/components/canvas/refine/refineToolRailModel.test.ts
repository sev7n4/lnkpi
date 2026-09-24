import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  REFINE_CAPABILITY_ITEMS, REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_VIEW_TOOLS, REFINE_ZOOM_ACTIONS,
  compareModeLabel,
} from './refineToolRailModel'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

describe('refineToolRailModel', () => {
  it('查看组 / 对照 / 适配 / 缩放选项文案（spec §3.2 / §4.5）', () => {
    expect(REFINE_VIEW_TOOLS.map((t) => t.label)).toEqual(['对照', '适配'])
    expect(REFINE_COMPARE_OPTIONS.map((o) => o.label)).toEqual(['左右对照', '滑竿对照'])
    expect(REFINE_COMPARE_OPTIONS[0]!.mode).toBe('split')
    expect(REFINE_FIT_OPTIONS.map((o) => o.label)).toEqual(['适应窗口', '原始比例 1:1'])
    expect(REFINE_ZOOM_ACTIONS.map((a) => a.id)).toEqual(['zoom-in', 'zoom-out'])
  })

  it('compareModeLabel 对照方式文案', () => {
    expect(compareModeLabel('wipe')).toBe('滑竿对照')
    expect(compareModeLabel('split')).toBe('左右对照')
  })
})

describe('canvasEditor · 对照模式归属', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('默认左右 / 0.5，并可写入', () => {
    const store = useCanvasEditorStore()
    expect(store.refineCompareMode).toBe('split')
    expect(store.refineWipeRatio).toBe(0.5)
    store.setRefineCompareMode('wipe')
    store.setRefineWipeRatio(0.25)
    expect(store.refineCompareMode).toBe('wipe')
    expect(store.refineWipeRatio).toBe(0.25)
  })

  it('滑竿比例被钳制在 [0, 1]', () => {
    const store = useCanvasEditorStore()
    store.setRefineWipeRatio(9)
    expect(store.refineWipeRatio).toBe(1)
    store.setRefineWipeRatio(-3)
    expect(store.refineWipeRatio).toBe(0)
  })

  it('关闭编辑器时对照模式与比例复位', () => {
    const store = useCanvasEditorStore()
    store.setRefineCompareMode('wipe')
    store.setRefineWipeRatio(0.25)
    store.closeImageEditor()
    expect(store.refineCompareMode).toBe('split')
    expect(store.refineWipeRatio).toBe(0.5)
  })
})

describe('REFINE_CAPABILITY_ITEMS（Toolbox 能力组迁入 rail）', () => {
  it('3 组 5 项，且去掉 outpaint/matting/crop/inpaint（均已注册为真模式或由左栏独立按钮承担）', () => {
    const ids = REFINE_CAPABILITY_ITEMS.map((i) => i.id)
    expect(ids).toEqual([
      'grid-slice', 'rotate-flip',
      'erase-replace',
      'upscale', 'enhance',
    ])
    expect(ids).not.toContain('outpaint')
    expect(ids).not.toContain('one-click-matting')
    expect(ids).not.toContain('crop')
    expect(ids).not.toContain('inpaint')
  })

  it('全部禁用并带「即将上线」提示（点亮机制后续包翻 disabled）', () => {
    for (const item of REFINE_CAPABILITY_ITEMS) {
      expect(item.disabled).toBe(true)
      expect(item.hint).toContain('待独立规格实现')
      expect(item.icon.length).toBeGreaterThan(0)
    }
  })

  it('分组信息（组名 + 定价）随 item 保留，rail tooltip 可复用', () => {
    const byId = Object.fromEntries(REFINE_CAPABILITY_ITEMS.map((i) => [i.id, i]))
    expect(byId['grid-slice']!.groupLabel).toBe('构图')
    expect(byId['grid-slice']!.price).toBe('免费')
    expect(byId['erase-replace']!.price).toBe('积分')
  })
})
