import { describe, expect, it } from 'vitest'
import { OUTPAINT_FILL, computeOutpaintLayers } from './outpaintComposite'

describe('OUTPAINT_FILL 常量', () => {
  it('默认值为 transparent（透明 PNG 期望态）', () => {
    expect(OUTPAINT_FILL).toBe('transparent')
  })
})

describe('computeOutpaintLayers 贴位与蒙版参数（start 锚定）', () => {
  // 原图 800×600，仅向右下扩到 1000×800
  const base = { width: 800, height: 600 }
  const rect = { x: 0, y: 0, width: 1000, height: 800 }

  it('baseSpec：新画布尺寸 + srcX=-rect.x / srcY=-rect.y', () => {
    const { baseSpec } = computeOutpaintLayers(base, rect)
    expect(baseSpec.width).toBe(1000)
    expect(baseSpec.height).toBe(800)
    expect(baseSpec.srcX).toBe(-rect.x)
    expect(baseSpec.srcY).toBe(-rect.y)
  })

  it('maskSpec：同尺寸 + maskRect = 原图在新画布中的矩形', () => {
    const { maskSpec } = computeOutpaintLayers(base, rect)
    expect(maskSpec.width).toBe(1000)
    expect(maskSpec.height).toBe(800)
    // 同尺寸契约：maskSpec 与 baseSpec（rect）尺寸一致
    expect(maskSpec.width).toBe(rect.width)
    expect(maskSpec.height).toBe(rect.height)
    // 原图矩形在新画布中的位置/尺寸（即黑/原图区；其补集为蒙版白区=扩出区）
    expect(maskSpec.maskRect).toEqual({
      x: rect.x,
      y: rect.y,
      width: base.width,
      height: base.height,
    })
  })

  it('底图与蒙版同尺寸（服务端 assertSameDimensions 契约）', () => {
    const { baseSpec, maskSpec } = computeOutpaintLayers(base, rect)
    expect(baseSpec.width).toBe(maskSpec.width)
    expect(baseSpec.height).toBe(maskSpec.height)
  })
})

describe('computeOutpaintLayers fill 开关两态', () => {
  const base = { width: 800, height: 600 }
  const rect = { x: 0, y: 0, width: 1000, height: 800 }

  it('默认态：baseSpec.fill = OUTPAINT_FILL = transparent', () => {
    const { baseSpec } = computeOutpaintLayers(base, rect)
    expect(OUTPAINT_FILL).toBe('transparent')
    expect(baseSpec.fill).toBe('transparent')
  })

  it("切换态：显式 'white' 时 baseSpec.fill = 'white'", () => {
    const { baseSpec } = computeOutpaintLayers(base, rect, 'white')
    expect(baseSpec.fill).toBe('white')
  })
})

describe('computeOutpaintLayers 非角落锚定（center，L 形扩出区）', () => {
  // 原图 800×600，居中扩到 1200×1000 → rect = { x:200, y:200, w:1200, h:1000 }
  const base = { width: 800, height: 600 }
  const rect = { x: 200, y: 200, width: 1200, height: 1000 }

  it('srcX=-rect.x，maskRect 对齐原图居中位置', () => {
    const { baseSpec, maskSpec } = computeOutpaintLayers(base, rect)
    expect(baseSpec.srcX).toBe(-rect.x)
    expect(baseSpec.srcY).toBe(-rect.y)
    expect(maskSpec.maskRect).toEqual({ x: rect.x, y: rect.y, width: base.width, height: base.height })
    // 整片扩出区 = maskRect 的补集（四周 L 形白边），单矩形字段即可正确表达
    const outside =
      maskSpec.width * maskSpec.height -
      maskSpec.maskRect.width * maskSpec.maskRect.height
    expect(outside).toBeGreaterThan(0)
  })
})

describe('computeOutpaintLayers 多边非对称扩出（逐边累积模型的新能力）', () => {
  // 原图 800×600；先扩上 50、再扩右 100、再扩左 100 → 四向扩展量 (100, 100, 50, 50)
  // 旧模型（尺寸 + anchor）无法表达这种状态，只能表示「单边/居中」的对称结果。
  const base = { width: 800, height: 600 }
  const rect = { x: 100, y: 50, width: 1000, height: 700 }

  it('原图贴到 (100, 50)，画布 1000×700', () => {
    const { baseSpec, maskSpec } = computeOutpaintLayers(base, rect)
    expect(baseSpec.width).toBe(1000)
    expect(baseSpec.height).toBe(700)
    expect(baseSpec.srcX).toBe(-100)
    expect(baseSpec.srcY).toBe(-50)
    expect(maskSpec.maskRect).toEqual({ x: 100, y: 50, width: 800, height: 600 })
  })

  it('蒙版白区 = 四边扩出区之和（原图区为黑）', () => {
    const { maskSpec } = computeOutpaintLayers(base, rect)
    const generated = maskSpec.width * maskSpec.height - maskSpec.maskRect.width * maskSpec.maskRect.height
    // 左右各 100×600 + 上下各 800×50 + 四个角 100×50
    expect(generated).toBe(2 * 100 * 600 + 2 * 800 * 50 + 4 * 100 * 50)
  })

  it('原图矩形始终完整落在蒙版画布内（不裁剪原图）', () => {
    const { maskSpec } = computeOutpaintLayers(base, rect)
    expect(maskSpec.maskRect.x).toBeGreaterThanOrEqual(0)
    expect(maskSpec.maskRect.y).toBeGreaterThanOrEqual(0)
    expect(maskSpec.maskRect.x + maskSpec.maskRect.width).toBeLessThanOrEqual(maskSpec.width)
    expect(maskSpec.maskRect.y + maskSpec.maskRect.height).toBeLessThanOrEqual(maskSpec.height)
  })
})
