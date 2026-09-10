import { describe, expect, it, vi } from 'vitest'
import { cancelAgentRun, cancelledCalloutTextFromProgress } from './cancelAgentRun'

describe('cancelAgentRun', () => {
  it('calls API then abort even if API fails', async () => {
    const abort = vi.fn()
    const postCancel = vi.fn().mockRejectedValue(new Error('network'))
    const result = await cancelAgentRun({
      threadId: 't1',
      sessionId: 's1',
      abort,
      postCancel,
    })
    expect(postCancel).toHaveBeenCalledWith({ threadId: 't1', sessionId: 's1', reason: 'user' })
    expect(abort).toHaveBeenCalled()
    expect(result.apiOk).toBe(false)
  })

  it('reports skipped when runtime skips non-PV', async () => {
    const abort = vi.fn()
    const postCancel = vi.fn().mockResolvedValue({
      code: 0,
      data: { ok: true, skipped: true, reason: 'flow_not_supported' },
    })
    const result = await cancelAgentRun({
      threadId: 't1',
      sessionId: 's1',
      abort,
      postCancel,
    })
    expect(result.apiOk).toBe(true)
    expect(result.skipped).toBe(true)
    expect(abort).toHaveBeenCalled()
  })

  it('treats a response without ok:true as failure', async () => {
    const abort = vi.fn()
    const postCancel = vi.fn().mockResolvedValue({ code: 500, message: 'boom' })
    const result = await cancelAgentRun({
      threadId: 't1',
      sessionId: 's1',
      abort,
      postCancel,
    })
    expect(result.apiOk).toBe(false)
    expect(abort).toHaveBeenCalled()
  })

  it('surfaces gen progress and preserved gate from the cancel response', async () => {
    const postCancel = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        ok: true,
        phase: 'cancelled',
        completedTasks: 2,
        totalTasks: 5,
        gatePreserved: false,
      },
    })
    const result = await cancelAgentRun({
      threadId: 't1',
      sessionId: 's1',
      abort: vi.fn(),
      postCancel,
    })
    expect(result).toMatchObject({
      apiOk: true,
      completedTasks: 2,
      totalTasks: 5,
      gatePreserved: false,
    })
  })
})

describe('cancelledCalloutTextFromProgress', () => {
  it('renders the completed / total progress line', () => {
    expect(cancelledCalloutTextFromProgress(2, 5)).toBe(
      '已停止出图（完成 2/5）。直接说修改意见，或点「发起新任务」。',
    )
  })

  it('returns null without usable task counts', () => {
    expect(cancelledCalloutTextFromProgress(undefined, undefined)).toBeNull()
    expect(cancelledCalloutTextFromProgress(0, 0)).toBeNull()
  })
})
