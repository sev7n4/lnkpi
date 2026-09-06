import { describe, expect, it, vi } from 'vitest'
import { cancelAgentRun } from './cancelAgentRun'

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
})
