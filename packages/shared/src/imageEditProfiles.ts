import { decodeChannelModel, modelOptionName } from './providerChannels'
import { defaultGuideCapabilities } from './imagePromptingGuide/resolveGuideRequest'
import type { GuideCapabilities } from './imagePromptingGuide/types'

export const P1_IMAGE_EDIT_MODEL_KEY = 'image2'
export const IMAGE_EDIT_GATEWAY_MODEL_ID = 'gpt-image-2-official'

export type ImageEditWire = 'apimart_mask' | 'openai_sync'

export interface ImageEditModelProfile {
  editWire: ImageEditWire
  gatewayModelId: string
  responseMode: 'async_task' | 'sync_url'
  size: 'auto' | string
  pollIntervalMs: number
  maxPollMs: number
  capabilities?: GuideCapabilities
}

/** 本期经过生产验证的 size 档位，仅 auto；后续扩档在此追加。 */
export const IMAGE2_EDIT_SIZES: readonly string[] = ['auto']

/** image edit 模型白名单（单一真源，服务端与前端共享）。 */
export const IMAGE_EDIT_MODEL_KEYS: readonly string[] = ['image2']

/** 按模型定价表，单位：积分。 */
export const IMAGE_EDIT_MODEL_PRICING: Readonly<Record<string, number>> = {
  image2: 10,
}

const IMAGE2_EDIT_PROFILE: ImageEditModelProfile = {
  editWire: 'apimart_mask',
  gatewayModelId: IMAGE_EDIT_GATEWAY_MODEL_ID,
  responseMode: 'async_task',
  size: 'auto',
  pollIntervalMs: 8000,
  maxPollMs: 360000,
  capabilities: defaultGuideCapabilities(),
}

/**
 * BYOK 渠道编辑档位：走 OpenAI 兼容同步 images API（image+mask 参数）。
 * gatewayModelId 由服务端用渠道解码出的 modelName 填充；蒙版外像素由
 * compositeUnmaskedPixels 本地合成兜底（上游蒙版语义不保证）。
 */
export const BYOK_IMAGE_EDIT_PROFILE: ImageEditModelProfile = {
  editWire: 'openai_sync',
  gatewayModelId: '',
  responseMode: 'sync_url',
  size: 'auto',
  pollIntervalMs: 8000,
  maxPollMs: 360000,
}

/** 未知 key 抛错；服务端据此返回 400。 */
export function resolveImageEditProfile(modelKey?: string): ImageEditModelProfile {
  const key = modelKey ?? P1_IMAGE_EDIT_MODEL_KEY
  if (!IMAGE_EDIT_MODEL_KEYS.includes(key)) {
    throw new Error(`unknown image edit model: ${key}`)
  }
  return IMAGE2_EDIT_PROFILE
}

/**
 * 图像编辑生成用模型：dock 选中的 BYOK 渠道优先——用户插了自己的 key 就不该烧平台积分；
 * 平台渠道 / 未配置 / 不可解析时回落平台白名单 image2。
 * 单一真源：精修与快捷（元素编辑 / 重绘 / 扩图）四条链路共用，勿在组件里重写判定。
 */
export function resolveImageEditModelKey(dockModel?: string | null): string {
  const raw = dockModel?.trim()
  if (!raw) return P1_IMAGE_EDIT_MODEL_KEY
  const decoded = decodeChannelModel(raw)
  if (decoded && decoded.channelId !== 'platform') return raw
  return P1_IMAGE_EDIT_MODEL_KEY
}

/** 编辑模型展示名：平台默认走网关展示 id，BYOK 渠道显示其 modelName（不带 channelId:: 前缀）。 */
export function imageEditModelLabel(modelKey: string): string {
  if (!modelKey || modelKey === P1_IMAGE_EDIT_MODEL_KEY) return IMAGE_EDIT_GATEWAY_MODEL_ID
  return modelOptionName(modelKey)
}
