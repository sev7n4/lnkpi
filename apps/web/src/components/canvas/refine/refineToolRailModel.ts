import type { CompareMode } from '@/utils/refineChrome'
import type { RefineMaskTool } from '@/stores/canvasEditor'

/**
 * 画布左栏工具条的分组模型。
 * 判据（spec §3.2）：产出「中间态」（选区 / 蒙版 / 视图）→ 画布左栏；产出「最终产物」→ 工具箱。
 */
export type RefineInputGroupId = 'smart' | 'marquee' | 'paint'
export type RefineToolCommand = 'invert' | 'clear'
export type RefineViewToolId = 'compare' | 'fit'
/** 模式条要为当前工具显示哪一套参数 */
export type RefineToolParamKind = 'brush' | 'wand' | 'polygon-hint' | 'none'

export interface RefineToolVariant { tool: RefineMaskTool; label: string }
export interface RefineInputGroup {
  id: RefineInputGroupId
  label: string
  variants: RefineToolVariant[]
  commands: { id: RefineToolCommand; label: string }[]
}

/** 3 个输入工具，各自的二级菜单容纳全部 6 个蒙版工具。 */
export const REFINE_INPUT_GROUPS: RefineInputGroup[] = [
  {
    id: 'smart',
    label: '智能选择',
    variants: [{ tool: 'point', label: '点选主体' }, { tool: 'wand', label: '魔棒' }],
    commands: [{ id: 'invert', label: '反选' }],
  },
  {
    id: 'marquee',
    label: '框选',
    variants: [{ tool: 'rect', label: '矩形' }, { tool: 'polygon', label: '多边形' }],
    commands: [],
  },
  {
    id: 'paint',
    label: '涂抹',
    variants: [{ tool: 'brush', label: '画笔' }, { tool: 'eraser', label: '橡皮' }],
    commands: [{ id: 'clear', label: '清除选区' }],
  },
]

export const REFINE_VIEW_TOOLS: { id: RefineViewToolId; label: string }[] = [
  { id: 'compare', label: '对照' },
  { id: 'fit', label: '适配' },
]

export const REFINE_COMPARE_OPTIONS: { mode: CompareMode; label: string; hint: string }[] = [
  { mode: 'split', label: '左右对照', hint: '并排两图 · 同步缩放平移' },
  { mode: 'wipe', label: '滑竿对照', hint: '同屏叠图 · 拖分割线看差异' },
]

export const REFINE_FIT_OPTIONS = [
  { id: 'fit-window', label: '适应窗口', hint: '整图铺满可视区' },
  { id: 'actual-size', label: '原始比例 1:1', hint: '按像素 1:1 显示' },
] as const
export type RefineFitOptionId = (typeof REFINE_FIT_OPTIONS)[number]['id']

const GROUP_OF_TOOL: Record<RefineMaskTool, RefineInputGroupId> = {
  point: 'smart', wand: 'smart', rect: 'marquee', polygon: 'marquee', brush: 'paint', eraser: 'paint',
}

const LABEL_OF_TOOL: Record<RefineMaskTool, string> = {
  point: '点选主体', wand: '魔棒', rect: '矩形', polygon: '多边形', brush: '画笔', eraser: '橡皮',
}

const PARAM_OF_TOOL: Record<RefineMaskTool, RefineToolParamKind> = {
  brush: 'brush', eraser: 'brush', wand: 'wand', polygon: 'polygon-hint', rect: 'none', point: 'none',
}

export function groupForTool(tool: RefineMaskTool): RefineInputGroupId { return GROUP_OF_TOOL[tool] }
export function toolLabel(tool: RefineMaskTool): string { return LABEL_OF_TOOL[tool] }
export function inputToolActive(tool: RefineMaskTool, groupId: RefineInputGroupId): boolean {
  return GROUP_OF_TOOL[tool] === groupId
}
export function toolParamKind(tool: RefineMaskTool): RefineToolParamKind { return PARAM_OF_TOOL[tool] }
export function compareModeLabel(mode: CompareMode): string {
  return mode === 'wipe' ? '滑竿对照' : '左右对照'
}
export function refineWorkspaceLabel(input: { compareOpen: boolean; compareMode: CompareMode }): string {
  return input.compareOpen ? `对照 · ${compareModeLabel(input.compareMode)}` : '工作图'
}

/** 「适配」菜单里的即时缩放动作（follow-up #10）：只改视图层级，不产生任何数据 */
export const REFINE_ZOOM_ACTIONS = [
  { id: 'zoom-in', label: '放大', hint: '视图放大一级' },
  { id: 'zoom-out', label: '缩小', hint: '视图缩小一级' },
] as const
export type RefineZoomActionId = (typeof REFINE_ZOOM_ACTIONS)[number]['id']
