import { describe, expect, it } from 'vitest'
import { centerExpandPosition, containFitSize } from './centerExpand'

describe('centerExpandPosition', () => {
  it('放大时：中心不变，position 左上移（M2 T9 中心锚定）', () => {
    expect(
      centerExpandPosition({ x: 100, y: 100 }, { width: 200, height: 200 }, { width: 400, height: 400 }),
    ).toEqual({ x: 0, y: 0 })
  })

  it('缩小时：中心不变，position 右下移', () => {
    expect(
      centerExpandPosition({ x: 0, y: 0 }, { width: 400, height: 400 }, { width: 200, height: 200 }),
    ).toEqual({ x: 100, y: 100 })
  })

  it('尺寸不变时 position 不动', () => {
    expect(
      centerExpandPosition({ x: 42, y: 77 }, { width: 280, height: 280 }, { width: 280, height: 280 }),
    ).toEqual({ x: 42, y: 77 })
  })

  it('奇数差值取整（round）', () => {
    expect(
      centerExpandPosition({ x: 10, y: 10 }, { width: 201, height: 201 }, { width: 100, height: 100 }),
    ).toEqual({ x: 61, y: 61 })
  })
})

describe('containFitSize', () => {
  it('目标更宽时贴宽度，高度等比缩小', () => {
    expect(containFitSize({ width: 280, height: 280 }, { width: 560, height: 280 })).toEqual({
      width: 280,
      height: 140,
    })
  })

  it('目标更高时贴高度，宽度等比缩小', () => {
    expect(containFitSize({ width: 280, height: 280 }, { width: 280, height: 560 })).toEqual({
      width: 140,
      height: 280,
    })
  })

  it('比例一致时取整回原框', () => {
    expect(containFitSize({ width: 280, height: 280 }, { width: 1120, height: 1120 })).toEqual({
      width: 280,
      height: 280,
    })
  })

  it('非正方形框也按 contain 等比', () => {
    expect(containFitSize({ width: 300, height: 200 }, { width: 600, height: 400 })).toEqual({
      width: 300,
      height: 200,
    })
  })
})
