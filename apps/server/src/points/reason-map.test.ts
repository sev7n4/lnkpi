import { describe, expect, it } from 'vitest'
import { mapReasonToPointFields } from './reason-map'

describe('mapReasonToPointFields', () => {
  it('maps 图像生成 to consume/image/success', () => {
    expect(mapReasonToPointFields('图像生成', -10)).toEqual({
      kind: 'consume',
      category: 'image',
      status: 'success',
    })
  })

  it('maps 文本生成-失败退款', () => {
    expect(mapReasonToPointFields('文本生成-失败退款', 5)).toEqual({
      kind: 'refund',
      category: 'text',
      status: 'failed_refund',
    })
  })

  it('maps 图像生成-取消退款', () => {
    expect(mapReasonToPointFields('图像生成-取消退款', 10)).toEqual({
      kind: 'refund',
      category: 'image',
      status: 'cancelled_refund',
    })
  })

  it('maps BYOK 退款', () => {
    expect(mapReasonToPointFields('视频生成-BYOK失败退款', 30)).toEqual({
      kind: 'refund',
      category: 'video',
      status: 'byok_refund',
    })
  })

  it('maps 预检拒绝退款', () => {
    expect(mapReasonToPointFields('视频生成-预检拒绝退款', 30)).toEqual({
      kind: 'refund',
      category: 'video',
      status: 'failed_refund',
    })
  })

  it('maps 每日签到 to grant/other', () => {
    expect(mapReasonToPointFields('每日签到', 100)).toEqual({
      kind: 'grant',
      category: 'other',
      status: null,
    })
  })

  it('maps 升级 专业版 to grant/other', () => {
    expect(mapReasonToPointFields('升级 专业版', 5000)).toEqual({
      kind: 'grant',
      category: 'other',
      status: null,
    })
  })

  it('unknown negative amount → consume/other/success', () => {
    expect(mapReasonToPointFields('神秘扣费', -3)).toEqual({
      kind: 'consume',
      category: 'other',
      status: 'success',
    })
  })

  it('unknown positive amount → grant/other/null', () => {
    expect(mapReasonToPointFields('神秘入账', 3)).toEqual({
      kind: 'grant',
      category: 'other',
      status: null,
    })
  })

  it('maps 平台回退生成 to consume/other', () => {
    expect(mapReasonToPointFields('平台回退生成', -10)).toEqual({
      kind: 'consume',
      category: 'other',
      status: 'success',
    })
  })

  it('maps 导演台批量生成 prefix to consume/other', () => {
    expect(mapReasonToPointFields('导演台批量生成 ×3', -40)).toEqual({
      kind: 'consume',
      category: 'other',
      status: 'success',
    })
  })
})
