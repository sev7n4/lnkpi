export type RefineChromeMode = 'docked' | 'floating'
export type CompareMode = 'split' | 'wipe'
/** Left workspace: mask on Before vs expanded compare. Shared by future edit tools. */
export type CompareWorkspace = 'work' | 'compare'
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

export function nextCompareWorkspace(current: CompareWorkspace): CompareWorkspace {
  return current === 'compare' ? 'work' : 'compare'
}

/** Wipe is always a compare-mode switch, even before After exists. */
export function wipeCompareLocked(_hasDistinctAfter: boolean): boolean {
  return false
}

export function loupeSubcontrolsVisible(loupeOn: boolean): boolean {
  return loupeOn
}

export function maskSubcontrolsVisible(menuOpen: boolean): boolean {
  return menuOpen
}
