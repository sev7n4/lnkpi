import { describe, expect, it } from 'vitest'
import { OUTPAINT_FILL, computeOutpaintLayers } from './outpaintComposite'
import { clampOutpaintCanvas } from './outpaintGeometry'

describe('OUTPAINT_FILL 常量', () => {
  it('默认值为 transparent（透明 PNG 期望态）', () => {
    expect(OUTPAINT_FILL).toBe('transparent')
  })
})

describe('computeOutpaintLayers 贴位与蒙版参数（start 锚定）', () => {
  // 原图 800×600，start 锚定合法扩到 1000×800
  const base = { width: 800, height: 600 }
  const rect = clampOutpaintCanvas(base, { width: 1000, height: 800 }, { x: 'start', y: 'start' })
  // rect = { x: 0, y: 0, width: 1000, height: 800 }

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
  const rect = clampOutpaintCanvas(base, { width: 1000, height: 800 }, { x: 'start', y: 'start' })

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
  // 原图 800×600，居中合法扩到 1200×1000 → rect = { x:200, y:200, w:1200, h:1000 }
  const base = { width: 800, height: 600 }
  const rect = clampOutpaintCanvas(base, { width: 1200, height: 1000 }, { x: 'center', y: 'center' })

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
