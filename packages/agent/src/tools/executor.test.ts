import { describe, expect, it } from 'vitest'
import type { CanvasData } from '@lnkpi/shared'
import { applyCanvasActions } from './executor'

describe('applyCanvasActions', () => {
  it('keeps compositionRunGroup across update_node', () => {
    const group = {
      nodeIds: ['n1'],
      dumpHash: 'ab'.repeat(32),
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    const data: CanvasData = {
      nodes: [{ id: 'n1', type: 'prompt', position: { x: 0, y: 0 }, data: { prompt: 'old' } }],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1 },
      compositionRunGroup: group,
    }
    const result = applyCanvasActions(data, [
      { type: 'update_node', payload: { id: 'n1', data: { prompt: 'new' } } },
    ])
    expect(result.compositionRunGroup).toEqual(group)
    expect(result.viewport).toEqual({ x: 10, y: 20, zoom: 1 })
    expect(result.nodes[0]?.data.prompt).toBe('new')
  })
})
