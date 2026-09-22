import { describe, expect, it } from 'vitest'
import {
  OUTPAINT_MIN_EDGE,
  OUTPAINT_MAX_AREA_RATIO,
  clampOutpaintCanvas,
  formatAspectLabel,
} from './outpaintGeometry'

describe('outpaintGeometry 常量', () => {
  it('单边最小 256px、面积上限 9 倍', () => {
    expect(OUTPAINT_MIN_EDGE).toBe(256)
    expect(OUTPAINT_MAX_AREA_RATIO).toBe(9)
  })
})

describe('clampOutpaintCanvas 合法扩展', () => {
  it('不触发 clamp 时原样返回新画布尺寸与 start 锚定', () => {
    const r = clampOutpaintCanvas(
      { width: 800, height: 600 },
      { width: 1000, height: 800 },
      { x: 'start', y: 'start' },
    )
    expect(r.width).toBe(1000)
    expect(r.height).toBe(800)
    // start 锚定：原图左上角贴新画布左上角
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })

  it('合法扩展面积不得超过原图 9 倍（此处 1000×800 < 9×800×600）', () => {
    const base = { width: 800, height: 600 }
    const r = clampOutpaintCanvas(
      base,
      { width: 1000, height: 800 },
      { x: 'start', y: 'start' },
    )
    expect(r.width * r.height).toBeLessThanOrEqual(
      OUTPAINT_MAX_AREA_RATIO * base.width * base.height,
    )
  })
})

describe('clampOutpaintCanvas 单边 < 256 下限 clamp', () => {
  it('请求宽度低于下限时被拉回 max(原宽, 256)', () => {
    // 原宽 800 → 下限取 800（原图本身更大），请求 100 被夹回 800
    const r = clampOutpaintCanvas(
      { width: 800, height: 600 },
      { width: 100, height: 800 },
      { x: 'start', y: 'start' },
    )
    expect(r.width).toBe(800)
    expect(r.height).toBe(800)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })

  it('原图小于 256 的短边按 256 兜底', () => {
    // 原图 300×200：高度下限取 256，请求 100 被夹回 256
    const r = clampOutpaintCanvas(
      { width: 300, height: 200 },
      { width: 300, height: 100 },
      { x: 'end', y: 'end' },
    )
    expect(r.width).toBe(300)
    expect(r.height).toBe(256)
    // end 锚定：原图右下对齐新画布右下
    expect(r.x).toBe(0) // 300 - 300
    expect(r.y).toBe(56) // 256 - 200
  })
})

describe('clampOutpaintCanvas 面积 > 9 倍 clamp', () => {
  it('等比缩放到恰好 9 倍面积上限', () => {
    // 原图 1000×1000（面积 1e6，上限 9e6）；请求 4000×4000（16e6）超上限
    const base = { width: 1000, height: 1000 }
    const r = clampOutpaintCanvas(
      base,
      { width: 4000, height: 4000 },
      { x: 'center', y: 'center' },
    )
    expect(r.width).toBe(3000)
    expect(r.height).toBe(3000)
    expect(r.width * r.height).toBe(OUTPAINT_MAX_AREA_RATIO * base.width * base.height)
    // 居中锚定
    expect(r.x).toBe(1000) // (3000-1000)/2
    expect(r.y).toBe(1000)
  })

  it('非正方形超面积请求按比例缩小且不超过上限', () => {
    const base = { width: 800, height: 600 } // 面积 480000，上限 4_320_000
    const r = clampOutpaintCanvas(
      base,
      { width: 3000, height: 2000 }, // 面积 6_000_000 > 上限
      { x: 'start', y: 'start' },
    )
    expect(r.width * r.height).toBeLessThanOrEqual(
      OUTPAINT_MAX_AREA_RATIO * base.width * base.height,
    )
    expect(r.width).toBeLessThan(3000)
    expect(r.height).toBeLessThan(2000)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
})

describe('clampOutpaintCanvas 中心/角锚定坐标', () => {
  // 原图 800×600，合法扩到 1200×1000（面积 1.2e6 ≤ 4.32e6）
  const base = { width: 800, height: 600 }
  const next = { width: 1200, height: 1000 }

  it('start 锚定贴左上', () => {
    const r = clampOutpaintCanvas(base, next, { x: 'start', y: 'start' })
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })

  it('end 锚定贴右下', () => {
    const r = clampOutpaintCanvas(base, next, { x: 'end', y: 'end' })
    expect(r.x).toBe(400) // 1200 - 800
    expect(r.y).toBe(400) // 1000 - 600
  })

  it('center 锚定居中', () => {
    const r = clampOutpaintCanvas(base, next, { x: 'center', y: 'center' })
    expect(r.x).toBe(200) // (1200 - 800) / 2
    expect(r.y).toBe(200) // (1000 - 600) / 2
  })

  it('混合锚定 x=end y=center', () => {
    const r = clampOutpaintCanvas(base, next, { x: 'end', y: 'center' })
    expect(r.x).toBe(400)
    expect(r.y).toBe(200)
  })
})

describe('clampOutpaintCanvas 300×200 切 7×7 场景', () => {
  it('原图 300×200 在 7 列网格下单格宽 42px，且原图完整落在扩后画布内', () => {
    const base = { width: 300, height: 200 }
    // 7 列网格铺在 300px 宽原图上：floor(300/7) = 42px 单格
    expect(Math.floor(base.width / 7)).toBe(42)
    // 合法居中扩图后，原图仍完整包含在新画布内（不裁剪）
    const r = clampOutpaintCanvas(
      base,
      { width: 600, height: 400 },
      { x: 'center', y: 'center' },
    )
    expect(r.width).toBe(600)
    expect(r.height).toBe(400)
    expect(r.x).toBe(150) // (600-300)/2
    expect(r.y).toBe(100) // (400-200)/2
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + base.width).toBeLessThanOrEqual(r.width)
    expect(r.y + base.height).toBeLessThanOrEqual(r.height)
  })
})

describe('clampOutpaintCanvas 不可行抛错', () => {
  it('极小原图（50×50）使 256 下限面积超过 9 倍上限时抛错', () => {
    // 50×50 面积 2500，9 倍上限 22500；256×256 下限面积 65536 > 22500 → 无解
    expect(() =>
      clampOutpaintCanvas(
        { width: 50, height: 50 },
        { width: 50, height: 50 },
        { x: 'start', y: 'start' },
      ),
    ).toThrow()
  })
})

describe('formatAspectLabel（读数「宽×高·比例」）', () => {
  it('常见比例按 2% 容差命中', () => {
    expect(formatAspectLabel(1024, 1024)).toBe('1:1')
    expect(formatAspectLabel(1024, 768)).toBe('4:3')
    expect(formatAspectLabel(1920, 1080)).toBe('16:9')
    expect(formatAspectLabel(1080, 1920)).toBe('9:16')
    expect(formatAspectLabel(2865, 2126)).toBe('4:3') // 1.348 ≈ 4:3（差 1.1%）
  })

  it('非常见比例退化为最简整数比', () => {
    expect(formatAspectLabel(1000, 600)).toBe('5:3')
  })

  it('非法尺寸返回占位符', () => {
    expect(formatAspectLabel(0, 100)).toBe('—')
    expect(formatAspectLabel(100, 0)).toBe('—')
  })
})
