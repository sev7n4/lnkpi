import { describe, expect, it } from 'vitest'
import {
  NODE_CROP_MIN_DISPLAY,
  coverFitTransform,
  displayRectToPixelRect,
  fitDisplayCropRect,
  moveDisplayCropRect,
  nodeCropLockRatio,
  resizeDisplayCropRect,
} from './nodeCropModel'

describe('coverFitTransform', () => {
  it('宽图装方卡：cover 按高撑满，横向溢出（offsetX 为负）', () => {
    // 400×200 图 → 200×200 卡：scale = max(0.5, 1) = 1，显示区只露出图像中央 200 宽
    const t = coverFitTransform(400, 200, 200, 200)
    expect(t.scale).toBeCloseTo(1)
    expect(t.offsetX).toBeCloseTo(-100)
    expect(t.offsetY).toBeCloseTo(0)
  })

  it('高图装方卡：cover 按宽撑满，纵向溢出（offsetY 为负）', () => {
    const t = coverFitTransform(200, 400, 200, 200)
    expect(t.scale).toBeCloseTo(1)
    expect(t.offsetX).toBeCloseTo(0)
    expect(t.offsetY).toBeCloseTo(-100)
  })

  it('同比例图零偏移', () => {
    const t = coverFitTransform(1000, 1000, 280, 280)
    expect(t.offsetX).toBeCloseTo(0)
    expect(t.offsetY).toBeCloseTo(0)
  })

  it('非法尺寸回退恒等变换', () => {
    expect(coverFitTransform(0, 100, 100, 100)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
  })
})

describe('displayRectToPixelRect', () => {
  // 400×200 原图装 200×200 卡：scale=1, offset=(-100,0)，卡内可见像素带 x∈[100,300]
  it('全卡裁剪 → 原图中央可见带', () => {
    const r = displayRectToPixelRect({ x: 0, y: 0, width: 200, height: 200 }, 400, 200, 200, 200)
    expect(r).toEqual({ x: 100, y: 0, width: 200, height: 200 })
  })

  it('卡与原图同尺寸 → 恒等映射', () => {
    const r = displayRectToPixelRect({ x: 10, y: 20, width: 30, height: 40 }, 200, 200, 200, 200)
    expect(r).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('卡内左半 → 可见带左半', () => {
    const r = displayRectToPixelRect({ x: 0, y: 0, width: 100, height: 200 }, 400, 200, 200, 200)
    expect(r).toEqual({ x: 100, y: 0, width: 100, height: 200 })
  })

  it('缩小图（scale>1）纵向溢出时正确反解', () => {
    // 100×200 图装 200×200 卡：scale = max(2, 1) = 2，offsetY = (200-400)/2 = -100
    // display(10,20,30,40) → pixel x=10/2=5, y=(20+100)/2=60, w=15, h=20
    const r = displayRectToPixelRect({ x: 10, y: 20, width: 30, height: 40 }, 100, 200, 200, 200)
    expect(r).toEqual({ x: 5, y: 60, width: 15, height: 20 })
  })

  it('钳进原图边界并取整', () => {
    // display 框超出卡右下 → pixel 钳回图内
    const r = displayRectToPixelRect({ x: 180, y: 180, width: 100, height: 100 }, 400, 200, 200, 200)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(400)
    expect(r.y + r.height).toBeLessThanOrEqual(200)
  })
})

describe('fitDisplayCropRect', () => {
  it('ratio=null → 全卡', () => {
    expect(fitDisplayCropRect(200, 200, null)).toEqual({ x: 0, y: 0, width: 200, height: 200 })
  })

  it('方卡里 16:9 → 上下居中的 16:9', () => {
    const r = fitDisplayCropRect(200, 200, 16 / 9)
    expect(r.width).toBeCloseTo(200)
    expect(r.height).toBeCloseTo(200 * 9 / 16)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo((200 - 200 * 9 / 16) / 2)
  })

  it('比例超出卡宽 → 由高驱动', () => {
    const r = fitDisplayCropRect(200, 200, 9 / 16)
    expect(r.height).toBeCloseTo(200)
    expect(r.width).toBeCloseTo(200 * 9 / 16)
  })
})

describe('nodeCropLockRatio', () => {
  it('original 用原图宽高比；free 为 null', () => {
    expect(nodeCropLockRatio('original', 400, 200)).toBeCloseTo(2)
    expect(nodeCropLockRatio('free', 400, 200)).toBeNull()
  })
  it('original 在原图尺寸无效时回退 null', () => {
    expect(nodeCropLockRatio('original', 0, 200)).toBeNull()
  })
  it('预设映射数值比例', () => {
    expect(nodeCropLockRatio('1:1', 0, 0)).toBeCloseTo(1)
    expect(nodeCropLockRatio('16:9', 0, 0)).toBeCloseTo(16 / 9)
  })
})

describe('moveDisplayCropRect', () => {
  it('平移并钳进卡内', () => {
    const r = moveDisplayCropRect({ x: 0, y: 0, width: 100, height: 100 }, 500, 500, 200, 200)
    expect(r).toEqual({ x: 100, y: 100, width: 100, height: 100 })
    const r2 = moveDisplayCropRect({ x: 100, y: 100, width: 100, height: 100 }, -500, -500, 200, 200)
    expect(r2).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })
})

describe('resizeDisplayCropRect', () => {
  const BOX = 200

  it('se 手柄扩大并钳进卡内', () => {
    const r = resizeDisplayCropRect({ x: 50, y: 50, width: 100, height: 100 }, 'se', 500, 500, BOX, BOX, null)
    expect(r.x).toBe(50)
    expect(r.y).toBe(50)
    expect(r.width).toBe(150)
    expect(r.height).toBe(150)
  })

  it('nw 手柄缩小不低于 24px 下限', () => {
    const r = resizeDisplayCropRect({ x: 50, y: 50, width: 100, height: 100 }, 'nw', 500, 500, BOX, BOX, null)
    expect(r.width).toBe(NODE_CROP_MIN_DISPLAY)
    expect(r.height).toBe(NODE_CROP_MIN_DISPLAY)
    expect(r.x).toBe(50 + 100 - NODE_CROP_MIN_DISPLAY)
  })

  it('比例锁定：n 手柄拖高驱动等比宽（左锚定，与 refine 裁剪同语义）', () => {
    const r = resizeDisplayCropRect({ x: 0, y: 0, width: 200, height: 100 }, 'n', 0, 20, BOX, BOX, 2)
    // 高 100-20=80 → 宽 160，左边固定
    expect(r.height).toBeCloseTo(80)
    expect(r.width).toBeCloseTo(160)
    expect(r.x).toBe(0)
  })

  it('比例锁定：e 手柄拖宽驱动等比高', () => {
    const r = resizeDisplayCropRect({ x: 0, y: 0, width: 100, height: 50 }, 'e', 40, 0, BOX, BOX, 2)
    expect(r.width).toBeCloseTo(140)
    expect(r.height).toBeCloseTo(70)
  })

  it('自由比例不锁', () => {
    const r = resizeDisplayCropRect({ x: 0, y: 0, width: 100, height: 100 }, 'e', 30, 0, BOX, BOX, null)
    expect(r.width).toBe(130)
    expect(r.height).toBe(100)
  })
})
