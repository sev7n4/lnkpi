export {
  clampGridDims,
  equalSliceRects,
  GRID_SLICE_MAX_EDGE,
  type SliceRect,
} from '@lnkpi/shared'

export const GRID_SLICE_LAYOUT_GAP = 36

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
