/**
 * 选中浮层（SelectionActionBar）的纯函数模型，web 本地、无框架依赖。
 * GridSliceDropdown（Task 12）复用 clampCounterScale / resolveBarPlacement。
 */

export interface SelectionToolDef {
  id: string
  /** 图标键名，由渲染层映射为 SVG */
  icon: string
  title: string
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
 * 反缩放系数：抵消 viewport zoom 对浮层的拉伸，clamp 到 [0.8, 1.2]
 * 避免极端缩放下浮层与内容比例失衡。
 */
export function clampCounterScale(zoom: number): number {
  return Math.min(1.2, Math.max(0.8, 1 / zoom))
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
    { id: 'refine', icon: 'refine', title: '精修', disabled: false, group: 'ai' },
    { id: 'matting', icon: 'matting', title: '抠图', disabled: true, disabledReason: '抠图将在后续能力包点亮', group: 'ai' },
    { id: 'crop', icon: 'crop', title: '裁剪', disabled: true, disabledReason: '裁剪将在后续能力包点亮', group: 'ai' },
    { id: 'rotate', icon: 'rotate', title: '旋转/翻转', disabled: true, disabledReason: '旋转/翻转将在后续能力包点亮', group: 'ai' },
    { id: 'download', icon: 'download', title: '下载图片', disabled: !opts.hasUrl, group: 'file' },
    { id: 'save-asset', icon: 'save-asset', title: '存入资产库', disabled: !opts.hasUrl, group: 'file' },
  ]
}
