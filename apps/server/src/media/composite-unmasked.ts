import sharp from 'sharp'

export { readImageBuffer } from './upstream-ref-downscale'

export class MaskDimensionMismatchError extends Error {
  constructor(message = 'Mask dimensions do not match base image') {
    super(message)
    this.name = 'MaskDimensionMismatchError'
  }
}

async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}

export async function assertSameDimensions(
  base: Buffer,
  mask: Buffer,
  result?: Buffer,
): Promise<{ width: number; height: number }> {
  const baseSize = await imageSize(base)
  const maskSize = await imageSize(mask)
  if (
    !baseSize.width ||
    !baseSize.height ||
    baseSize.width !== maskSize.width ||
    baseSize.height !== maskSize.height
  ) {
    throw new MaskDimensionMismatchError()
  }
  if (result) {
    const resultSize = await imageSize(result)
    if (resultSize.width !== baseSize.width || resultSize.height !== baseSize.height) {
      throw new MaskDimensionMismatchError()
    }
  }
  return baseSize
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

async function toRgbaRaw(
  buffer: Buffer,
  missingAlpha = 1,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha(missingAlpha)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

export async function compositeUnmaskedPixels(input: {
  base: Buffer
  result: Buffer
  mask: Buffer
}): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { width, height } = await assertSameDimensions(input.base, input.mask, input.result)
  const [baseRaw, resultRaw, maskRaw] = await Promise.all([
    toRgbaRaw(input.base),
    toRgbaRaw(input.result),
    toRgbaRaw(input.mask, 0),
  ])

  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const maskValue = Math.max(
      luma(maskRaw.data[o], maskRaw.data[o + 1], maskRaw.data[o + 2]),
      maskRaw.data[o + 3],
    )
    const editable = maskValue > 127
    const src = editable ? resultRaw.data : baseRaw.data
    out[o] = src[o]
    out[o + 1] = src[o + 1]
    out[o + 2] = src[o + 2]
    out[o + 3] = src[o + 3]
  }

  const buffer = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
  return { buffer, width, height }
}
