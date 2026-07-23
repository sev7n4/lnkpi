export type GenerationRecordLike = {
  id: string
  nodeId?: string | null
  createdAt: string
  status: string
  type: string
  prompt: string
}

export type TaskAttemptGroup = {
  nodeId: string | null
  attempts: GenerationRecordLike[]
  latest: GenerationRecordLike
  attemptCount: number
}

function isValidNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.length > 0
}

export function groupRecordsByNodeId(records: GenerationRecordLike[]): TaskAttemptGroup[] {
  const groups = new Map<string, { nodeId: string | null; attempts: GenerationRecordLike[] }>()

  for (const record of records) {
    const key = isValidNodeId(record.nodeId) ? record.nodeId : `__orphan:${record.id}`
    const nodeId = isValidNodeId(record.nodeId) ? record.nodeId : null

    let group = groups.get(key)
    if (!group) {
      group = { nodeId, attempts: [] }
      groups.set(key, group)
    }
    group.attempts.push(record)
  }

  const result: TaskAttemptGroup[] = []
  for (const group of groups.values()) {
    group.attempts.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    result.push({
      nodeId: group.nodeId,
      attempts: group.attempts,
      latest: group.attempts[0]!,
      attemptCount: group.attempts.length,
    })
  }

  result.sort(
    (a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime(),
  )
  return result
}
