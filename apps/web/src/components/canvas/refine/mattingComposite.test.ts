// mattingComposite.test.ts —— 把核心逻辑抽成可测纯函数 applyAlphaFromMask
import { describe, expect, it } from 'vitest'
import { applyAlphaFromMask } from './mattingComposite'

describe('applyAlphaFromMask', () => {
  const rgba = (r: number, g: number, b: number, a: number) => [r, g, b, a]

  it('mask 白色区域保留 alpha，黑色区域归零', () => {
    const image = new Uint8ClampedArray([
      ...rgba(200, 10, 10, 255), // 像素0：mask 白 → 保留
      ...rgba(10, 200, 10, 255), // 像素1：mask 黑 → alpha 0
    ])
    const mask = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0])
    const out = applyAlphaFromMask(image, mask)
    expect([out[0], out[1], out[2], out[3]]).toEqual([200, 10, 10, 255])
    expect(out[7]).toBe(0)
  })

  it('mask 灰度产生半透明（边缘软化）', () => {
    const image = new Uint8ClampedArray([...rgba(0, 0, 255, 255)])
    const mask = new Uint8ClampedArray([128, 128, 128, 255])
    const out = applyAlphaFromMask(image, mask)
    expect(out[3]).toBe(128)
  })

  it('mask 长度与像素数不匹配时抛错', () => {
    expect(() => applyAlphaFromMask(new Uint8ClampedArray(4), new Uint8ClampedArray(8))).toThrow()
  })
})
