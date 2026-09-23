import { describe, expect, it } from 'vitest'
import { ellipseFromDrag } from './maskEllipse'

describe('ellipseFromDrag', () => {
  it('中心为两点中点，半径为两点差绝对值的一半', () => {
    expect(ellipseFromDrag({ start: { x: 0, y: 0 }, end: { x: 10, y: 6 }, shiftKey: false }))
      .toEqual({ cx: 5, cy: 3, rx: 5, ry: 3 })
  })

  it('反向拖拽归一化为正值', () => {
    expect(ellipseFromDrag({ start: { x: 10, y: 6 }, end: { x: 0, y: 0 }, shiftKey: false }))
      .toEqual({ cx: 5, cy: 3, rx: 5, ry: 3 })
  })

  it('起点等于终点时半径为 0（与矩形同款 no-op 语义）', () => {
    expect(ellipseFromDrag({ start: { x: 4, y: 4 }, end: { x: 4, y: 4 }, shiftKey: false }))
      .toEqual({ cx: 4, cy: 4, rx: 0, ry: 0 })
  })

  it('shiftKey 锁正圆：rx = ry = max(rx, ry)', () => {
    expect(ellipseFromDrag({ start: { x: 0, y: 0 }, end: { x: 10, y: 4 }, shiftKey: true }))
      .toEqual({ cx: 5, cy: 2, rx: 5, ry: 5 })
  })
})
