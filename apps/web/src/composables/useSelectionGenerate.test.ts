import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useSelectionGenerate, type UseSelectionGenerateDeps } from './useSelectionGenerate'

function makeDeps(overrides?: Partial<UseSelectionGenerateDeps>): UseSelectionGenerateDeps {
  return {
    nodes: ref([]),
    edges: ref([]),
    generateForNode: async () => {},
    hasUsableOutput: () => false,
    resolveUpstreamIds: () => [],
    cancelGeneration: () => {},
    isInFlight: () => false,
    toast: () => {},
    ...overrides,
  }
}

describe('useSelectionGenerate entry', () => {
  it('exports useSelectionGenerate factory', () => {
    expect(typeof useSelectionGenerate).toBe('function')
  })

  it('initial state is idle and progress zero', () => {
    const api = useSelectionGenerate(makeDeps())
    expect(api.state.value).toBe('idle')
    expect(api.progress.value).toMatchObject({
      done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
      abortReason: 'none',
    })
  })
})
