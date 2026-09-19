import { describe, expect, it, vi } from 'vitest'
import { reportBatchEvent } from './selectionBatchTelemetry'

describe('reportBatchEvent', () => {
  it('emits selection_batch_started', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    reportBatchEvent('selection_batch_started', { sessionId: 's1', runCount: 3, skipCount: 1, total: 4, triggerSource: 'multi_select_toolbar', flagOn: true })
    expect(spy).toHaveBeenCalledWith('[telemetry]', 'selection_batch_started', expect.objectContaining({ sessionId: 's1' }))
    spy.mockRestore()
  })
})
