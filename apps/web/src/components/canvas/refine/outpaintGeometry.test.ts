import { describe, expect, it } from 'vitest'
import {
  OUTPAINT_MIN_EDGE,
  OUTPAINT_MAX_AREA_RATIO,
  HANDLE_DIRS,
  fitRectToAspect,
  floorOutpaintRect,
  formatAspectLabel,
  hasOutpaintExtension,
  initialOutpaintRect,
  outpaintExtensionAmounts,
  resizeOutpaintAbsolute,
  resizeOutpaintRect,
  type HandleDir,
  type OutpaintRect,
  type Size,
} from './outpaintGeometry'

describe('outpaintGeometry 常量', () => {
  it('单边最小 256px、面积上限 9 倍', () => {
    expect(OUTPAINT_MIN_EDGE).toBe(256)
    expect(OUTPAINT_MAX_AREA_RATIO).toBe(9)
  })

  it('8 个手柄方向齐全', () => {
    expect(HANDLE_DIRS).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
  })
})

const BASE: Size = { width: 400, height: 300 }

/** 以初始画布为起点拖一次。 */
const dragOnce = (dir: HandleDir, dx: number, dy: number, base: Size = BASE): OutpaintRect =>
  resizeOutpaintRect(base, initialOutpaintRect(base), { dx, dy }, dir)

