import { describe, expect, it, vi } from 'vitest'
import { fitImportedViewport } from './fitImportedViewport'
import { IMPORT_NODE_ESTIMATE } from './workflowImportPlacement'

describe('fitImportedViewport', () => {
  it('falls back to fitBounds with estimated bbox when fitView skips unmeasured nodes', async () => {
    const fitView = vi.fn(async () => false)
    const fitBounds = vi.fn(async () => true)
    const updateNodeInternals = vi.fn()

    const nodes = [
      { id: 'a', position: { x: 2000, y: 2100 } },
      { id: 'b', position: { x: 2400, y: 2100 } },
    ]

    const result = await fitImportedViewport({
      ids: ['a', 'b'],
      nodes,
      getMeasuredNode: () => undefined,
      fitView,
      fitBounds,
      updateNodeInternals,
      wait: async () => {},
      maxAttempts: 2,
    })

    expect(updateNodeInternals).toHaveBeenCalledWith(['a', 'b'])
    expect(fitView).toHaveBeenCalled()
    expect(fitBounds).toHaveBeenCalledOnce()
    const [bounds, opts] = fitBounds.mock.calls[0]
    expect(bounds).toEqual({
      x: 2000,
      y: 2100,
      width: 400 + IMPORT_NODE_ESTIMATE.width,
      height: IMPORT_NODE_ESTIMATE.height,
    })
    expect(opts).toMatchObject({ padding: 0.2, duration: 300 })
    expect(result).toBe('fitBounds')
  })

  it('uses fitView once imported nodes have dimensions', async () => {
    const fitView = vi.fn(async () => true)
    const fitBounds = vi.fn(async () => true)
    let attempt = 0

    const result = await fitImportedViewport({
      ids: ['a'],
      nodes: [{ id: 'a', position: { x: 10, y: 20 } }],
      getMeasuredNode: (id) => {
        attempt += 1
        if (attempt < 2) return { id, dimensions: { width: 0, height: 0 } }
        return { id, dimensions: { width: 280, height: 180 } }
      },
      fitView,
      fitBounds,
      wait: async () => {},
      maxAttempts: 5,
    })

    expect(result).toBe('fitView')
    expect(fitView).toHaveBeenCalled()
    expect(fitBounds).not.toHaveBeenCalled()
  })
})
