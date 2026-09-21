import { describe, expect, it, vi } from 'vitest'
import { makeSliceUndo, runGridSlice } from './useGridSlice'

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

  it('nested re-slice stamps sourceNodeId with the direct slice parent, not the original root', async () => {
    const sliceApi = vi.fn(async () => ({
      urls: [
        'https://cdn/sub-1.png',
        'https://cdn/sub-2.png',
        'https://cdn/sub-3.png',
        'https://cdn/sub-4.png',
      ],
      cols: 2,
      rows: 2,
    }))
    // child-1 是上一轮 img-1 的切片子节点：对它再切，sourceNodeId 必须是 child-1（覆盖式直接父）
    const input = stubRunInput({
      sourceNodeId: 'child-1',
      getSourceNode: () => ({ id: 'child-1', data: { label: '主图 · 格1' } }),
      sliceApi,
    })
    const { addNode } = input

    await runGridSlice(input)

    expect(vi.mocked(addNode).mock.calls[0]![1].gridSlice).toEqual({
      sourceNodeId: 'child-1',
      index: 0,
      cols: 2,
      rows: 2,
    })
    expect(vi.mocked(addNode).mock.calls[3]![1].gridSlice).toEqual({
      sourceNodeId: 'child-1',
      index: 3,
      cols: 2,
      rows: 2,
    })
  })

  it('notify is called on success with a 撤回本次切分 action wired to batch undo', async () => {
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
    const notify = vi.fn()
    const removeNode = vi.fn()
    const childIds = ['child-1', 'child-2', 'child-3', 'child-4']
    const getNode = vi.fn((id: string) =>
      childIds.includes(id)
        ? { id, data: { gridSlice: { sourceNodeId: 'img-1', index: 0, cols: 2, rows: 2 } } }
        : undefined,
    )
    const input = stubRunInput({ sliceApi, notify, removeNode, getNode })

    await runGridSlice(input)

    expect(notify).toHaveBeenCalledTimes(1)
    const [msg, actions] = vi.mocked(notify).mock.calls[0]!
    expect(String(msg)).toContain('4')
    expect(actions).toHaveLength(1)
    expect(actions![0].label).toBe('撤回本次切分')

    actions![0].onClick()
    expect(removeNode).toHaveBeenCalledTimes(4)
    expect(removeNode.mock.calls.map((c) => c[0])).toEqual([
      'child-1',
      'child-2',
      'child-3',
      'child-4',
    ])
  })

  describe('makeSliceUndo', () => {
    function makeChildNode(id: string, sourceNodeId: string) {
      return { id, data: { gridSlice: { sourceNodeId, index: 0, cols: 2, rows: 2 } } }
    }

    it('removes only nodes matching gridSlice.sourceNodeId within the given childIds', () => {
      const removeNode = vi.fn()
      const nodes = new Map([
        ['child-1', makeChildNode('child-1', 'img-1')],
        ['child-2', makeChildNode('child-2', 'img-1')],
        ['child-3', makeChildNode('child-3', 'child-1')], // 嵌套再切的孙节点
        ['gone-1', makeChildNode('gone-1', 'img-1')],
      ])
      const undo = makeSliceUndo(
        { removeNode, getNode: (id) => nodes.get(id) },
        'sess-1',
        'img-1',
        ['child-1', 'child-2', 'child-3', 'already-deleted'],
      )

      undo()

      // 仅移除 sourceNodeId=img-1 且 ∈ childIds 的节点；嵌套孙节点与已不存在的节点不动
      expect(removeNode.mock.calls.map((c) => c[0])).toEqual(['child-1', 'child-2'])
    })

    it('returns a no-op undo when sessionId is empty', () => {
      const removeNode = vi.fn()
      const undo = makeSliceUndo({ removeNode }, '', 'img-1', ['child-1'])

      undo()

      expect(removeNode).not.toHaveBeenCalled()
    })
  })
})
