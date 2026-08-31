export function mergeMaskRgba(opts: {
  width: number
  height: number
  baseMaskRgba: Uint8ClampedArray
  remoteMaskRgba: Uint8ClampedArray
  fillRgb: [number, number, number]
  mode: 'add' | 'subtract'
}): Uint8ClampedArray {
  const n = opts.width * opts.height * 4
  const out = new Uint8ClampedArray(opts.baseMaskRgba)
  const [fr, fg, fb] = opts.fillRgb
  for (let i = 0; i < n; i += 4) {
    if (opts.remoteMaskRgba[i + 3]! <= 127) continue
    if (opts.mode === 'subtract') {
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      out[i + 3] = 0
    } else {
      out[i] = fr
      out[i + 1] = fg
      out[i + 2] = fb
      out[i + 3] = 255
    }
  }
  return out
}
