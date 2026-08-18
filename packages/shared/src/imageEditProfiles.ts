export const P1_IMAGE_EDIT_MODEL_KEY = 'image2'
export const IMAGE_EDIT_GATEWAY_MODEL_ID = 'gpt-image-2-official'

export type ImageEditWire = 'apimart_mask'

export interface ImageEditModelProfile {
  editWire: ImageEditWire
  gatewayModelId: string
  responseMode: 'async_task'
  size: 'auto'
  pollIntervalMs: number
  maxPollMs: number
}

const IMAGE2_EDIT_PROFILE: ImageEditModelProfile = {
  editWire: 'apimart_mask',
  gatewayModelId: IMAGE_EDIT_GATEWAY_MODEL_ID,
  responseMode: 'async_task',
  size: 'auto',
  pollIntervalMs: 8000,
  maxPollMs: 360000,
}

/** P1: ignore unknown keys; always return the Image2 edit profile. */
export function resolveImageEditProfile(_modelKey?: string): ImageEditModelProfile {
  return IMAGE2_EDIT_PROFILE
}
