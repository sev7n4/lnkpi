/**
 * 选中浮层（SelectionActionBar）的纯函数模型，web 本地、无框架依赖。
 */

export interface SelectionToolDef {
  id: string
  /** 图标键名，由渲染层映射为 SVG */
  icon: string
  /** 完整名称：title / aria-label / tooltip 用 */
  title: string
  /** 浮层按钮短文案（2026-09-24 用户要求图标+文字，尽量两字） */
  label: string
  disabled: boolean
  disabledReason?: string
  group: 'ai' | 'file'
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 反缩放系数：精确抵消 viewport zoom 对浮层的拉伸（2026-09-22 用户验收修订）。
 * 不再 clamp 到 [0.8, 1.2]：钳制会让浮层屏幕尺寸随缩放漂移（zoom 0.5 时只有
 * 恒定值的 60%），与 MultiSelectToolbar（屏幕坐标、恒定大小）观感不一致。
 * 精确 1/zoom 后 bar 屏幕宽度恒等于 BAR_WIDTH_PX，与框选多节点菜单完全等宽。
 */
export function exactCounterScale(zoom: number): number {
  return 1 / zoom
}

/**
 * 越界翻转判定：bar（屏幕坐标）越过视口上沿时翻转到节点下方。
 */
export function resolveBarPlacement(barBox: Box, viewportBox: Box): 'top' | 'bottom' {
  return barBox.y <= viewportBox.y ? 'bottom' : 'top'
}

/**
 * 快捷工具编排（config 驱动）：后续能力包把对应项的 disabled 翻为 false 即点亮。
 */
export function buildSelectionTools(opts: { hasUrl: boolean }): SelectionToolDef[] {
  return [
    { id: 'refine', icon: 'refine', title: '精修', label: '精修', disabled: false, group: 'ai' },
    { id: 'matting', icon: 'matting', title: '抠图', label: '抠图', disabled: false, group: 'ai' },
    { id: 'outpaint', icon: 'outpaint', title: '扩图', label: '扩图', disabled: false, group: 'ai' },
    { id: 'crop', icon: 'crop', title: '裁剪', label: '裁剪', disabled: false, group: 'ai' },
    { id: 'inpaint', icon: 'inpaint', title: '局部重绘', label: '重绘', disabled: false, group: 'ai' },
    { id: 'element-edit', icon: 'element', title: '元素编辑', label: '元素编辑', disabled: false, group: 'ai' },
    { id: 'annotate', icon: 'annotate', title: '标注', label: '标注', disabled: false, group: 'ai' },
    { id: 'rotate', icon: 'rotate', title: '旋转/翻转', label: '旋转', disabled: true, disabledReason: '旋转/翻转将在后续能力包点亮', group: 'ai' },
    { id: 'download', icon: 'download', title: '下载图片', label: '下载', disabled: !opts.hasUrl, group: 'file' },
    { id: 'save-asset', icon: 'save-asset', title: '存入资产库', label: '存图', disabled: !opts.hasUrl, group: 'file' },
  ]
}
