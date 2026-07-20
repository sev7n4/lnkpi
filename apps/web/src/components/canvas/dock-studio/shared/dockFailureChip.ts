import type { TaskKind } from '@lnkpi/shared'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import { truncateError } from '@/components/canvas/nodeTaskChrome'

export type DockFailureChipView = {
  visible: boolean
  message: string
  showCopy: boolean
}

export type DockFailureShellBind = {
  failureNodeId: string
  failureStatus?: unknown
  failureMessage?: string
  failureErrorCode?: string
  failureTaskKind?: TaskKind
  failureTaskId?: string
  failureNodeLabel?: string
}

const DOCK_MSG_MAX = 48

/** Visibility + truncated message for the quiet Dock failure capsule. */
export function resolveDockFailureChip(input: {
  status?: unknown
  errorMessage?: string
}): DockFailureChipView {
  const { status, errorMessage } = input
  const isFallback = status === NODE_GENERATION_STATUS.fallback_pending
  const isFail =
    status === NODE_GENERATION_STATUS.error ||
    status === NODE_GENERATION_STATUS.failed ||
    isFallback

  if (!isFail) {
    return { visible: false, message: '', showCopy: false }
  }

  const truncated = truncateError(errorMessage, DOCK_MSG_MAX)
  const message = truncated || (isFallback ? '平台回退待确认' : '')
  if (!message) {
    return { visible: false, message: '', showCopy: false }
  }

  return { visible: true, message, showCopy: true }
}

/** Map selected node → DockToolbarShell failure chip props. */
export function dockFailureBindFromNode(node: {
  id: string
  data?: Record<string, unknown> | null
}): DockFailureShellBind {
  const data = node.data ?? {}
  const generationRecordId =
    typeof data.generationRecordId === 'string' ? data.generationRecordId : undefined
  const materialId = typeof data.materialId === 'string' ? data.materialId : undefined
  const taskId = generationRecordId || materialId
  const taskKind: TaskKind | undefined = generationRecordId
    ? 'generation'
    : materialId
      ? 'material'
      : undefined

  return {
    failureNodeId: node.id,
    failureStatus: data.status,
    failureMessage: typeof data.errorMessage === 'string' ? data.errorMessage : undefined,
    failureErrorCode: typeof data.errorCode === 'string' ? data.errorCode : undefined,
    failureTaskKind: taskKind,
    failureTaskId: taskId,
    failureNodeLabel: typeof data.label === 'string' ? data.label : undefined,
  }
}
