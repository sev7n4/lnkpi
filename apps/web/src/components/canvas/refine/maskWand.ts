export function clampWandTolerance(n: number): number {
  if (!Number.isFinite(n)) return 24
  return Math.min(48, Math.max(0, Math.round(n)))
}

export function parseFillHex(color: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim())
  if (!m) return [255, 255, 255]
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function invertMaskRgba(maskRgba: Uint8ClampedArray): Uint8ClampedArray {
  const next = new Uint8ClampedArray(maskRgba)
  for (let i = 0; i < next.length; i += 4) {
    if (next[i + 3] > 127) {
      next[i] = 0
      next[i + 1] = 0
      next[i + 2] = 0
      next[i + 3] = 0
    } else {
      next[i] = 255
      next[i + 1] = 255
      next[i + 2] = 255
      next[i + 3] = 255
    }
  }
  return next
}

export function floodFillMask(input: {
  width: number
  height: number
  imageRgba: Uint8ClampedArray
  maskRgba: Uint8ClampedArray
  x: number
  y: number
  tolerance: number
  fillRgb: [number, number, number]
  mode?: 'add' | 'subtract'
}): Uint8ClampedArray {
  const { width, height, imageRgba, maskRgba, fillRgb } = input
  const mode = input.mode === 'subtract' ? 'subtract' : 'add'
  const expected = width * height * 4
  if (
    width <= 0 ||
    height <= 0 ||
    imageRgba.length !== expected ||
    maskRgba.length !== expected
  ) {
    return maskRgba
  }
  const x0 = Math.floor(input.x)
  const y0 = Math.floor(input.y)
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return maskRgba

  const next = new Uint8ClampedArray(maskRgba)
  const seed = (y0 * width + x0) * 4
  const sr = imageRgba[seed]
  const sg = imageRgba[seed + 1]
  const sb = imageRgba[seed + 2]
  const tol = clampWandTolerance(input.tolerance)
  const seen = new Uint8Array(width * height)
  const qx = [x0]
  const qy = [y0]
  seen[y0 * width + x0] = 1

  const inTol = (ix: number, iy: number) => {
    const o = (iy * width + ix) * 4
    const dr = Math.abs(imageRgba[o] - sr)
    const dg = Math.abs(imageRgba[o + 1] - sg)
    const db = Math.abs(imageRgba[o + 2] - sb)
    return Math.max(dr, dg, db) <= tol
  }

  while (qx.length) {
    const x = qx.pop()!
    const y = qy.pop()!
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
    const nbs = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const idx = ny * width + nx
      if (seen[idx]) continue
      if (!inTol(nx, ny)) continue
      seen[idx] = 1
      qx.push(nx)
      qy.push(ny)
    }
  }
  return next
}
