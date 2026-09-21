import { describe, expect, it } from 'vitest'
import { shouldHideCanvasChrome } from './canvasChromeVisibility'

describe('shouldHideCanvasChrome', () => {
  it('普通画布：chrome 全部显示', () => {
    expect(shouldHideCanvasChrome({ refineOpen: false, gridSliceOpen: false })).toBe(false)
  })

  it('精修工作台打开：画布级 chrome 全部让位', () => {
    expect(shouldHideCanvasChrome({ refineOpen: true, gridSliceOpen: false })).toBe(true)
  })

  it('宫格切分工作台打开：同样让位', () => {
    expect(shouldHideCanvasChrome({ refineOpen: false, gridSliceOpen: true })).toBe(true)
  })

  it('两个都开（不应发生）也仍然让位', () => {
    expect(shouldHideCanvasChrome({ refineOpen: true, gridSliceOpen: true })).toBe(true)
  })
})
