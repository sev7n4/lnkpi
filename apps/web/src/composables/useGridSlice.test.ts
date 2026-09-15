import { describe, expect, it, vi } from 'vitest'
import { equalSliceRects } from '@/utils/gridSlice'
import { runGridSlice, sliceImageToFiles } from './useGridSlice'

function fileAt(index: number) {
  return new File([`cell-${index}`], `slice-${index + 1}.png`, { type: 'image/png' })
}

function stubSliceDeps() {
  const crop = vi.fn((_image: { width: number; height: number }, _rect: unknown, index: number) =>
    fileAt(index),
  )
  return {
    loadImage: async () => ({ width: 10, height: 10 }),
    crop,
  }
}

function stubPlaceDeps() {
  const addNode = vi.fn((_type: string, _data: Record<string, unknown>) => `child-${addNode.mock.calls.length}`)
  const addEdge = vi.fn()
  const layoutChildren = vi.fn()
  return { addNode, addEdge, layoutChildren }
}

describe('sliceImageToFiles', () => {
  it('clamps cols/rows before equal-slicing', async () => {
    const { crop, loadImage } = stubSliceDeps()

    const files = await sliceImageToFiles('blob:src', 9, 0, { loadImage, crop })

    expect(files).toHaveLength(7)
    expect(crop).toHaveBeenCalledTimes(7)
    expect(crop.mock.calls.map((call) => call[1])).toEqual(equalSliceRects(10, 10, 7, 1))
  })

  it('crops one file per cell in row-major order', async () => {
    const { crop, loadImage } = stubSliceDeps()

    const files = await sliceImageToFiles('https://cdn/src.png', 3, 3, { loadImage, crop })

    expect(files).toHaveLength(9)
    expect(files.map((file) => file.name)).toEqual(
      Array.from({ length: 9 }, (_, i) => `slice-${i + 1}.png`),
    )
    expect(crop.mock.calls.map((call) => call[1])).toEqual(equalSliceRects(10, 10, 3, 3))
  })
})

describe('runGridSlice', () => {
  it('persists all urls before placing N children once', async () => {
    const order: string[] = []
    const persist = vi.fn(async (_file: File, _fallback: string) => {
      order.push('persist')
      return `https://cdn/cell-${persist.mock.calls.length}.png`
    })
    const { addNode, addEdge, layoutChildren } = stubPlaceDeps()
    addNode.mockImplementation(() => {
      order.push('addNode')
      return `child-${addNode.mock.calls.length}`
    })
    layoutChildren.mockImplementation(() => {
      order.push('layout')
    })

    const result = await runGridSlice({
      sourceUrl: 'https://cdn/src.png',
      cols: 2,
      rows: 2,
      sourceNodeId: 'img-1',
      getSourceNode: () => ({ id: 'img-1', data: { label: '主图' } }),
      addNode,
      addEdge,
      layoutChildren,
      persist,
      ...stubSliceDeps(),
    })

    expect(persist).toHaveBeenCalledTimes(4)
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
    expect(order.slice(0, 4)).toEqual(['persist', 'persist', 'persist', 'persist'])
    expect(order.slice(4)).toEqual(['addNode', 'addNode', 'addNode', 'addNode', 'layout'])

    expect(addNode.mock.calls[0][0]).toBe('image')
    expect(addNode.mock.calls[0][1]).toMatchObject({
      url: 'https://cdn/cell-1.png',
      label: '主图 · 格1',
      gridSlice: { sourceNodeId: 'img-1', index: 0, cols: 2, rows: 2 },
    })
    expect(addNode.mock.calls[3][1]).toMatchObject({
      url: 'https://cdn/cell-4.png',
      label: '主图 · 格4',
      gridSlice: { sourceNodeId: 'img-1', index: 3, cols: 2, rows: 2 },
    })
    expect(addEdge.mock.calls[0][0]).toMatchObject({
      source: 'img-1',
      target: 'child-1',
    })
  })

  it('writes clamped cols/rows onto child gridSlice metadata', async () => {
    const persist = vi.fn(async () => 'https://cdn/cell.png')
    const { addNode, addEdge, layoutChildren } = stubPlaceDeps()

    await runGridSlice({
      sourceUrl: 'https://cdn/src.png',
      cols: 9,
      rows: 0,
      sourceNodeId: 'img-1',
      getSourceNode: () => ({ id: 'img-1', data: { label: '主图' } }),
      addNode,
      addEdge,
      layoutChildren,
      persist,
      ...stubSliceDeps(),
    })

    expect(addNode).toHaveBeenCalledTimes(7)
    expect(addNode.mock.calls[0][1].gridSlice).toEqual({
      sourceNodeId: 'img-1',
      index: 0,
      cols: 7,
      rows: 1,
    })
  })

  it('throws and does not place when any persist fails', async () => {
    const persist = vi.fn(async () => {
      if (persist.mock.calls.length === 2) throw new Error('upload failed')
      return `https://cdn/cell-${persist.mock.calls.length}.png`
    })
    const { addNode, addEdge, layoutChildren } = stubPlaceDeps()

    await expect(
      runGridSlice({
        sourceUrl: 'https://cdn/src.png',
        cols: 2,
        rows: 2,
        sourceNodeId: 'img-1',
        getSourceNode: () => ({ id: 'img-1', data: { label: '主图' } }),
        addNode,
        addEdge,
        layoutChildren,
        persist,
        ...stubSliceDeps(),
      }),
    ).rejects.toThrow('upload failed')

    expect(addNode).not.toHaveBeenCalled()
    expect(addEdge).not.toHaveBeenCalled()
    expect(layoutChildren).not.toHaveBeenCalled()
  })
})
