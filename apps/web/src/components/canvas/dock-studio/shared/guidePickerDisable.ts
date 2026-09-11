import {
  getGenerationScene,
  type GuideCapabilities,
  type GuideKind,
} from '@lnkpi/shared'
import { editIntentDisabledReason } from '@/components/canvas/refine/guideEditIntentApply'

const TRANSPARENT_BACKGROUND_REASON = '当前模型不支持透明背景'

export function guidePickerDisabledReason(
  mode: GuideKind,
  id: string,
  capabilities: GuideCapabilities,
): string | null {
  if (mode === 'edit_intent') {
    return editIntentDisabledReason(id, capabilities)
  }

  const scene = getGenerationScene(id)
  if (
    scene?.capability.requiresTransparentBackground &&
    !capabilities.transparentBackground
  ) {
    return TRANSPARENT_BACKGROUND_REASON
  }

  return null
}
