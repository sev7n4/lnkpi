import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { computeMaskBBox, isMaskPixelHit } from './element-recognize.util'

/** 无 alpha 的灰度（L 模式）蒙版：黑底 + 白色矩形——自建 MobileSAM 导出的就是这个形态。 */
async function grayscaleMask(
  w: number,
  h: number,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  const patch = await sharp({
    create: { width: rect.width, height: rect.height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer()
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: patch, left: rect.x, top: rect.y }])
    .toColourspace('b-w')
    .removeAlpha()
    .png()
    .toBuffer()
}

/** 带真 alpha 的 RGBA 蒙版：透明底 + 不透明白矩形。 */
async function alphaMask(
  w: number,
  h: number,
  rect: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  const patch = await sharp({
    create: {
      width: rect.width,
      height: rect.height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: patch, left: rect.x, top: rect.y }])
    .png()
    .toBuffer()
}

describe('isMaskPixelHit', () => {
  it('无 alpha 通道的蒙版按亮度判定：黑底不算命中', () => {
    // L 模式 PNG 经 ensureAlpha 后 alpha 恒 255，若用 OR 判定会整图命中
    expect(isMaskPixelHit(0, 0, 0, 255)).toBe(false)
    expect(isMaskPixelHit(255, 255, 255, 255)).toBe(true)
  })

  it('带 alpha 的蒙版透明处不算命中（即使像素是白的）', () => {
    expect(isMaskPixelHit(255, 255, 255, 0)).toBe(false)
    expect(isMaskPixelHit(255, 255, 255, 255)).toBe(true)
  })
})

describe('computeMaskBBox', () => {
  it('L 模式蒙版返回白形紧包围盒（不再是整图）', async () => {
    const buf = await grayscaleMask(200, 200, { x: 40, y: 60, width: 30, height: 50 })
    const meta = await sharp(buf).metadata()
    expect(meta.channels).toBe(1)
    await expect(computeMaskBBox(buf, 200, 200)).resolves.toEqual({
      x: 40,
      y: 60,
      width: 30,
      height: 50,
    })
  })

  it('RGBA 蒙版按 alpha 取紧包围盒', async () => {
    const buf = await alphaMask(200, 200, { x: 10, y: 120, width: 60, height: 20 })
    await expect(computeMaskBBox(buf, 200, 200)).resolves.toEqual({
      x: 10,
      y: 120,
      width: 60,
      height: 20,
    })
  })

  it('蒙版尺寸与原图不一致时先对齐再取框（2 倍放大，容差 2px）', async () => {
    const buf = await grayscaleMask(100, 100, { x: 10, y: 10, width: 20, height: 20 })
    const got = await computeMaskBBox(buf, 200, 200)
    expect(got).not.toBeNull()
    expect(Math.abs((got?.x ?? 0) - 20)).toBeLessThanOrEqual(2)
    expect(Math.abs((got?.y ?? 0) - 20)).toBeLessThanOrEqual(2)
    expect(Math.abs((got?.width ?? 0) - 40)).toBeLessThanOrEqual(2)
    expect(Math.abs((got?.height ?? 0) - 40)).toBeLessThanOrEqual(2)
  })

  it('全黑蒙版返回 null（未识别到对象）', async () => {
    const buf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .toColourspace('b-w')
      .png()
      .toBuffer()
    await expect(computeMaskBBox(buf, 64, 64)).resolves.toBeNull()
  })
})
