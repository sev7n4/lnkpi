import type { RefineMaskOp, RefineMaskTool, RefineMode } from '@/stores/canvasEditor'

/** 参数区渲染哪种控件：'brush' 粗细+颜色 / 'wand' 容差 / 'none' 只显示提示行（spec §5.1） */
export type RefineToolParamKind = 'brush' | 'wand' | 'none'

export interface RefineToolSpec {
  tool: RefineMaskTool
  label: string
  /** SVG path d 数组，与 rail 现状同款渲染 */
  icon: string[]
  param: RefineToolParamKind
  /** 参数区常驻的一行用法说明（每枚工具恒有） */
  hint: string
}

export interface RefineSelectionGroup {
  id: 'smart' | 'shape' | 'paint'
  label: string
  tools: RefineMaskTool[]
}

/** 右栏面板「工具」分区的三组 7 枚（spec 图 6 ②） */
export const REFINE_SELECTION_GROUPS: RefineSelectionGroup[] = [
  { id: 'smart', label: '智能选择', tools: ['point', 'wand'] },
  { id: 'shape', label: '形状', tools: ['rect', 'ellipse', 'polygon'] },
  { id: 'paint', label: '涂抹', tools: ['brush', 'eraser'] },
]

const BRUSH_ICON = ['M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z', 'M14.8 6.6l2.6 2.6']
const ERASER_ICON = ['M5 15.2l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L13.5 19H8.6z', 'M5 19.5h14.5']

export const REFINE_TOOL_SPECS: Record<RefineMaskTool, RefineToolSpec> = {
  point: { tool: 'point', label: '点选主体', icon: ['M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z'], param: 'none', hint: '点击图中的主体，自动圈出同类区域' },
  wand: { tool: 'wand', label: '魔棒', icon: ['M6 18.5 17 7.5', 'M15.5 4.5l4 4', 'M5 15.5l3.5 3.5', 'M17.5 6.5l1 1'], param: 'wand', hint: '点击一块颜色相近的区域，容差越大圈得越多' },
  rect: { tool: 'rect', label: '矩形', icon: ['M4 5.5h16v13H4z'], param: 'none', hint: '拖拽画出矩形选区' },
  ellipse: { tool: 'ellipse', label: '椭圆', icon: ['M4.5 12a7.5 6.5 0 1 0 15 0a7.5 6.5 0 1 0 -15 0z'], param: 'none', hint: '拖拽画出椭圆选区，按住 Shift 锁正圆' },
  polygon: { tool: 'polygon', label: '多边形', icon: ['M12 3.5l8.5 6.2-3.2 10H6.7L3.5 9.7z'], param: 'none', hint: '单击落点，双击或点回起点闭合' },
  brush: { tool: 'brush', label: '画笔', icon: BRUSH_ICON, param: 'brush', hint: '按住拖动涂抹选区' },
  eraser: { tool: 'eraser', label: '橡皮', icon: ERASER_ICON, param: 'brush', hint: '按住拖动擦除选区' },
}

export const REFINE_SELECTION_COMMANDS: { id: 'invert' | 'clear'; label: string; hint: string }[] = [
  { id: 'invert', label: '反选', hint: '选中区与未选中区互换' },
  { id: 'clear', label: '清除选区', hint: '清空当前蒙版' },
]

export const REFINE_MASK_OP_OPTIONS: { op: RefineMaskOp; label: string; hint: string }[] = [
  { op: 'add', label: '加选', hint: '把画出的区域并入选区' },
  { op: 'subtract', label: '减选', hint: '从选区里挖掉画出的区域' },
]

export function refineToolParamKind(tool: RefineMaskTool): RefineToolParamKind {
  return REFINE_TOOL_SPECS[tool].param
}

/** 工具与「选择方式」的联动判据（spec §4.3）：画笔/橡皮是加/减选的快捷形态，其余工具不动开关。 */
export function refineSelectionOpAfterToolPick(tool: RefineMaskTool, current: RefineMaskOp): RefineMaskOp {
  if (tool === 'brush') return 'add'
  if (tool === 'eraser') return 'subtract'
  return current
}

/** 固定页脚 Esc 三态文案（spec 图 3 下半段），模式优先于全屏对照。 */
export function refineSelectionEscHint(input: { refineMode: RefineMode; compareLightboxOpen: boolean }): string {
  if (input.refineMode !== 'select') return 'Esc · 回到选区'
  if (input.compareLightboxOpen) return 'Esc · 回到工作图'
  return 'Esc · 关闭精修'
}
