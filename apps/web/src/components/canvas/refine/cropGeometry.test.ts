import { describe, expect, it } from 'vitest'
import {
  CROP_MIN_SIZE,
  clampCropRect,
  fitCropRect,
  fitCropRectWithRatio,
  formatCropReadout,
  largestUprightRect,
  moveCropRect,
  normalizeCropRotation,
  resizeCropRect,
  rotatedSize,
  totalCropRotationDeg,
} from './cropGeometry'

const insideRotatedImage = (
  r: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number,
  thetaDeg: number,
): boolean => {
  // 四角（包围盒坐标 → 旋转坐标系）全部满足 |p·u| ≤ W/2、|p·v| ≤ H/2
  const t = (thetaDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  const bw = imgW * c + imgH * s
  const bh = imgW * s + imgH * c
  const corners = [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x, r.y + r.height],
    [r.x + r.width, r.y + r.height],
  ]
  return corners.every(([px, py]) => {
    const dx = px - bw / 2
    const dy = py - bh / 2
    return Math.abs(dx * c + dy * s) <= imgW / 2 + 1e-6 && Math.abs(-dx * s + dy * c) <= imgH / 2 + 1e-6
  })
}

describe('normalizeCropRotation / totalCropRotationDeg', () => {
  it('归一化到 (-180, 180]', () => {
    expect(normalizeCropRotation(0)).toBe(0)
    expect(normalizeCropRotation(90)).toBe(90)
    expect(normalizeCropRotation(180)).toBe(180)
    expect(normalizeCropRotation(270)).toBe(-90)
    expect(normalizeCropRotation(-180)).toBe(180)
    expect(normalizeCropRotation(450)).toBe(90)
  })

  it('步进 + 微调合成；微调钳在 ±45', () => {
    expect(totalCropRotationDeg(1, 0)).toBe(90)
    expect(totalCropRotationDeg(-1, -30)).toBe(-120)
    expect(totalCropRotationDeg(0, 60)).toBe(45)
    expect(totalCropRotationDeg(0, -60)).toBe(-45)
    expect(totalCropRotationDeg(4, 15)).toBe(15) // 360 归一
  })
})

describe('rotatedSize', () => {
  it('θ=0 恒等；θ=90 转置；θ=45 对角放大', () => {
    expect(rotatedSize(100, 50, 0)).toEqual({ width: 100, height: 50 })
    const r90 = rotatedSize(100, 50, 90)
    expect(r90.width).toBeCloseTo(50, 6)
    expect(r90.height).toBeCloseTo(100, 6)
    const r45 = rotatedSize(100, 50, 45)
    expect(r45.width).toBeCloseTo((100 + 50) * Math.SQRT1_2, 6)
    expect(r45.height).toBeCloseTo((100 + 50) * Math.SQRT1_2, 6)
  })
})

