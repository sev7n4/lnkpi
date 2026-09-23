/** 拖拽椭圆的几何计算（spec §8）：中心=两点中点，半径=两点差绝对值的一半；Shift 锁正圆。 */
export interface EllipseDragInput {
  start: { x: number; y: number }
  end: { x: number; y: number }
  shiftKey?: boolean
}

export interface EllipseShape {
  cx: number
  cy: number
  rx: number
  ry: number
}

export function ellipseFromDrag(input: EllipseDragInput): EllipseShape {
  const cx = (input.start.x + input.end.x) / 2
  const cy = (input.start.y + input.end.y) / 2
  const rx = Math.abs(input.end.x - input.start.x) / 2
  const ry = Math.abs(input.end.y - input.start.y) / 2
  if (input.shiftKey) {
    const r = Math.max(rx, ry)
    return { cx, cy, rx: r, ry: r }
  }
  return { cx, cy, rx, ry }
}
