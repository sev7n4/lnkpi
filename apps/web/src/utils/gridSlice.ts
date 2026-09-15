export type SliceRect = { x: number; y: number; w: number; h: number }

const MIN_GRID = 1
const MAX_GRID = 7

function clampDim(n: number): number {
  return Math.min(MAX_GRID, Math.max(MIN_GRID, n))
}

export function clampGridDims(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: clampDim(cols), rows: clampDim(rows) }
}

export function equalSliceRects(
  width: number,
  height: number,
  cols: number,
  rows: number,
): SliceRect[] {
  const baseW = Math.floor(width / cols)
  const baseH = Math.floor(height / rows)
  const rects: SliceRect[] = []
  let y = 0

  for (let r = 0; r < rows; r++) {
    const h = r === rows - 1 ? height - y : baseH
    let x = 0
    for (let c = 0; c < cols; c++) {
      const w = c === cols - 1 ? width - x : baseW
      rects.push({ x, y, w, h })
      x += w
    }
    y += h
  }

  return rects
}