describe('largestUprightRect', () => {
  it('θ=0 → 全图', () => {
    expect(largestUprightRect(400, 300, 0)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('θ=90 → 尺寸转置且居中于包围盒', () => {
    const r = largestUprightRect(400, 300, 90)
    expect(r.width).toBeCloseTo(300, 6)
    expect(r.height).toBeCloseTo(400, 6)
    expect(r.x).toBeCloseTo(0, 6)
    expect(r.y).toBeCloseTo(0, 6)
  })

  it('θ=45 → 菱形内接（面积 < 原图）且四角在原图内', () => {
    const w = 400
    const h = 300
    const r = largestUprightRect(w, h, 45)
    expect(r.width * r.height).toBeLessThan(w * h)
    expect(insideRotatedImage(r, w, h, 45)).toBe(true)
  })

  it('θ=30 → 内接矩形四角全部落在旋转原图内', () => {
    const w = 640
    const h = 480
    const r = largestUprightRect(w, h, 30)
    expect(insideRotatedImage(r, w, h, 30)).toBe(true)
  })
})

describe('fitCropRect', () => {
  it('free = 最大内接；比例预设装进内接矩形并保持比例', () => {
    const free = fitCropRect(400, 300, 0, 'free')
    expect(free).toEqual({ x: 0, y: 0, width: 400, height: 300 })

    const sq = fitCropRect(400, 300, 0, '1:1')
    expect(sq.width).toBeCloseTo(sq.height, 6)
    expect(sq.width).toBeCloseTo(300, 6)
    expect(sq.x).toBeCloseTo(50, 6)

    const wide = fitCropRect(400, 300, 0, '16:9')
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 6)
    expect(wide.width).toBeLessThanOrEqual(400 + 1e-6)
    expect(wide.height).toBeLessThanOrEqual(300 + 1e-6)
  })

  it('旋转后适配仍无透明楔角', () => {
    const r = fitCropRect(640, 480, 30, '4:3')
    expect(r.width / r.height).toBeCloseTo(4 / 3, 6)
    expect(insideRotatedImage(r, 640, 480, 30)).toBe(true)
  })
})

describe('clampCropRect', () => {
  it('θ=0：框内平移钳到包围盒', () => {
    const out = clampCropRect({ x: -50, y: 900, width: 100, height: 80 }, 400, 300, 0)
    expect(out.x).toBe(0)
    expect(out.y).toBe(300 - 80)
    expect(out.width).toBe(100)
  })

  it('θ=0：超大框缩到原图内', () => {
    const out = clampCropRect({ x: -10, y: -10, width: 800, height: 600 }, 400, 300, 0)
    expect(out.width).toBeLessThanOrEqual(400 + 1e-6)
    expect(out.height).toBeLessThanOrEqual(300 + 1e-6)
  })

  it('旋转后：越界框被钳回旋转原图内（四角约束）', () => {
    // 从合法内接框出发，向角上平移出去 → clamp 后必须重新合法
    const legal = largestUprightRect(640, 480, 30)
    const pushed = { ...legal, x: legal.x + 400, y: legal.y + 400 }
    const out = clampCropRect(pushed, 640, 480, 30)
    expect(insideRotatedImage(out, 640, 480, 30)).toBe(true)
  })

  it('旋转后：合法框保持尺寸（不被误缩）', () => {
    const legal = largestUprightRect(640, 480, 30)
    const out = clampCropRect(legal, 640, 480, 30)
    expect(out.width).toBeCloseTo(legal.width, 4)
    expect(out.height).toBeCloseTo(legal.height, 4)
  })

  it('单边下限：小于 CROP_MIN_SIZE 抬到下限', () => {
    const out = clampCropRect({ x: 0, y: 0, width: 5, height: 5 }, 400, 300, 0)
    expect(out.width).toBe(CROP_MIN_SIZE)
    expect(out.height).toBe(CROP_MIN_SIZE)
  })
})

describe('moveCropRect', () => {
  it('按增量平移且钳制', () => {
    const out = moveCropRect({ x: 0, y: 0, width: 100, height: 100 }, 50, 50, 400, 300, 0)
    expect(out.x).toBe(50)
    expect(out.y).toBe(50)
    const over = moveCropRect({ x: 350, y: 0, width: 100, height: 100 }, 100, 0, 400, 300, 0)
    expect(over.x).toBe(300)
  })
})

describe('resizeCropRect', () => {
  it('东手柄：右边界跟指针，左边界不动', () => {
    const out = resizeCropRect({ x: 100, y: 100, width: 100, height: 100 }, 'e', 50, 0, 400, 300, 0)
    expect(out.x).toBe(100)
    expect(out.width).toBe(150)
  })

  it('西手柄：左边界跟指针，越过后不小于 MIN', () => {
    const out = resizeCropRect({ x: 100, y: 100, width: 100, height: 100 }, 'w', 30, 0, 400, 300, 0)
    expect(out.x).toBe(130)
    expect(out.width).toBe(70)
    const min = resizeCropRect({ x: 100, y: 100, width: 100, height: 100 }, 'w', 500, 0, 400, 300, 0)
    expect(min.width).toBe(CROP_MIN_SIZE)
    expect(min.x).toBe(200 - CROP_MIN_SIZE)
  })

  it('北手柄：上边界跟指针且钳回原图内', () => {
    const out = resizeCropRect({ x: 50, y: 50, width: 200, height: 100 }, 'n', 0, -20, 400, 300, 0)
    expect(out.y).toBe(30)
    expect(out.height).toBe(120)
  })

  it('比例锁定 1:1：东边手柄只动宽不联动高；se 角手柄仍等比（2026-09-25 同步直裁语义）', () => {
    const out = resizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 'e', 40, 0, 400, 300, 0, '1:1')
    expect(out.width).toBe(140)
    expect(out.height).toBeCloseTo(100, 6)
    const corner = resizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 'se', 40, 40, 400, 300, 0, '1:1')
    expect(corner.width).toBe(140)
    expect(corner.height).toBeCloseTo(140, 6)
  })

  it('比例锁定 16:9：北边手柄只动高不联动宽；se 角手柄仍等比', () => {
    const out = resizeCropRect({ x: 100, y: 100, width: 160, height: 90 }, 'n', 0, -9, 400, 300, 0, '16:9')
    expect(out.height).toBe(99)
    expect(out.width).toBe(160)
    const corner = resizeCropRect({ x: 100, y: 100, width: 160, height: 90 }, 'se', 16, 9, 400, 300, 0, '16:9')
    expect(corner.height).toBe(99)
    expect(corner.width).toBeCloseTo(99 * (16 / 9), 6)
  })

  it('角手柄 se：宽高同步变化并钳制', () => {
    const out = resizeCropRect({ x: 50, y: 50, width: 100, height: 80 }, 'se', 60, 40, 400, 300, 0)
    expect(out.width).toBe(160)
    expect(out.height).toBe(120)
    expect(insideRotatedImage(out, 400, 300, 0)).toBe(true)
  })
})

describe('formatCropReadout', () => {
  it('整数读数', () => {
    expect(formatCropReadout({ x: 0, y: 0, width: 399.4, height: 299.6 })).toBe('399 × 300')
  })
})

describe('fitCropRectWithRatio（目标尺寸 → 自定义比例适配）', () => {
  it('θ=0：内接矩形里装下最大 4:3 比例矩形', () => {
    const r = fitCropRectWithRatio(400, 300, 0, 4 / 3)
    expect(r).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    const r2 = fitCropRectWithRatio(800, 300, 0, 4 / 3)
    expect(r2.height).toBe(300)
    expect(r2.width).toBe(400)
    expect(r2.x).toBe(200)
  })

  it('非法比例回落到内接矩形', () => {
    const r = fitCropRectWithRatio(400, 300, 0, 0)
    expect(r).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })
})
