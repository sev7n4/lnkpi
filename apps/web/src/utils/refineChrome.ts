export type RefineChromeMode = 'docked' | 'floating'
export type CompareMode = 'split' | 'wipe'
export type AgentOpenWhileRefine = 'allow' | 'dismiss-refine' | 'block'
export type InspectorOpenWhileRefine = 'allow' | 'dismiss-refine' | 'block'

export function clampWipeRatio(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

export function decideAgentOpenWhileRefine(input: {
  refineOpen: boolean
  refineBusy: boolean
  refineChrome: RefineChromeMode
}): AgentOpenWhileRefine {
  if (!input.refineOpen) return 'allow'
  if (input.refineChrome === 'floating') return 'allow'
  if (input.refineBusy) return 'block'
  return 'dismiss-refine'
}

export function decideInspectorOpenWhileRefine(input: {
  refineOpen: boolean
  refineBusy: boolean
}): InspectorOpenWhileRefine {
  if (!input.refineOpen) return 'allow'
  if (input.refineBusy) return 'block'
  return 'dismiss-refine'
}

export function shouldApplyRefineToNode(input: {
  nodeUrl: string
  sessionBeforeUrl: string
}): boolean {
  return input.nodeUrl === input.sessionBeforeUrl
}