describe('initialOutpaintRect / floorOutpaintRect', () => {
  it('初始画布等于原图本身（无扩出区）', () => {
    expect(initialOutpaintRect(BASE)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('落像素向下取整，且仍完整包含原图', () => {
    const r = floorOutpaintRect({ x: 10.7, y: 20.2, width: 500.9, height: 400.4 })
    expect(r).toEqual({ x: 10, y: 20, width: 500, height: 400 })
    expect(r.x + BASE.width).toBeLessThanOrEqual(r.width)
  })
})

describe('resizeOutpaintRect 单边拖拽（只动该边，对边固定）', () => {
  it('e 向右扩 100：原图贴左上不动', () => {
    expect(dragOnce('e', 100, 0)).toEqual({ x: 0, y: 0, width: 500, height: 300 })
  })

  it('w 向左扩 100：画布向左长，原图右移 100', () => {
    expect(dragOnce('w', -100, 0)).toEqual({ x: 100, y: 0, width: 500, height: 300 })
  })

  it('n 向上扩 100：画布向上长，原图下沉 100', () => {
    expect(dragOnce('n', 0, -100)).toEqual({ x: 0, y: 100, width: 400, height: 400 })
  })

  it('s 向下扩 100：原图保持贴顶', () => {
    expect(dragOnce('s', 0, 100)).toEqual({ x: 0, y: 0, width: 400, height: 400 })
  })

  it('角 se 同时扩右与下', () => {
    expect(dragOnce('se', 100, 50)).toEqual({ x: 0, y: 0, width: 500, height: 350 })
  })

  it('角 nw 同时扩左与上', () => {
    expect(dragOnce('nw', -100, -50)).toEqual({ x: 100, y: 50, width: 500, height: 350 })
  })

  it('边手柄不影响另一轴', () => {
    // e 手柄只有横向位移，纵向位移被忽略
    expect(dragOnce('e', 100, 80)).toEqual({ x: 0, y: 0, width: 500, height: 300 })
    // n 手柄只有纵向位移
    expect(dragOnce('n', 80, -100)).toEqual({ x: 0, y: 100, width: 400, height: 400 })
  })
})

describe('resizeOutpaintRect 多边累积（2026-09-22 缺陷核心回归）', () => {
  it('先向上扩 100、再向下扩 100：上下两侧扩出区同时保留', () => {
    const up = dragOnce('n', 0, -100)
    expect(up).toEqual({ x: 0, y: 100, width: 400, height: 400 })
    const both = resizeOutpaintRect(BASE, up, { dx: 0, dy: 100 }, 's')
    // 旧实现（尺寸 + anchor）在这里会丢掉上方扩出区，得到 { y: 0, height: 500 }
    expect(both).toEqual({ x: 0, y: 100, width: 400, height: 500 })
  })

  it('先向右扩 100、再向左扩 100：左右两侧扩出区同时保留', () => {
    const right = dragOnce('e', 100, 0)
    const both = resizeOutpaintRect(BASE, right, { dx: -100, dy: 0 }, 'w')
    expect(both).toEqual({ x: 100, y: 0, width: 600, height: 300 })
  })

  it('对角 nw → se：两个对角扩出区同时保留', () => {
    const nw = dragOnce('nw', -100, -100)
    const both = resizeOutpaintRect(BASE, nw, { dx: 100, dy: 100 }, 'se')
    expect(both).toEqual({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('四边依次各扩 100 → 原图居中，画布 600×500', () => {
    let r = initialOutpaintRect(BASE)
    r = resizeOutpaintRect(BASE, r, { dx: 100, dy: 0 }, 'e')
    r = resizeOutpaintRect(BASE, r, { dx: -100, dy: 0 }, 'w')
    r = resizeOutpaintRect(BASE, r, { dx: 0, dy: 100 }, 's')
    r = resizeOutpaintRect(BASE, r, { dx: 0, dy: -100 }, 'n')
    expect(r).toEqual({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('同一侧连续两次拖拽按增量累积（第二帧以当前 rect 为基准，与单次等效）', () => {
    const step = dragOnce('e', 60, 0)
    const total = resizeOutpaintRect(BASE, step, { dx: 40, dy: 0 }, 'e')
    expect(total).toEqual({ x: 0, y: 0, width: 500, height: 300 })
  })

  it('增量式拖拽保留小数不产生累计漂移（落像素后仍为整数目标）', () => {
    let r = initialOutpaintRect(BASE)
    for (let i = 0; i < 30; i += 1) {
      r = resizeOutpaintRect(BASE, r, { dx: 0.5, dy: 0 }, 'e')
    }
    // 30 帧 × 0.5px = 15px；若每帧取整（旧实现）会把 0.5px 全部丢掉 → 仍是 400
    expect(floorOutpaintRect(r).width).toBe(415)
  })
})

describe('resizeOutpaintRect 向内拖拽不越过原图（扩图不裁剪）', () => {
  it('w 向右内拖 50：左扩出量已为 0，停在原图左边界', () => {
    expect(dragOnce('w', 50, 0)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('先右扩 100 再左扩出量 0 的内拖：右扩出区不受影响', () => {
    const right = dragOnce('e', 100, 0)
    const r = resizeOutpaintRect(BASE, right, { dx: 50, dy: 0 }, 'w')
    expect(r).toEqual({ x: 0, y: 0, width: 500, height: 300 })
  })

  it('对角内拖只收缩已有扩出量，不改变另一轴', () => {
    const nw = dragOnce('nw', -100, -100) // { x:100, y:100, 500×400 }
    const r = resizeOutpaintRect(BASE, nw, { dx: 40, dy: 60 }, 'nw')
    expect(r).toEqual({ x: 60, y: 40, width: 460, height: 340 })
  })

  it('任意拖拽结果都完整包含原图（四向扩展量恒 ≥ 0）', () => {
    const dirs: HandleDir[] = [...HANDLE_DIRS]
    for (const dir of dirs) {
      for (const d of [-5000, -300, 0, 300, 5000]) {
        const r = resizeOutpaintRect(BASE, initialOutpaintRect(BASE), { dx: d, dy: -d }, dir)
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + BASE.width).toBeLessThanOrEqual(r.width + 1e-9)
        expect(r.y + BASE.height).toBeLessThanOrEqual(r.height + 1e-9)
      }
    }
  })
})

describe('resizeOutpaintRect 约束', () => {
  it('单边下限 256：小图短边拖动后补到 256（只补移动边）', () => {
    const small: Size = { width: 300, height: 200 }
    const r = resizeOutpaintRect(small, initialOutpaintRect(small), { dx: 0, dy: 10 }, 's')
    expect(r.height).toBe(256)
    expect(r.y).toBe(0) // 补在下边，原图贴顶
    expect(r.width).toBe(300)
  })

  it('面积上限 9 倍：截断拖拽幅度，而不是回头缩小已扩出的边', () => {
    const right = dragOnce('e', 200, 0) // 600×300
    expect(right.width).toBe(600)
    const huge = resizeOutpaintRect(BASE, right, { dx: 0, dy: 100_000 }, 's')
    // 右扩出区（200px）保持不变，高度停在面积预算边界 1_080_000 / 600 = 1800
    expect(huge.width).toBe(600)
    expect(huge.x).toBe(0)
    expect(huge.height).toBeCloseTo(1800, 0)
    expect(huge.width * huge.height).toBeLessThanOrEqual(
      OUTPAINT_MAX_AREA_RATIO * BASE.width * BASE.height,
    )
  })

  it('面积预算用尽后反向拖拽可立即回退（无粘滞）', () => {
    const right = dragOnce('e', 200, 0)
    const huge = resizeOutpaintRect(BASE, right, { dx: 0, dy: 100_000 }, 's')
    const back = resizeOutpaintRect(BASE, huge, { dx: 0, dy: -100 }, 's')
    expect(back.height).toBeCloseTo(1700, 0)
  })

  it('面积上限内正常扩展不被截断', () => {
    const r = dragOnce('se', 100, 100) // 500×400 = 200_000 ≤ 1_080_000
    expect(r).toEqual({ x: 0, y: 0, width: 500, height: 400 })
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

describe('hasOutpaintExtension（提交守卫：零扩展不得生成）', () => {
  it('rect 等于原图 → 未扩出', () => {
    expect(hasOutpaintExtension(BASE, initialOutpaintRect(BASE))).toBe(false)
  })

  it('任一向扩展量 > 0 → 已扩出（含仅右/下扩 x=y=0 的情况）', () => {
    expect(hasOutpaintExtension(BASE, { x: 10, y: 0, width: 400, height: 300 })).toBe(true)
    expect(hasOutpaintExtension(BASE, { x: 0, y: 10, width: 400, height: 300 })).toBe(true)
    expect(hasOutpaintExtension(BASE, { x: 0, y: 0, width: 500, height: 300 })).toBe(true)
    expect(hasOutpaintExtension(BASE, { x: 0, y: 0, width: 400, height: 400 })).toBe(true)
  })

  it('原图尺寸未知时一律视为未扩出（无法判定就不放行）', () => {
    expect(hasOutpaintExtension({ width: 0, height: 0 }, { x: 0, y: 0, width: 400, height: 300 })).toBe(false)
  })
})

describe('fitRectToAspect', () => {
  const BASE = { width: 400, height: 300 }

  it('1:1 → 以宽度为准的正方形（高度从 300 抬到 400）', () => {
    expect(fitRectToAspect(BASE, { w: 1, h: 1 })).toEqual({ x: 0, y: 50, width: 400, height: 400 })
  })

  it('16:9 → 以宽度为准（高度 225 < 300，故改用高度为准）', () => {
    const r = fitRectToAspect(BASE, { w: 16, h: 9 })
    expect(r.width).toBeCloseTo(533.333, 3)
    expect(r.height).toBeCloseTo(300, 3)
    expect(r.x).toBeCloseTo(66.667, 3)
    expect(r.y).toBeCloseTo(0, 3)
  })

  it('比例精确：width / height 恒等于目标比例', () => {
    for (const ratio of [{ w: 1, h: 1 }, { w: 4, h: 3 }, { w: 3, h: 4 }, { w: 16, h: 9 }, { w: 9, h: 16 }]) {
      const r = fitRectToAspect({ width: 512, height: 768 }, ratio)
      expect(r.width / r.height).toBeCloseTo(ratio.w / ratio.h, 6)
    }
  })

  it('恒包含原图且四向扩展量 ≥ 0', () => {
    const r = fitRectToAspect(BASE, { w: 9, h: 16 })
    expect(r.width).toBeGreaterThanOrEqual(BASE.width)
    expect(r.height).toBeGreaterThanOrEqual(BASE.height)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    const amounts = outpaintExtensionAmounts(BASE, r)
    for (const v of Object.values(amounts)) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('原图比例基准（尺寸小于下限）：画布至少抬到 256', () => {
    const r = fitRectToAspect({ width: 100, height: 100 }, { w: 1, h: 1 })
    expect(r).toEqual({ x: 0, y: 0, width: 256, height: 256 })
  })

  it('极端宽高比（4000×100）不得产出 NaN 或负偏移', () => {
    const r = fitRectToAspect({ width: 4000, height: 100 }, { w: 9, h: 16 })
    expect(Number.isFinite(r.width)).toBe(true)
    expect(Number.isFinite(r.height)).toBe(true)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.width).toBeGreaterThanOrEqual(4000)
    expect(r.height).toBeGreaterThanOrEqual(100)
  })

  it('ratio 为 null / 非法 / 原图尺寸非法 → 等价 initialOutpaintRect', () => {
    expect(fitRectToAspect(BASE, null)).toEqual(initialOutpaintRect(BASE))
    expect(fitRectToAspect(BASE, { w: 0, h: 0 })).toEqual(initialOutpaintRect(BASE))
    expect(fitRectToAspect({ width: 0, height: 0 }, { w: 1, h: 1 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('resizeOutpaintAbsolute', () => {
  const BASE = { width: 400, height: 300 }

  it('等比放大：扩展量在两轴对称均分', () => {
    expect(resizeOutpaintAbsolute(BASE, 600, 500)).toEqual({ x: 100, y: 100, width: 600, height: 500 })
  })

  it('奇数像素差：多出的 1px 给右侧 / 下方', () => {
    expect(resizeOutpaintAbsolute(BASE, 501, 300)).toEqual({ x: 50, y: 0, width: 501, height: 300 })
    expect(resizeOutpaintAbsolute(BASE, 400, 301)).toEqual({ x: 0, y: 0, width: 400, height: 301 })
  })

  it('小于原图的输入被抬到原图尺寸（扩图不裁剪）', () => {
    expect(resizeOutpaintAbsolute(BASE, 200, 200)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('零 / 负数 / 超大输入被 clamp，不产生负扩展量', () => {
    expect(resizeOutpaintAbsolute(BASE, 0, -5)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(resizeOutpaintAbsolute(BASE, -100, -100)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    const huge = resizeOutpaintAbsolute(BASE, 1e9, 1e9)
    expect(huge.width).toBeLessThanOrEqual(1e9)
    expect(huge.width * huge.height).toBeLessThanOrEqual(9 * 400 * 300)
    expect(huge.x).toBeGreaterThanOrEqual(0)
    expect(huge.y).toBeGreaterThanOrEqual(0)
  })

  it('小于 256 下限的原图：画布该轴抬到 256', () => {
    expect(resizeOutpaintAbsolute({ width: 100, height: 100 }, 100, 100)).toEqual({
      x: 0, y: 0, width: 256, height: 256,
    })
  })

  it('面积超上限（9 倍）时等比收缩并保持包含原图', () => {
    const r = resizeOutpaintAbsolute(BASE, 4000, 4000)
    expect(r.width * r.height).toBeLessThanOrEqual(9 * 400 * 300)
    expect(r.width).toBeGreaterThanOrEqual(400)
    expect(r.height).toBeGreaterThanOrEqual(300)
  })

  it('非法输入（NaN / Infinity）→ 等价 initialOutpaintRect', () => {
    expect(resizeOutpaintAbsolute(BASE, Number.NaN, 500)).toEqual(initialOutpaintRect(BASE))
    expect(resizeOutpaintAbsolute(BASE, 500, Number.POSITIVE_INFINITY)).toEqual(initialOutpaintRect(BASE))
  })
})

describe('outpaintExtensionAmounts', () => {
  const BASE = { width: 400, height: 300 }

  it('四向各自独立读数', () => {
    expect(outpaintExtensionAmounts(BASE, { x: 30, y: 10, width: 500, height: 350 })).toEqual({
      west: 30, east: 70, north: 10, south: 40,
    })
  })

  it('未扩展时为全 0', () => {
    expect(outpaintExtensionAmounts(BASE, initialOutpaintRect(BASE))).toEqual({
      west: 0, east: 0, north: 0, south: 0,
    })
  })

  it('负数偏移与小于原图的矩形被夹到 0（不出现负扩展量）', () => {
    expect(outpaintExtensionAmounts(BASE, { x: -20, y: -5, width: 300, height: 200 })).toEqual({
      west: 0, east: 0, north: 0, south: 0,
    })
  })
})
