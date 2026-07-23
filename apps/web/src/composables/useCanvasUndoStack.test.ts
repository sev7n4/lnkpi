import { describe, expect, it } from 'vitest'
import {
  createCanvasUndoStack,
  stripGenerationFieldsFromData,
  type CanvasSnapshot,
} from './useCanvasUndoStack'

type NodeLike = {
  id: string
  position: { x: number; y: number }
  type?: string
  data?: Record<string, unknown>
}

function makeStack(initial: CanvasSnapshot, maxDepth = 3) {
  let current = structuredClone(initial)
  const stack = createCanvasUndoStack({
    maxDepth,
    getSnapshot: () => structuredClone(current),
    applySnapshot: (s) => {
      current = structuredClone(s)
    },
  })
  return {
    stack,
    get current() {
      return current
    },
    set current(next: CanvasSnapshot) {
      current = next
    },
    mutateNodes(fn: (nodes: NodeLike[]) => void) {
      const nodes = structuredClone(current.nodes) as NodeLike[]
      fn(nodes)
      current = { ...current, nodes: nodes as CanvasSnapshot['nodes'] }
    },
  }
}

describe('canvas undo stack', () => {
  it('undo restores previous snapshot', () => {
    const ctx = makeStack({
      nodes: [{ id: 'a', position: { x: 0, y: 0 } }],
      edges: [],
    })
    ctx.stack.commitAfterChange()
    ctx.mutateNodes((nodes) => {
      nodes[0].position = { x: 10, y: 0 }
    })
    ctx.stack.commitAfterChange()
    expect(ctx.stack.undo()).toBe(true)
    expect(ctx.current.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(ctx.stack.redo()).toBe(true)
    expect(ctx.current.nodes[0].position).toEqual({ x: 10, y: 0 })
  })

  it('caps depth at maxDepth', () => {
    const ctx = makeStack(
      {
        nodes: [{ id: 'a', position: { x: 0, y: 0 } }],
        edges: [],
      },
      3,
    )
    ctx.stack.commitAfterChange()
    for (let i = 1; i <= 5; i++) {
      ctx.mutateNodes((nodes) => {
        nodes[0].position = { x: i * 10, y: 0 }
      })
      ctx.stack.commitAfterChange()
    }
    let undos = 0
    while (ctx.stack.undo()) undos++
    expect(undos).toBe(3)
    expect(ctx.current.nodes[0].position).toEqual({ x: 20, y: 0 })
  })

  it('new commit clears redo future', () => {
    const ctx = makeStack({
      nodes: [{ id: 'a', position: { x: 0, y: 0 } }],
      edges: [],
    })
    ctx.stack.commitAfterChange()
    ctx.mutateNodes((nodes) => {
      nodes[0].position = { x: 10, y: 0 }
    })
    ctx.stack.commitAfterChange()
    expect(ctx.stack.undo()).toBe(true)
    expect(ctx.stack.canRedo.value).toBe(true)
    ctx.mutateNodes((nodes) => {
      nodes[0].position = { x: 99, y: 0 }
    })
    ctx.stack.commitAfterChange()
    expect(ctx.stack.canRedo.value).toBe(false)
    expect(ctx.stack.redo()).toBe(false)
  })

  it('skips no-op commit when snapshot unchanged', () => {
    const ctx = makeStack({
      nodes: [{ id: 'a', position: { x: 0, y: 0 } }],
      edges: [],
    })
    ctx.stack.commitAfterChange()
    ctx.stack.commitAfterChange()
    expect(ctx.stack.canUndo.value).toBe(false)
  })

  it('push is alias for commitAfterChange (post-change)', () => {
    const ctx = makeStack({
      nodes: [{ id: 'a', position: { x: 0, y: 0 } }],
      edges: [],
    })
    ctx.stack.push()
    ctx.mutateNodes((nodes) => {
      nodes[0].position = { x: 5, y: 5 }
    })
    ctx.stack.push('move')
    expect(ctx.stack.undo()).toBe(true)
    expect(ctx.current.nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})

describe('stripGenerationFieldsFromData', () => {
  it('removes generation outcome fields from node data', () => {
    const stripped = stripGenerationFieldsFromData({
      prompt: 'hello',
      duration: 8,
      status: 'completed',
      url: 'https://example.com/a.mp4',
      generationRecordId: 'rec-1',
      errorMessage: 'boom',
      uploadProgress: 40,
    })
    expect(stripped).toEqual({ prompt: 'hello', duration: 8 })
  })
})
