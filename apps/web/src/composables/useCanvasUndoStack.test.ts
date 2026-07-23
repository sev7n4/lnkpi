import { describe, expect, it } from 'vitest'
import {
  createCanvasUndoStack,
  GENERATION_HISTORY_SKIP_KEYS,
  patchTouchesGenerationFields,
  rememberGenerationFields,
  resolveGenerationFieldsForApply,
  stripGenerationFieldsFromData,
  type CanvasSnapshot,
  type GenerationFieldsCache,
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
      urls: ['https://example.com/a.mp4'],
      images: ['https://example.com/a.png'],
      coverUrl: 'https://example.com/cover.png',
      generationRecordId: 'rec-1',
      materialId: 'mat-1',
      errorMessage: 'boom',
      uploadProgress: 40,
    })
    expect(stripped).toEqual({ prompt: 'hello', duration: 8 })
    expect(stripped).not.toHaveProperty('url')
  })

  it('includes images and materialId in the skip list', () => {
    expect(GENERATION_HISTORY_SKIP_KEYS).toContain('images')
    expect(GENERATION_HISTORY_SKIP_KEYS).toContain('materialId')
    expect(GENERATION_HISTORY_SKIP_KEYS).toContain('url')
  })
})

describe('generation fields session cache (delete → undo)', () => {
  function applyWithCache(
    cache: GenerationFieldsCache,
    snapshot: CanvasSnapshot,
    liveNodes: CanvasSnapshot['nodes'],
  ): CanvasSnapshot['nodes'] {
    const liveById = new Map(liveNodes.map((n) => [n.id, n]))
    return snapshot.nodes.map((n) => {
      const live = liveById.get(n.id)
      const gen = resolveGenerationFieldsForApply(
        cache,
        n.id,
        live?.data as Record<string, unknown> | undefined,
      )
      return { ...n, data: { ...(n.data ?? {}), ...gen } }
    })
  }

  it('restores url/status/images/materialId from cache after delete undo', () => {
    const cache: GenerationFieldsCache = new Map()
    const withGen: CanvasSnapshot = {
      nodes: [
        {
          id: 'v1',
          type: 'video',
          position: { x: 0, y: 0 },
          data: {
            prompt: 'scene',
            status: 'completed',
            url: 'https://cdn.example/v.mp4',
            images: ['https://cdn.example/i.png'],
            materialId: 'mat-9',
            generationRecordId: 'rec-9',
          },
        },
      ],
      edges: [],
    }

    // Snapshot path: remember then strip (as CanvasPage does)
    rememberGenerationFields(cache, 'v1', withGen.nodes[0].data as Record<string, unknown>)
    const historySnap: CanvasSnapshot = {
      nodes: [
        {
          ...withGen.nodes[0],
          data: stripGenerationFieldsFromData(withGen.nodes[0].data as Record<string, unknown>),
        },
      ],
      edges: [],
    }
    expect(historySnap.nodes[0].data).not.toHaveProperty('url')
    expect(historySnap.nodes[0].data).toEqual({ prompt: 'scene' })

    // Delete node — live has no v1; undo applies stripped snapshot
    const restored = applyWithCache(cache, historySnap, [])
    expect(restored[0].data).toMatchObject({
      prompt: 'scene',
      status: 'completed',
      url: 'https://cdn.example/v.mp4',
      images: ['https://cdn.example/i.png'],
      materialId: 'mat-9',
      generationRecordId: 'rec-9',
    })
  })

  it('prefers live generation fields over stale cache when node still exists', () => {
    const cache: GenerationFieldsCache = new Map()
    cache.set('v1', { status: 'completed', url: 'https://old.example/v.mp4' })
    const snapshot: CanvasSnapshot = {
      nodes: [
        {
          id: 'v1',
          type: 'video',
          position: { x: 0, y: 0 },
          data: { prompt: 'scene', duration: 8 },
        },
      ],
      edges: [],
    }
    const live = [
      {
        id: 'v1',
        type: 'video',
        position: { x: 0, y: 0 },
        data: { status: 'completed', url: 'https://new.example/v.mp4' },
      },
    ] as CanvasSnapshot['nodes']

    const restored = applyWithCache(cache, snapshot, live)
    expect(restored[0].data.url).toBe('https://new.example/v.mp4')
  })

  /**
   * Contract: generation/upload patches often call saveCanvas without commitAfterChange.
   * getSnapshot/remember only runs on commit — so if the next commit is delete, the
   * node is already gone and cache never saw the url. Live patches that touch
   * GENERATION_HISTORY_SKIP_KEYS must call rememberGenerationFields (CanvasPage
   * wraps patchNodeData); delete path should remember as belt-and-suspenders.
   */
  it('documents: live gen patch without remember loses url on delete→undo', () => {
    const cache: GenerationFieldsCache = new Map()
    // History was seeded before generation (no url in strip snapshot)
    const historySnap: CanvasSnapshot = {
      nodes: [
        {
          id: 'v1',
          type: 'video',
          position: { x: 0, y: 0 },
          data: { prompt: 'scene' },
        },
      ],
      edges: [],
    }
    // Live patched url but never remembered; delete removed the node
    const restored = applyWithCache(cache, historySnap, [])
    expect(restored[0].data).not.toHaveProperty('url')
  })

  it('live gen patch + remember (no commit) restores url after delete→undo', () => {
    const cache: GenerationFieldsCache = new Map()
    const historySnap: CanvasSnapshot = {
      nodes: [
        {
          id: 'v1',
          type: 'video',
          position: { x: 0, y: 0 },
          data: { prompt: 'scene' },
        },
      ],
      edges: [],
    }

    // Simulate wrapped patchNodeData: poll success wrote url without commit
    const livePatch = {
      status: 'completed',
      url: 'https://cdn.example/gen.mp4',
      materialId: 'mat-gen',
    }
    expect(patchTouchesGenerationFields(livePatch)).toBe(true)
    rememberGenerationFields(cache, 'v1', { prompt: 'scene', ...livePatch })

    // Delete then undo — live empty; cache supplies url
    const restored = applyWithCache(cache, historySnap, [])
    expect(restored[0].data).toMatchObject({
      prompt: 'scene',
      status: 'completed',
      url: 'https://cdn.example/gen.mp4',
      materialId: 'mat-gen',
    })
  })

  it('patchTouchesGenerationFields detects outcome keys only', () => {
    expect(patchTouchesGenerationFields({ prompt: 'x', duration: 8 })).toBe(false)
    expect(patchTouchesGenerationFields({ url: 'https://x' })).toBe(true)
    expect(patchTouchesGenerationFields({ status: 'generating' })).toBe(true)
    expect(patchTouchesGenerationFields({ uploadProgress: 10 })).toBe(true)
  })
})
