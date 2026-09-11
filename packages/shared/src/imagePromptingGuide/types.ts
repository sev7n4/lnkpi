export type GuideKind = 'generation_scene' | 'edit_intent'

export interface ParamContract {
  size?: string
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  background?: 'auto' | 'opaque' | 'transparent'
  outputFormat?: 'png' | 'webp' | 'jpeg'
}

export interface CapabilityGate {
  requiresTransparentBackground?: boolean
  minRefImages?: number
  maxRefImages?: number
  requiresSubjectRef?: boolean
}

export interface GuideCapabilities {
  transparentBackground: boolean
  qualityParam: boolean
  maxRefImages: number
}

export interface GenerationScene {
  id: string
  kind: 'generation_scene'
  label: string
  description: string
  fundamentalsRefs: string[]
  promptScaffold: string
  systemOverlay?: string
  fewShot?: { user: string; assistant: string }
  preferredParams: ParamContract
  capability: CapabilityGate
  expandViaPromptMode?: string | null
}

export interface EditIntent {
  id: string
  kind: 'edit_intent'
  label: string
  description: string
  changePreserveTemplate: string
  refRoles: Array<{ role: string; required: boolean; hint: string }>
  preferredParams: ParamContract
  capability: CapabilityGate
}
