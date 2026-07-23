import { describe, expect, it } from 'vitest'
import { shouldApplyGenerationPoll } from './generationPollGate'

describe('shouldApplyGenerationPoll', () => {
  it('applies terminal result when node already error but same recordId', () => {
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'error',
        nodeRecordId: 'rec-1',
        incomingRecordId: 'rec-1',
        incomingStatus: 'failed',
      }),
    ).toBe(true)
  })

  it('ignores stale record when node tracks a newer id', () => {
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'generating',
        nodeRecordId: 'rec-2',
        incomingRecordId: 'rec-1',
        incomingStatus: 'completed',
      }),
    ).toBe(false)
  })

  it('ignores writes after cancel to draft', () => {
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'draft',
        nodeRecordId: 'rec-1',
        incomingRecordId: 'rec-1',
        incomingStatus: 'completed',
      }),
    ).toBe(false)
  })
})
