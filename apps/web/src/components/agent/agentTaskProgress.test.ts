/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  applyPollRecordToTask,
  applyTaskEvent,
  emptyTaskProgress,
  formatTaskProgressLine,
  mapRecordStatusToTaskStatus,
} from './agentTaskProgress'

describe('formatTaskProgressLine', () => {
  it('shows done/total and current running title', () => {
    const line = formatTaskProgressLine([
      { id: 'a', title: '白底主图', status: 'done' },
      { id: 'b', title: '礼盒主视觉', status: 'running' },
      { id: 'c', title: '送礼场景', status: 'pending' },
    ])
    expect(line).toBe('已完成 1/3 · 正在生成：礼盒主视觉')
  })

  it('falls back to first pending when nothing running', () => {
    const line = formatTaskProgressLine([
      { id: 'a', title: '白底主图', status: 'done' },
      { id: 'b', title: '礼盒主视觉', status: 'pending' },
    ])
    expect(line).toBe('已完成 1/2 · 正在生成：礼盒主视觉')
  })
})

describe('applyTaskEvent', () => {
  it('stores banner from task_list', () => {
    const s = applyTaskEvent(emptyTaskProgress(), {
      type: 'task_list',
      data: {
        items: [{ id: 'a', title: '礼盒主视觉', nodeId: 'n1' }],
        banner: '出图进行中，请勿切换标签页',
      },
    })
    expect(s.banner).toBe('出图进行中，请勿切换标签页')
  })
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
