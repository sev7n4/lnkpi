import { describe, expect, it, vi } from 'vitest'
import { runGridSlice } from './useGridSlice'

function stubPlaceDeps() {
  let n = 0
  const addNode = vi.fn((_type: string, _data: Record<string, unknown>) => {
    n += 1
    return `child-${n}`
  })
  const addEdge = vi.fn()
  const layoutChildren = vi.fn()
  return { addNode, addEdge, layoutChildren }
}

function stubRunInput(
  overrides: Partial<Parameters<typeof runGridSlice>[0]> = {},
): Parameters<typeof runGridSlice>[0] {
  const { addNode, addEdge, layoutChildren } = stubPlaceDeps()
  return {
    sourceUrl: 'https://cdn/src.png',
    cols: 2,
    rows: 2,
    sessionId: 'sess-1',
    sourceNodeId: 'img-1',
    getSourceNode: () => ({ id: 'img-1', data: { label: '主图' } }),
    addNode,
    addEdge,
    layoutChildren,
    ...overrides,
  }
}

describe('runGridSlice', () => {
  it('calls sliceApi and places N children with edges', async () => {
    const sliceApi = vi.fn(async () => ({
      urls: [
        'https://cdn/cell-1.png',
        'https://cdn/cell-2.png',
        'https://cdn/cell-3.png',
        'https://cdn/cell-4.png',
      ],
      cols: 2,
      rows: 2,
    }))
    const input = stubRunInput({ sliceApi })
    const { addNode, addEdge, layoutChildren } = input

    const result = await runGridSlice(input)

    expect(sliceApi).toHaveBeenCalledWith({
      sourceUrl: 'https://cdn/src.png',
      cols: 2,
      rows: 2,
      sessionId: 'sess-1',
    })
    expect(result.urls).toEqual([
      'https://cdn/cell-1.png',
      'https://cdn/cell-2.png',
      'https://cdn/cell-3.png',
      'https://cdn/cell-4.png',
    ])
    expect(result.nodeIds).toEqual(['child-1', 'child-2', 'child-3', 'child-4'])
    expect(addNode).toHaveBeenCalledTimes(4)
    expect(addEdge).toHaveBeenCalledTimes(4)
    expect(layoutChildren).toHaveBeenCalledTimes(1)
    expect(layoutChildren).toHaveBeenCalledWith(['child-1', 'child-2', 'child-3', 'child-4'])

    const addNodeMock = vi.mocked(addNode)
    const addEdgeMock = vi.mocked(addEdge)
    expect(addNodeMock.mock.calls[0]![0]).toBe('image')
    expect(addNodeMock.mock.calls[0]![1]).toMatchObject({
      url: 'https://cdn/cell-1.png',
      label: '主图 · 格1',
      gridSlice: { sourceNodeId: 'img-1', index: 0, cols: 2, rows: 2 },
    })
    expect(addNodeMock.mock.calls[3]![1]).toMatchObject({
      url: 'https://cdn/cell-4.png',
      label: '主图 · 格4',
      gridSlice: { sourceNodeId: 'img-1', index: 3, cols: 2, rows: 2 },
    })
    expect(addEdgeMock.mock.calls[0]![0]).toMatchObject({
      source: 'img-1',
      target: 'child-1',
    })
  })

  it('writes clamped cols/rows from sliceApi onto child gridSlice metadata', async () => {
    const sliceApi = vi.fn(async () => ({
      urls: Array.from({ length: 7 }, (_, i) => `https://cdn/cell-${i + 1}.png`),
      cols: 7,
      rows: 1,
    }))
    const input = stubRunInput({ cols: 9, rows: 0, sliceApi })
    const { addNode } = input

    await runGridSlice(input)

    expect(sliceApi).toHaveBeenCalledWith({
      sourceUrl: 'https://cdn/src.png',
      cols: 7,
      rows: 1,
      sessionId: 'sess-1',
    })
    expect(addNode).toHaveBeenCalledTimes(7)
    expect(vi.mocked(addNode).mock.calls[0]![1].gridSlice).toEqual({
      sourceNodeId: 'img-1',
      index: 0,
      cols: 7,
      rows: 1,
    })
  })

  it('throws and does not place when sliceApi fails', async () => {
    const sliceApi = vi.fn(async () => {
      throw new Error('slice failed')
    })
    const input = stubRunInput({ sliceApi })
    const { addNode, addEdge, layoutChildren } = input

    await expect(runGridSlice(input)).rejects.toThrow('slice failed')

    expect(addNode).not.toHaveBeenCalled()
    expect(addEdge).not.toHaveBeenCalled()
    expect(layoutChildren).not.toHaveBeenCalled()
  })
})
