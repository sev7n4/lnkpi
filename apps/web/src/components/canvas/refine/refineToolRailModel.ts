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

export type RefineCapabilityPrice = '免费' | '积分'

export interface RefineCapabilityItem {
  id: string
  label: string
  icon: string[]
  groupId: string
  groupLabel: string
  price: RefineCapabilityPrice
  disabled: boolean
  hint: string
}

interface RefineCapabilityGroup {
  id: string
  label: string
  price: RefineCapabilityPrice
  items: { id: string; label: string; icon: string[] }[]
}

/** 能力组占位（迁自原 RefineToolbox 的 CAPABILITY_GROUPS，§9）。outpaint 已由左栏独立按钮承担，不再列入。 */
export const REFINE_CAPABILITY_GROUPS: RefineCapabilityGroup[] = [
  {
    id: 'matting', label: '抠素材', price: '免费',
    items: [
      { id: 'one-click-matting', label: '一键抠图', icon: ['M12 3.5v13', 'M7 11.5l5 5 5-5', 'M5 20.5h14'] },
      { id: 'subject', label: '抠主体', icon: ['M12 4.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z', 'M5 20c.8-4 3.4-6 7-6s6.2 2 7 6'] },
      { id: 'erase-object', label: '擦除', icon: ['M5 15.2l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L13.5 19H8.6z', 'M5 19.5h14.5'] },
    ],
  },
  {
    id: 'compose', label: '构图', price: '免费',
    items: [
      { id: 'crop', label: '裁剪', icon: ['M7 3.5v13.5h13.5', 'M3.5 7h13.5v13.5'] },
      { id: 'grid-slice', label: '宫格切分', icon: ['M4 4h16v16H4z', 'M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16'] },
      { id: 'rotate-flip', label: '旋转翻转', icon: ['M5.5 9a7.5 7.5 0 0 1 13-1.5', 'M18.5 3.5v4h-4', 'M18.5 15a7.5 7.5 0 0 1-13 1.5', 'M5.5 20.5v-4h4'] },
    ],
  },
  {
    id: 'content', label: '改内容', price: '积分',
    items: [
      { id: 'inpaint', label: '局部重绘', icon: ['M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z', 'M14.8 6.6l2.6 2.6'] },
      { id: 'erase-replace', label: '消除替换', icon: ['M7 8h10l4 4-4 4H7l-4-4z', 'M9.5 11.5h5'] },
    ],
  },
  {
    id: 'quality', label: '提画质', price: '积分',
    items: [
      { id: 'upscale', label: '超分', icon: ['M6 20.5v-9M2.5 15L6 11.5 9.5 15', 'M18 3.5v9M14.5 9L18 12.5 21.5 9'] },
      { id: 'enhance', label: '增强', icon: ['M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z', 'M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'] },
    ],
  },
]

/** 扁平化的能力项，供左栏 rail 渲染（全部禁用占位，点亮机制见 §14.2）。 */
export const REFINE_CAPABILITY_ITEMS: RefineCapabilityItem[] = REFINE_CAPABILITY_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    ...item,
    groupId: group.id,
    groupLabel: group.label,
    price: group.price,
    disabled: true,
    hint: `即将上线：${item.label}（M2 能力包，待独立规格实现）`,
  })),
)
