/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  applyPollRecordToTask,
  applyTaskEvent,
  emptyTaskProgress,
  mapRecordStatusToTaskStatus,
} from './agentTaskProgress'

describe('applyTaskEvent', () => {
  it('applies task_update retrying attempt', () => {
    let s = applyTaskEvent(emptyTaskProgress(), {
      type: 'task_list',
      data: { items: [{ id: 'a', title: '主图', nodeId: 'n1' }] },
    })
    s = applyTaskEvent(s, {
      type: 'task_update',
      data: { id: 'a', status: 'retrying', attempt: 1, maxAttempts: 2 },
    })
    expect(s.items[0].status).toBe('retrying')
    expect(s.items[0].attempt).toBe(1)
  })

  it('marks finished on task_summary', () => {
    let s = applyTaskEvent(emptyTaskProgress(), {
      type: 'task_list',
      data: { items: [{ id: 'a', title: '主图', nodeId: 'n1' }] },
    })
    s = applyTaskEvent(s, {
      type: 'task_summary',
      data: { success: 1, failed: 0, needsUser: 0, skipped: 0 },
    })
    expect(s.finished).toBe(true)
    expect(s.summary?.success).toBe(1)
  })

  it('W11: defers terminal SSE status when recordId is present', () => {
    let s = applyTaskEvent(emptyTaskProgress(), {
      type: 'task_list',
      data: { items: [{ id: 'a', title: '主图', nodeId: 'n1' }] },
    })
    s = applyTaskEvent(s, {
      type: 'task_update',
      data: { id: 'a', status: 'running', recordId: 'rec-1' },
    })
    s = applyTaskEvent(s, {
      type: 'task_update',
      data: { id: 'a', status: 'done', recordId: 'rec-1' },
    })
    expect(s.items[0].recordId).toBe('rec-1')
    expect(s.items[0].status).toBe('running')
  })

  it('W11: applyPollRecordToTask uses record status as authority', () => {
    let s = applyTaskEvent(emptyTaskProgress(), {
      type: 'task_list',
      data: { items: [{ id: 'a', title: '主图', nodeId: 'n1' }] },
    })
    s = applyTaskEvent(s, {
      type: 'task_update',
      data: { id: 'a', status: 'running', recordId: 'rec-1' },
    })
    s = applyPollRecordToTask(s, 'n1', 'completed')
    expect(s.items[0].status).toBe('done')
  })
})

describe('mapRecordStatusToTaskStatus', () => {
  it('maps studio statuses', () => {
    expect(mapRecordStatusToTaskStatus('completed')).toBe('done')
    expect(mapRecordStatusToTaskStatus('failed')).toBe('failed')
    expect(mapRecordStatusToTaskStatus('fallback_pending')).toBe('needs_user')
    expect(mapRecordStatusToTaskStatus('generating')).toBe('running')
  })
})
