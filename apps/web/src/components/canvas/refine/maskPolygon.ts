export function isNearPolygonStart(
  points: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  thresholdPx = 12,
): boolean {
  const start = points[0]
  if (!start) return false
  const dx = x - start.x
  const dy = y - start.y
  return dx * dx + dy * dy <= thresholdPx * thresholdPx
}

function pointInPolygonEvenOdd(
  x: number,
  y: number,
  points: Array<{ x: number; y: number }>,
): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x
    const yi = points[i].y
    const xj = points[j].x
    const yj = points[j].y
    if (yj === yi) continue
    const xIntersect = ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (yi > y !== yj > y && x < xIntersect) inside = !inside
  }
  return inside
}

export function fillPolygonMask(input: {
  width: number
  height: number
  maskRgba: Uint8ClampedArray
  points: Array<{ x: number; y: number }>
  fillRgb: [number, number, number]
  mode: 'add' | 'subtract'
}): Uint8ClampedArray {
  const { width, height, maskRgba, points, fillRgb, mode } = input
  const expected = width * height * 4
  if (width <= 0 || height <= 0 || maskRgba.length !== expected || points.length < 3) {
    return maskRgba
  }
  const next = new Uint8ClampedArray(maskRgba)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pointInPolygonEvenOdd(x + 0.5, y + 0.5, points)) continue
      const o = (y * width + x) * 4
      if (mode === 'subtract') {
        next[o] = 0
        next[o + 1] = 0
        next[o + 2] = 0
        next[o + 3] = 0
      } else {
        next[o] = fillRgb[0]
        next[o + 1] = fillRgb[1]
        next[o + 2] = fillRgb[2]
        next[o + 3] = 255
      }
    }
  }
  return next
}
