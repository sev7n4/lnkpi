import { isNodeGenerating } from '@/constants/dockStudio'

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

export function canOpenRefineForNode(input: {
  type?: string | null
  mediaKind?: string | null
  mimeType?: string | null
}): boolean {
  const type = String(input.type ?? '')
  if (type === 'image') return true
  if (type !== 'mediaInput') return false
  const kind = String(input.mediaKind ?? '').toLowerCase()
  if (kind === 'image') return true
  const mime = String(input.mimeType ?? '').toLowerCase()
  return mime.startsWith('image/')
}

export function canOpenNodeImageEdit(status: unknown): boolean {
  return !isNodeGenerating(status) && status !== 'uploading'
}
