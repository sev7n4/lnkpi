import { describe, expect, it } from 'vitest'
import { groupRecordsByNodeId } from './taskHistoryGrouping'

const r = (id: string, nodeId: string | null, createdAt: string, status = 'completed') =>
  ({ id, nodeId, createdAt, status, type: 'video', prompt: '' })

describe('groupRecordsByNodeId', () => {
  it('groups by nodeId, newest attempt first, marks attemptCount', () => {
    const groups = groupRecordsByNodeId([
      r('a', 'n1', '2026-07-23T10:00:00Z', 'failed'),
      r('b', 'n1', '2026-07-23T11:00:00Z', 'completed'),
      r('c', 'n2', '2026-07-23T09:00:00Z'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].nodeId).toBe('n1')
    expect(groups[0].attemptCount).toBe(2)
    expect(groups[0].latest.id).toBe('b')
    expect(groups[0].attempts.map((x) => x.id)).toEqual(['b', 'a'])
    expect(groups[1].nodeId).toBe('n2')
  })

  it('keeps orphan records as separate groups', () => {
    const groups = groupRecordsByNodeId([
      r('x', null, '2026-07-23T12:00:00Z'),
      r('y', '', '2026-07-23T11:00:00Z'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.nodeId === null)).toBe(true)
  })
})
