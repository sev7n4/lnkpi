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

/** Normalize SAM PNG alpha: use alpha when varied; if all ~255, use luminance as selection. */
export function normalizeRemoteMaskRgba(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  let allOpaque = out.length > 0
  for (let i = 3; i < out.length; i += 4) {
    if (out[i]! < 250) {
      allOpaque = false
      break
    }
  }
  if (!allOpaque) return out
  for (let i = 0; i < out.length; i += 4) {
    const luma = (out[i]! + out[i + 1]! + out[i + 2]!) / 3
    out[i + 3] = luma > 127 ? 255 : 0
  }
  return out
}

export async function loadMaskRgbaFromUrl(
  url: string,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const img = await createImageBitmap(await (await fetch(url)).blob())
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)
  return normalizeRemoteMaskRgba(ctx.getImageData(0, 0, width, height).data)
}

type PointSelectPayload = { x: number; y: number }

let pointSelectHandler: ((pt: PointSelectPayload) => void) | null = null

export function registerRefinePointSelectHandler(fn: ((pt: PointSelectPayload) => void) | null) {
  pointSelectHandler = fn
}

export function dispatchRefinePointSelect(pt: PointSelectPayload) {
  pointSelectHandler?.(pt)
}
