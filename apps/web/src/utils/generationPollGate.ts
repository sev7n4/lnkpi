import { NODE_GENERATION_STATUS, isNodeGenerating } from '@/constants/dockStudio'

const TERMINAL_POLL_STATUSES = new Set<string>([
  NODE_GENERATION_STATUS.completed,
  NODE_GENERATION_STATUS.failed,
  NODE_GENERATION_STATUS.error,
  // fallback_pending is NOT terminal for overwrite-from-error recovery
])

function hasRecordId(value: unknown): value is string | number {
  return value != null && value !== ''
}

/**
 * Whether a generation poll / resolve result should write back to the node.
 * Allows terminal writes when the node already shows error/failed but still
 * tracks the same generationRecordId (status desync recovery).
 */
export function shouldApplyGenerationPoll(opts: {
  nodeStatus: unknown
  nodeRecordId: unknown
  incomingRecordId: string
  incomingStatus: string
}): boolean {
  const { nodeStatus, nodeRecordId, incomingRecordId, incomingStatus } = opts

  // Stale poll for an older task — node already tracks a newer record.
  if (hasRecordId(nodeRecordId) && String(nodeRecordId) !== incomingRecordId) {
    return false
  }

  // User cancelled — ignore late results.
  if (nodeStatus === NODE_GENERATION_STATUS.draft) {
    return false
  }

  // User already cancelled / failed locally — do not revive fallback_pending.
  if (
    incomingStatus === NODE_GENERATION_STATUS.fallback_pending &&
    (nodeStatus === NODE_GENERATION_STATUS.error ||
      nodeStatus === NODE_GENERATION_STATUS.failed)
  ) {
    return false
  }

  // Still in-flight on the node.
  if (isNodeGenerating(nodeStatus) || nodeStatus === 'pending') {
    return true
  }

  // Terminal poll for the same recordId must write even if node already error/failed.
  if (
    TERMINAL_POLL_STATUSES.has(incomingStatus) &&
    hasRecordId(nodeRecordId) &&
    String(nodeRecordId) === incomingRecordId
  ) {
    return true
  }

  return false
}
