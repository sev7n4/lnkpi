import { describe, expect, it } from 'vitest'
import {
  combineElementEditPrompt,
  combineInpaintPrompt,
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

  it('带替换图的项追加对象替换语义段（2026-09-25「+」上传替换对象）', () => {
    const out = combineElementEditPrompt([
      { name: 'logo', modify: '替换', refUrl: 'https://cdn/x.png' },
      { name: '眼睛', modify: '发光' },
    ])
    expect(out).toContain('把该区域替换为参考图中的对象')
    expect(out).toContain('；眼睛 发光')
    // 无 refUrl 的项不追加
    expect(out.startsWith('logo 替换（把该区域替换为参考图中的对象')).toBe(true)
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

  it('mask 返回其 display bbox 副本', () => {
    const bbox = elementEditShapeBBox({
      kind: 'mask',
      maskUrl: 'https://m.png',
      bbox: { x: 5, y: 6, width: 30, height: 40 },
    })
    expect(bbox).toEqual({ x: 5, y: 6, width: 30, height: 40 })
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

  it('mask 项携带识别提示状态（点提示/扩缩/着色层）', () => {
    const item: ElementEditItem = {
      id: 'm1',
      name: '头发',
      modify: '改蓝色',
      shape: { kind: 'mask', maskUrl: 'https://m.png', bbox: { x: 0, y: 0, width: 10, height: 10 } },
      promptPoints: [{ x: 100, y: 120, label: 1 }, { x: 50, y: 50, label: 0 }],
      dilate: 8,
      tintUrl: 'data:image/png;base64,xxx',
    }
    expect(item.shape.kind).toBe('mask')
    expect(item.promptPoints).toHaveLength(2)
    expect(item.dilate).toBe(8)
  })
})

describe('combineInpaintPrompt（快捷重绘全局 prompt 组合）', () => {
  it('全局描述 + 各芯片「区域名 修改内容」以「；」连接', () => {
    expect(
      combineInpaintPrompt('整体更亮', [
        { name: '区域', modify: '换成蓝色' },
        { name: 'logo', modify: '换成乔丹 logo' },
      ]),
    ).toBe('整体更亮；区域 换成蓝色；logo 换成乔丹 logo')
  })

  it('带替换图的芯片追加对象替换语义；空全局描述只留芯片段', () => {
    expect(
      combineInpaintPrompt('', [{ name: '', modify: '换成新图案', refUrl: 'blob:ref' }]),
    ).toContain('选区 换成新图案（把该区域替换为参考图中的对象')
  })
})
