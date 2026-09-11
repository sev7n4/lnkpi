import type {
  EditIntent,
  GenerationScene,
  GuideCapabilities,
  ParamContract,
} from './types'

export interface GuideResolveInput {
  guide: GenerationScene | EditIntent
  capabilities: GuideCapabilities
  userOverrides?: Partial<ParamContract>
  refImageCount?: number
}

export interface GuideResolveResult {
  params: ParamContract
  applied: string[]
  skipped: string[]
  blocked?: { reason: string }
}

export function defaultGuideCapabilities(): GuideCapabilities {
  return {
    transparentBackground: false,
    qualityParam: true,
    maxRefImages: 4,
  }
}

const PARAM_KEYS: (keyof ParamContract)[] = ['size', 'quality', 'background', 'outputFormat']

function isParamSupported(
  key: keyof ParamContract,
  value: ParamContract[keyof ParamContract],
  capabilities: GuideCapabilities,
): boolean {
  if (key === 'quality') return capabilities.qualityParam
  if (key === 'background' && value === 'transparent') return capabilities.transparentBackground
  return true
}

export function resolveGuideRequest(input: GuideResolveInput): GuideResolveResult {
  const { guide, capabilities, userOverrides, refImageCount } = input
  const empty: GuideResolveResult = { params: {}, applied: [], skipped: [] }

  if (guide.capability.requiresTransparentBackground && !capabilities.transparentBackground) {
    return {
      ...empty,
      blocked: { reason: '当前模型不支持透明背景' },
    }
  }

  const minRefs = guide.capability.minRefImages
  if (minRefs != null && (refImageCount ?? 0) < minRefs) {
    const roleHints =
      'refRoles' in guide && Array.isArray(guide.refRoles)
        ? guide.refRoles
            .filter((r) => r.required)
            .map((r) => r.hint)
            .filter(Boolean)
            .join(' + ')
        : ''
    const detail = roleHints ? `：${roleHints}` : ''
    return {
      ...empty,
      blocked: { reason: `需要至少 ${minRefs} 张参考图${detail}` },
    }
  }

  const params: ParamContract = {}
  const applied: string[] = []
  const skipped: string[] = []

  for (const key of PARAM_KEYS) {
    const preferred = guide.preferredParams[key]
    const override = userOverrides?.[key]
    const value = override !== undefined ? override : preferred
    if (value === undefined) continue

    if (!isParamSupported(key, value, capabilities)) {
      skipped.push(key)
      continue
    }

    ;(params as Record<string, unknown>)[key] = value
    applied.push(key)
  }

  return { params, applied, skipped }
}
