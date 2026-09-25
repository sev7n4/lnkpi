import { describe, expect, it } from 'vitest'
import {
  combineElementEditPrompt,
  coverDisplayMapper,
  elementEditShapeBBox,
  pointRectAt,
  type ElementEditItem,
} from './elementEditModel'

describe('combineElementEditPrompt', () => {
  it('按「对象名 修改内容」以「；」连接', () => {
    expect(
      combineElementEditPrompt([
        { name: '眼睛', modify: '换成蓝色发光' },
        { name: '鼻子', modify: '增加闭环' },
      ]),
    ).toBe('眼睛 换成蓝色发光；鼻子 增加闭环')
  })

  it('空修改只留对象名；全空项跳过；重复段去重', () => {
    expect(
      combineElementEditPrompt([
        { name: '耳朵', modify: '' },
        { name: '', modify: '' },
        { name: '耳朵', modify: '' },
      ]),
    ).toBe('耳朵')
  })
})

describe('pointRectAt（焦点点击默认框）', () => {
  it('以点击点为中心', () => {
    const r = pointRectAt({ x: 100, y: 100 }, 400, 400)
    expect(r.width).toBe(r.height)
    expect(r.x + r.width / 2).toBeCloseTo(100)
    expect(r.y + r.height / 2).toBeCloseTo(100)
  })

  it('贴边点击时钳制在卡内', () => {
    const tl = pointRectAt({ x: 0, y: 0 }, 400, 400)
    expect(tl.x).toBe(0)
    expect(tl.y).toBe(0)
    const br = pointRectAt({ x: 400, y: 400 }, 400, 400)
    expect(br.x + br.width).toBeLessThanOrEqual(400)
    expect(br.y + br.height).toBeLessThanOrEqual(400)
  })

  it('边长受 [48, 140] 钳制', () => {
    const small = pointRectAt({ x: 50, y: 50 }, 120, 120)
    expect(small.width).toBeGreaterThanOrEqual(48)
    const big = pointRectAt({ x: 500, y: 500 }, 2000, 2000)
    expect(big.width).toBeLessThanOrEqual(140)
  })
})

describe('elementEditShapeBBox', () => {
  it('矩形返回副本', () => {
    const bbox = elementEditShapeBBox({ kind: 'rect', rect: { x: 10, y: 20, width: 30, height: 40 } })
    expect(bbox).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('笔画取点列包围盒（含半径 pad）', () => {
    const bbox = elementEditShapeBBox({
      kind: 'strokes',
      strokes: [{ size: 4, points: [{ x: 50, y: 60 }, { x: 70, y: 80 }] }],
    })
    expect(bbox.x).toBe(49)
    expect(bbox.y).toBe(59)
    expect(bbox.width).toBeCloseTo(22)
    expect(bbox.height).toBeCloseTo(22)
  })
})

describe('coverDisplayMapper', () => {
  it('display 原点映射到像素负偏移（居中裁切）', () => {
    // 100×100 图放进 200×100 卡：scale=2，offsetY=(100-200)/2=-50 → toPixelY(0)=(0+50)/2=25
    const m = coverDisplayMapper(100, 100, 200, 100)
    expect(m.toPixelX(0)).toBe(0)
    expect(m.toPixelY(0)).toBe(25)
    expect(m.toPixelX(200)).toBe(100)
    expect(m.toPixelY(100)).toBe(75)
  })
})

describe('ElementEditItem 形状契约', () => {
  it('矩形与笔画项可混合存在（类型层校验）', () => {
    const items: ElementEditItem[] = [
      { id: 'a', name: '眼睛', modify: '发光', shape: { kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 } } },
      { id: 'b', name: '鼻子', modify: '闭环', shape: { kind: 'strokes', strokes: [{ size: 6, points: [{ x: 1, y: 1 }] }] } },
    ]
    expect(items).toHaveLength(2)
  })
})
