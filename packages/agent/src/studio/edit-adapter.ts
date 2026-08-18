import {
  P1_IMAGE_EDIT_MODEL_KEY,
  resolveImageEditProfile,
  type ImageEditWire,
} from '@lnkpi/shared'

export const IMAGE_EDIT_PROMPT_PREFIX =
  '仅修改蒙版区域。蒙版以外的所有像素必须与原图完全一致。\n用户指令：'

export function buildEditPrompt(userPrompt: string): string {
  return IMAGE_EDIT_PROMPT_PREFIX + userPrompt.trim()
}

export function buildImageEditRequest(input: {
  userPrompt: string
  imageUrl: string
  maskUrl: string
  modelKey?: string
}): {
  prompt: string
  body: Record<string, unknown>
  meta: {
    editMode: 'inpaint'
    modelKey: string
    gatewayModelId: string
    editWire: ImageEditWire
    size: 'auto'
  }
} {
  const profile = resolveImageEditProfile(input.modelKey)
  const prompt = buildEditPrompt(input.userPrompt)
  return {
    prompt,
    body: {
      model: profile.gatewayModelId,
      prompt,
      image_urls: [input.imageUrl],
      mask_url: input.maskUrl,
      size: profile.size,
    },
    meta: {
      editMode: 'inpaint',
      modelKey: input.modelKey ?? P1_IMAGE_EDIT_MODEL_KEY,
      gatewayModelId: profile.gatewayModelId,
      editWire: profile.editWire,
      size: profile.size,
    },
  }
}
