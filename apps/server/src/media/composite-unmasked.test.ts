import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  MaskDimensionMismatchError,
  assertSameDimensions,
  compositeUnmaskedPixels,
  readImageBuffer,
} from './composite-unmasked'

async function png(data: Buffer, width: number, height: number) {
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

async function rgbaPng(data: Buffer, width: number, height: number) {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

describe('compositeUnmaskedPixels', () => {
  it('keeps base pixels outside mask and result pixels inside mask', async () => {
    const base = await png(Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]), 2, 2)
    const result = await png(Buffer.from([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]), 2, 2)
    const mask = await png(Buffer.from([255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0]), 2, 2)
    const out = await compositeUnmaskedPixels({ base, result, mask })
    const raw = await sharp(out.buffer).removeAlpha().raw().toBuffer()
    expect([raw[0], raw[1], raw[2]]).toEqual([0, 0, 255])
    expect([raw[3], raw[4], raw[5]]).toEqual([255, 0, 0])
  })

  it('treats white alpha as editable when RGB is black', async () => {
    const base = await png(Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]), 2, 2)
    const result = await png(Buffer.from([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]), 2, 2)
    const mask = await rgbaPng(
      Buffer.from([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]),
      2,
      2,
    )
    const out = await compositeUnmaskedPixels({ base, result, mask })
    const raw = await sharp(out.buffer).removeAlpha().raw().toBuffer()
    expect([raw[0], raw[1], raw[2]]).toEqual([0, 0, 255])
    expect([raw[3], raw[4], raw[5]]).toEqual([255, 0, 0])
  })

  it('throws MaskDimensionMismatchError when result size differs', async () => {
    const base = await png(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)
    const result = await png(Buffer.from([0, 0, 0]), 1, 1)
    const mask = await png(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)
    await expect(compositeUnmaskedPixels({ base, result, mask })).rejects.toBeInstanceOf(
      MaskDimensionMismatchError,
    )
  })
})

describe('assertSameDimensions', () => {
  it('throws MaskDimensionMismatchError when mask size differs', async () => {
    const base = await png(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)
    const mask = await png(Buffer.from([0, 0, 0]), 1, 1)
    await expect(assertSameDimensions(base, mask)).rejects.toBeInstanceOf(MaskDimensionMismatchError)
  })

  it('returns shared width and height when sizes match', async () => {
    const base = await png(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)
    const mask = await png(Buffer.from([255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0]), 2, 2)
    await expect(assertSameDimensions(base, mask)).resolves.toEqual({ width: 2, height: 2 })
  })
})

describe('readImageBuffer', () => {
  const uploadsRoot = join(process.cwd(), 'uploads')
  const userDir = join(uploadsRoot, 'u-composite')

  beforeEach(async () => {
    await mkdir(userDir, { recursive: true })
    await writeFile(join(userDir, 'ref.png'), Buffer.from('local-upload-bytes'))
  })

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true })
  })

  it('reads local /api/uploads files from disk', async () => {
    const buf = await readImageBuffer('/api/uploads/u-composite/ref.png')
    expect(buf.toString()).toBe('local-upload-bytes')
  })
})
