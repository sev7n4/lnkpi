import {
  getEditIntent,
  resolveGuideRequest,
  type GuideCapabilities,
} from '@lnkpi/shared'

export function editIntentDisabledReason(
  intentId: string,
  capabilities: GuideCapabilities,
): string | null {
  const intent = getEditIntent(intentId)
  if (!intent) return null
  if (intent.capability.requiresTransparentBackground && !capabilities.transparentBackground) {
    return '当前模型不支持透明背景（transparent），E5 抠图暂不可用'
  }
  return null
}

export function applyGuideEditIntent(input: {
  intentId: string
  capabilities: GuideCapabilities
  refImageCount: number
}):
  | { ok: true; prompt: string; guideEditIntentId: string; label: string }
  | { ok: false; reason: string; disabled: boolean } {
  const intent = getEditIntent(input.intentId)
  if (!intent) {
    return { ok: false, reason: '未知编辑意图', disabled: false }
  }

  const capabilityReason = editIntentDisabledReason(input.intentId, input.capabilities)
  if (capabilityReason) {
    return { ok: false, reason: capabilityReason, disabled: true }
  }

  const resolved = resolveGuideRequest({
    guide: intent,
    capabilities: input.capabilities,
    refImageCount: input.refImageCount,
  })

  if (resolved.blocked) {
    return {
      ok: false,
      reason: resolved.blocked.reason,
      disabled: false,
    }
  }

  return {
    ok: true,
    prompt: intent.changePreserveTemplate,
    guideEditIntentId: intent.id,
    label: intent.label,
  }
}
