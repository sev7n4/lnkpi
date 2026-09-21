export {
  clampGridDims,
  equalSliceRects,
  GRID_SLICE_MAX_EDGE,
  type SliceRect,
} from '@lnkpi/shared'

export const GRID_SLICE_LAYOUT_GAP = 36

/** 单格最小边长（px）：宽/cols 或 高/rows 任一低于该值即禁用该档位（spec §7.4-B3） */
export const GRID_SLICE_MIN_CELL_PX = 64

/** 左面板预设档位（n = 张数），供 GridSliceDropdown 直接渲染 */
export function gridSlicePresetOptions(): Array<{ n: number; label: string }> {
  return [
    { n: 4, label: '4宫格 (2×2)' },
    { n: 9, label: '9宫格 (3×3)' },
    { n: 16, label: '16宫格 (4×4)' },
    { n: 25, label: '25宫格 (5×5)' },
  ]
}

/** 单格像素是否达标：原图宽/cols 与 高/rows 任一 < minCellPx 即 false */
export function canSliceAtCell(
  base: { width: number; height: number },
  cols: number,
  rows: number,
  minCellPx = GRID_SLICE_MIN_CELL_PX,
): boolean {
  const c = Math.max(1, cols)
  const r = Math.max(1, rows)
  return base.width / c >= minCellPx && base.height / r >= minCellPx
}

/** 下拉弹出方向：默认向下；下方放不下且上方更宽裕时向上翻 */
export function resolveDropdownPlacement(
  spaceBelow: number,
  spaceAbove: number,
  menuHeight: number,
): 'bottom' | 'top' {
  return spaceBelow >= menuHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top'
}

/** Row-major canvas positions for slice children (index order matches equalSliceRects). */
export function layoutSliceChildPositions(
  origin: { x: number; y: number },
  sizes: ReadonlyArray<{ w: number; h: number }>,
  cols: number,
  gap = GRID_SLICE_LAYOUT_GAP,
): Array<{ x: number; y: number }> {
  const columnCount = Math.max(1, cols)
  return sizes.map(({ w, h }, i) => {
    const col = i % columnCount
    const row = Math.floor(i / columnCount)
    return {
      x: origin.x + col * (w + gap),
      y: origin.y + row * (h + gap),
    }
  })
}
