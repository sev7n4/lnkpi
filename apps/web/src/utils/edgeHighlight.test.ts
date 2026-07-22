import { describe, expect, it } from 'vitest'
import { annotateEdgesForSelection } from '@/utils/edgeHighlight'

describe('annotateEdgesForSelection', () => {
  const edges = [
    { id: 'e1', class: 'old-class' },
    { id: 'e2' },
    { id: 'e3' },
  ]

  it('sets upstream and downstream classes', () => {
    const result = annotateEdgesForSelection(
      edges,
      new Set(['e1']),
      new Set(['e2']),
    )
    expect(result[0].class).toBe('neo-edge-upstream')
    expect(result[1].class).toBe('neo-edge-downstream')
    expect(result[2].class).toBeUndefined()
  })

  it('clears highlight classes when selection sets are empty', () => {
    const highlighted = annotateEdgesForSelection(
      edges,
      new Set(['e1']),
      new Set(['e2']),
    )
    const cleared = annotateEdgesForSelection(highlighted, new Set(), new Set())
    expect(cleared.every((edge) => edge.class === undefined)).toBe(true)
  })
})
