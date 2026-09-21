import { defaultGuideCapabilities } from './imagePromptingGuide/resolveGuideRequest'
import type { GuideCapabilities } from './imagePromptingGuide/types'

export const P1_IMAGE_EDIT_MODEL_KEY = 'image2'
export const IMAGE_EDIT_GATEWAY_MODEL_ID = 'gpt-image-2-official'

export type ImageEditWire = 'apimart_mask'

export interface ImageEditModelProfile {
  editWire: ImageEditWire
  gatewayModelId: string
  responseMode: 'async_task'
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

/** 未知 key 抛错；服务端据此返回 400。 */
export function resolveImageEditProfile(modelKey?: string): ImageEditModelProfile {
  const key = modelKey ?? P1_IMAGE_EDIT_MODEL_KEY
  if (!IMAGE_EDIT_MODEL_KEYS.includes(key)) {
    throw new Error(`unknown image edit model: ${key}`)
  }
  return IMAGE2_EDIT_PROFILE
}
