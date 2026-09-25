import { describe, expect, it } from 'vitest'
import { ANNOTATE_TOOLS, drawAnnotates, nextAnnotateId, type AnnotateShape } from './annotateModel'

describe('annotateModel', () => {
  it('工具全集：画笔/框选/文字/直线/箭头/马赛克/水印/签名（竞品 + 用户扩展）', () => {
    expect(ANNOTATE_TOOLS.map((t) => t.id)).toEqual([
      'brush', 'rect', 'text', 'line', 'arrow', 'mosaic', 'watermark', 'sign',
    ])
  })

  it('id 递增不重复', () => {
    expect(nextAnnotateId()).not.toBe(nextAnnotateId())
  })

  it('drawAnnotates：jsdom 无 2d context 时不抛错（浏览器环境才真正绘制）', () => {
    const canvas = document.createElement('canvas')
    const ops: AnnotateShape[] = [
      { kind: 'stroke', stroke: { points: [{ x: 1, y: 1 }], size: 4, color: '#ff0000' } },
      { kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 }, size: 3, color: '#00ff00' },
      { kind: 'text', x: 5, y: 5, text: '标注', size: 14, color: '#ffffff' },
      { kind: 'line', x0: 0, y0: 0, x1: 9, y1: 9, size: 3, color: '#ffffff', arrow: true },
      { kind: 'mosaic', rect: { x: 0, y: 0, width: 8, height: 8 }, block: 8 },
      { kind: 'watermark', x: 10, y: 10, text: '水印', size: 16, color: '#ffffff', opacity: 0.5, tiled: true },
    ]
    const img = document.createElement('img')
    expect(() => drawAnnotates(canvas, ops, img, 100, 100, 200, 200)).not.toThrow()
  })
})
