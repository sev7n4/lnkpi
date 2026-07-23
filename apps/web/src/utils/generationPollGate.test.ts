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

  it('rejects newer completed id while node still points at older failed id', () => {
    // Repro: text/prompt/audio forgot to bump generationRecordId before resolve.
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'generating',
        nodeRecordId: 'cmrxhe8sk005kny01qbl02zky',
        incomingRecordId: 'cmrxhfe7m005ony013k0s8mxm',
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
