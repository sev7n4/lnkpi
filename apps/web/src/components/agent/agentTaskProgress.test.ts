/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { applyTaskEvent, emptyTaskProgress } from './agentTaskProgress'

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
})
