import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatPhaseLabel, useAgentStream } from '@/composables/useAgentStream'
import { STREAM_STALE_MS } from '@/components/agent/streamRecovery'

describe('useAgentStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks unreachable after STREAM_STALE_MS without touch', () => {
    const onStale = vi.fn()
    const stream = useAgentStream({ pollMs: 1000, onStale })
    stream.start()
    vi.advanceTimersByTime(STREAM_STALE_MS + 1500)
    expect(stream.unreachable.value).toBe(true)
    expect(onStale).toHaveBeenCalledTimes(1)
    stream.stop()
  })

  it('touch resets staleness', () => {
    const stream = useAgentStream({ pollMs: 1000 })
    stream.start()
    vi.advanceTimersByTime(STREAM_STALE_MS - 1000)
    stream.touch()
    vi.advanceTimersByTime(STREAM_STALE_MS - 1000)
    expect(stream.unreachable.value).toBe(false)
    stream.stop()
  })

  it('stop clears monitoring', () => {
    const onStale = vi.fn()
    const stream = useAgentStream({ pollMs: 1000, onStale })
    stream.start()
    stream.stop()
    vi.advanceTimersByTime(STREAM_STALE_MS + 5000)
    expect(onStale).not.toHaveBeenCalled()
  })
})

describe('formatPhaseLabel', () => {
  it('maps known phases', () => {
    expect(formatPhaseLabel('await_topo')).toBe('等待拓扑确认')
    expect(formatPhaseLabel('unknown_phase')).toBe('unknown_phase')
  })
})
