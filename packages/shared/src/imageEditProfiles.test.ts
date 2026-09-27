import { describe, expect, it } from 'vitest'
import {
  IMAGE_EDIT_GATEWAY_MODEL_ID,
  IMAGE_EDIT_MODEL_KEYS,
  IMAGE_EDIT_MODEL_PRICING,
  IMAGE2_EDIT_SIZES,
  P1_IMAGE_EDIT_MODEL_KEY,
  imageEditModelLabel,
  resolveImageEditModelKey,
  resolveImageEditProfile,
} from './imageEditProfiles'

describe('resolveImageEditProfile', () => {
  it('returns Image2 apimart_mask profile for P1 key', () => {
    const p = resolveImageEditProfile(P1_IMAGE_EDIT_MODEL_KEY)
    expect(p.editWire).toBe('apimart_mask')
    expect(p.gatewayModelId).toBe(IMAGE_EDIT_GATEWAY_MODEL_ID)
    expect(p.responseMode).toBe('async_task')
    expect(p.size).toBe('auto')
    expect(p.pollIntervalMs).toBe(8000)
    expect(p.maxPollMs).toBe(360000)
    expect(p.capabilities).toEqual({
      transparentBackground: false,
      qualityParam: true,
      maxRefImages: 4,
    })
  })
})

describe('imageEditProfiles 白名单与定价', () => {
  it('白名单本期仅 image2，定价 10 分', () => {
    expect(IMAGE_EDIT_MODEL_KEYS).toEqual(['image2'])
    expect(IMAGE_EDIT_MODEL_PRICING['image2']).toBe(10)
  })
  it('缺省与 image2 都解析到 gpt-image-2-official', () => {
    expect(resolveImageEditProfile().gatewayModelId).toBe('gpt-image-2-official')
    expect(resolveImageEditProfile('image2').gatewayModelId).toBe('gpt-image-2-official')
  })
  it('未知/大小写变体 key 抛错（服务端据此 400）', () => {
    expect(() => resolveImageEditProfile('GPT-Image-2')).toThrow()
    expect(() => resolveImageEditProfile('seedream-5.0-pro')).toThrow()
  })
  it('size 档位表本期仅 auto', () => {
    expect(IMAGE2_EDIT_SIZES).toEqual(['auto'])
  })
})

describe('resolveImageEditModelKey（dock 选中的模型 → 编辑链路用模型）', () => {
  it('BYOK 渠道原样透传（用户插了自己的 key 不该烧平台积分）', () => {
    expect(resolveImageEditModelKey('byok-chan::gpt-image-1')).toBe('byok-chan::gpt-image-1')
  })
  it('平台渠道回落 image2', () => {
    expect(resolveImageEditModelKey('platform::agnes-image-2.1-flash')).toBe('image2')
  })
  it('空值 / 无法解析的裸 key 回落 image2', () => {
    expect(resolveImageEditModelKey('')).toBe('image2')
    expect(resolveImageEditModelKey(null)).toBe('image2')
    expect(resolveImageEditModelKey(undefined)).toBe('image2')
    expect(resolveImageEditModelKey('gpt-image-1')).toBe('image2')
  })
})

describe('imageEditModelLabel', () => {
  it('平台默认显示网关 id', () => {
    expect(imageEditModelLabel('image2')).toBe(IMAGE_EDIT_GATEWAY_MODEL_ID)
  })
  it('BYOK 渠道只显示 modelName（不带 channelId:: 前缀）', () => {
    expect(imageEditModelLabel('byok-chan::gpt-image-1')).toBe('gpt-image-1')
  })
})
