import { describe, expect, it } from 'vitest'
import {
  REFINE_MASK_OP_OPTIONS,
  REFINE_SELECTION_COMMANDS,
  REFINE_SELECTION_GROUPS,
  REFINE_TOOL_SPECS,
  refineSelectionEscHint,
  refineSelectionOpAfterToolPick,
  refineToolParamKind,
} from './refineSelectionModel'
import type { RefineMaskTool } from '@/stores/canvasEditor'

const ALL_TOOLS: RefineMaskTool[] = ['point', 'wand', 'rect', 'ellipse', 'polygon', 'brush', 'eraser']

describe('refineSelectionModel', () => {
  it('三组共 7 枚工具，恰好覆盖 RefineMaskTool 全集且不重复', () => {
    const tools = REFINE_SELECTION_GROUPS.flatMap((g) => g.tools)
    expect(tools).toHaveLength(7)
    expect([...tools].sort()).toEqual([...ALL_TOOLS].sort())
    expect(REFINE_SELECTION_GROUPS.map((g) => g.id)).toEqual(['smart', 'shape', 'paint'])
  })

  it('REFINE_TOOL_SPECS 覆盖全部 7 枚，椭圆是本期新增', () => {
    for (const tool of ALL_TOOLS) {
      expect(REFINE_TOOL_SPECS[tool].tool).toBe(tool)
      expect(REFINE_TOOL_SPECS[tool].hint.length).toBeGreaterThan(0) // 每枚工具恒有一行用法提示
    }
    expect(REFINE_TOOL_SPECS.ellipse.label).toBe('椭圆')
    expect(REFINE_TOOL_SPECS.ellipse.param).toBe('none')
  })

  it('refineToolParamKind：brush/eraser→brush、wand→wand、其余→none', () => {
    expect(refineToolParamKind('brush')).toBe('brush')
    expect(refineToolParamKind('eraser')).toBe('brush')
    expect(refineToolParamKind('wand')).toBe('wand')
    expect(refineToolParamKind('rect')).toBe('none')
    expect(refineToolParamKind('ellipse')).toBe('none')
    expect(refineToolParamKind('point')).toBe('none')
    expect(refineToolParamKind('polygon')).toBe('none')
  })

  it('refineSelectionOpAfterToolPick：brush→add、eraser→subtract、其余 5 项原值返回（回归：rect 传 subtract 保持 subtract）', () => {
    expect(refineSelectionOpAfterToolPick('brush', 'subtract')).toBe('add')
    expect(refineSelectionOpAfterToolPick('eraser', 'add')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('rect', 'subtract')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('ellipse', 'subtract')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('polygon', 'subtract')).toBe('subtract')
    expect(refineSelectionOpAfterToolPick('wand', 'add')).toBe('add')
    expect(refineSelectionOpAfterToolPick('point', 'add')).toBe('add')
  })

  it('选区命令与选择方式选项的声明式数据', () => {
    expect(REFINE_SELECTION_COMMANDS.map((c) => c.id)).toEqual(['invert', 'clear'])
    expect(REFINE_MASK_OP_OPTIONS.map((o) => o.op)).toEqual(['add', 'subtract'])
  })

  it('refineSelectionEscHint：模式优先于对照，三态一一对应', () => {
    expect(refineSelectionEscHint({ refineMode: 'outpaint', compareLightboxOpen: false })).toBe('Esc · 回到选区')
    expect(refineSelectionEscHint({ refineMode: 'matting', compareLightboxOpen: false })).toBe('Esc · 回到选区')
    // 模式优先：扩图/抠图下即使对照开着也先回选区
    expect(refineSelectionEscHint({ refineMode: 'outpaint', compareLightboxOpen: true })).toBe('Esc · 回到选区')
    expect(refineSelectionEscHint({ refineMode: 'select', compareLightboxOpen: true })).toBe('Esc · 回到工作图')
    expect(refineSelectionEscHint({ refineMode: 'select', compareLightboxOpen: false })).toBe('Esc · 关闭精修')
  })
})
