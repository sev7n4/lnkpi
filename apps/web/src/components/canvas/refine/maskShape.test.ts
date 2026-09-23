// 旧实现事实证据（回归先红 ② 的「红」，origin/main MaskEditor.vue:355-364）：
//   ctx.globalCompositeOperation = 'source-over'
//   ctx.fillStyle = props.color
// 旧形状分支内联硬编码在 MaskEditor，恒为 source-over + 选区色，无视 maskOp（subtract 无法挖洞）。
import { describe, expect, it } from 'vitest'
import { shapeStyleForOp } from './maskShape'

describe('shapeStyleForOp（回归先红 ②：旧实现形状分支恒 source-over，无视 maskOp）', () => {
  it('add：source-over + 选区色', () => {
    expect(shapeStyleForOp('add', '#22d3ee')).toEqual({
      composite: 'source-over',
      fill: '#22d3ee',
      stroke: '#22d3ee',
    })
  })

  it('subtract：destination-out + 不透明黑（挖洞）', () => {
    expect(shapeStyleForOp('subtract', '#22d3ee')).toEqual({
      composite: 'destination-out',
      fill: 'rgba(0,0,0,1)',
      stroke: 'rgba(0,0,0,1)',
    })
  })
})
