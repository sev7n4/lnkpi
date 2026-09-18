/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  SelectionBatchLimitError,
  SelectionBatchPendingConfirmError,
  planSelectionGenerate,
  type PlanSelectionGenerateInput,
  type PlanSelectionGenerateResult,
  type SkipReason,
} from './selectionBatchGenerate'

describe('planner entry types', () => {
  it('exports the entry function and error classes', () => {
    expect(typeof planSelectionGenerate).toBe('function')
    expect(SelectionBatchLimitError).toBeDefined()
    expect(SelectionBatchPendingConfirmError).toBeDefined()
  })
})

describe('planner: no candidates', () => {
  it('returns empty run/skip for empty selectedIds', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: [],
      canvas: { nodes: [], edges: [] },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip).toEqual([])
    expect(result.blockedBy).toEqual([])
  })
})
