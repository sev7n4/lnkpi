export const STAIN_PRESET_PROMPT =
  '去除选区内的污渍、瑕疵、多余物体，其余像素保持不变'

export const CX_IMAGE_EDIT_ENABLED = true

export type RefineDismissDecision = 'keep' | 'dismiss' | 'block'

export function decideRefineDismiss(input: {
  busy: boolean
  targetNodeId: string | null
  selectedNodeId: string | null
}): RefineDismissDecision {
  if (input.selectedNodeId === input.targetNodeId) return 'keep'
  if (input.busy) return 'block'
  return 'dismiss'
}
