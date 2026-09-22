import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  REFINE_CAPABILITY_ITEMS, REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_INPUT_GROUPS, REFINE_VIEW_TOOLS,
  compareModeLabel, groupForTool, inputToolActive, refineWorkspaceLabel, toolLabel, toolParamKind,
} from './refineToolRailModel'
import { useCanvasEditorStore, type RefineMaskTool } from '@/stores/canvasEditor'

const ALL_TOOLS: RefineMaskTool[] = ['brush', 'eraser', 'rect', 'wand', 'polygon', 'point']

describe('refineToolRailModel', () => {
  it('三个输入组恰好覆盖全部 6 个蒙版工具，一个不漏一个不重', () => {
    const covered = REFINE_INPUT_GROUPS.flatMap((g) => g.variants.map((v) => v.tool))
    expect([...covered].sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('每组第一个变体是该组默认工具', () => {
    expect(REFINE_INPUT_GROUPS.map((g) => g.variants[0]!.tool)).toEqual(['point', 'rect', 'brush'])
  })

  it('groupForTool 把每个工具映射回它的组', () => {
    expect(groupForTool('point')).toBe('smart')
    expect(groupForTool('wand')).toBe('smart')
    expect(groupForTool('rect')).toBe('marquee')
    expect(groupForTool('polygon')).toBe('marquee')
    expect(groupForTool('brush')).toBe('paint')
    expect(groupForTool('eraser')).toBe('paint')
  })

  it('inputToolActive 只在自己的组内为真', () => {
    expect(inputToolActive('wand', 'smart')).toBe(true)
    expect(inputToolActive('wand', 'paint')).toBe(false)
  })

  it('两个选区命令分别只在智能选择组与涂抹组', () => {
    const byId = Object.fromEntries(REFINE_INPUT_GROUPS.map((g) => [g.id, g.commands.map((c) => c.id)]))
    expect(byId.smart).toEqual(['invert'])
    expect(byId.marquee).toEqual([])
    expect(byId.paint).toEqual(['clear'])
  })

  it('模式条参数矩阵：粗细 / 容差 / 多边形提示 / 无', () => {
    expect(toolParamKind('brush')).toBe('brush')
    expect(toolParamKind('eraser')).toBe('brush')
    expect(toolParamKind('wand')).toBe('wand')
    expect(toolParamKind('polygon')).toBe('polygon-hint')
    expect(toolParamKind('rect')).toBe('none')
    expect(toolParamKind('point')).toBe('none')
  })

  it('工具短名与查看组选项文案', () => {
    expect(toolLabel('point')).toBe('点选主体')
    expect(toolLabel('wand')).toBe('魔棒')
    expect(toolLabel('eraser')).toBe('橡皮')
    expect(REFINE_VIEW_TOOLS.map((t) => t.label)).toEqual(['对照', '适配'])
    expect(REFINE_COMPARE_OPTIONS.map((o) => o.label)).toEqual(['左右对照', '滑竿对照'])
    expect(REFINE_COMPARE_OPTIONS[0]!.mode).toBe('split')
    expect(REFINE_FIT_OPTIONS.map((o) => o.label)).toEqual(['适应窗口', '原始比例 1:1'])
  })

  it('模式条标题：对照打开显示对照方式，否则显示工作图', () => {
    expect(refineWorkspaceLabel({ compareOpen: false, compareMode: 'split' })).toBe('工作图')
    expect(refineWorkspaceLabel({ compareOpen: true, compareMode: 'split' })).toBe('对照 · 左右对照')
    expect(refineWorkspaceLabel({ compareOpen: true, compareMode: 'wipe' })).toBe('对照 · 滑竿对照')
    expect(compareModeLabel('wipe')).toBe('滑竿对照')
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
  it('3 组 7 项，且去掉 outpaint 与 matting（matting 已注册为 refine-matting 真模式，outpaint 由左栏独立按钮承担）', () => {
    const ids = REFINE_CAPABILITY_ITEMS.map((i) => i.id)
    expect(ids).toEqual([
      'crop', 'grid-slice', 'rotate-flip',
      'inpaint', 'erase-replace',
      'upscale', 'enhance',
    ])
    expect(ids).not.toContain('outpaint')
    expect(ids).not.toContain('one-click-matting')
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
    expect(byId['crop']!.groupLabel).toBe('构图')
    expect(byId['crop']!.price).toBe('免费')
    expect(byId['inpaint']!.price).toBe('积分')
  })
})
