import { describe, expect, it } from 'vitest'
import {
  duplicateSubgraph,
  resolveDuplicateSourceIds,
  sanitizeNodeDataForDuplicate,
  type DuplicateCanvasEdge,
  type DuplicateCanvasNode,
} from './duplicateSubgraph'

const n = (
  id: string,
  type = 'image',
  extra: Partial<DuplicateCanvasNode> = {},
): DuplicateCanvasNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {},
  ...extra,
})

const e = (source: string, target: string): DuplicateCanvasEdge => ({
  id: `e-${source}-${target}`,
  source,
  target,
})

describe('resolveDuplicateSourceIds upstream', () => {
  it('adds only direct upstream nodes for single seed', () => {
    const nodes = [n('ref'), n('img')]
    const edges = [e('ref', 'img')]
    const ids = resolveDuplicateSourceIds(nodes, edges, 'img', ['img'], 'upstream')
    expect(ids.sort()).toEqual(['img', 'ref'])
  })

  it('does not recurse upstream chain', () => {
    const nodes = [n('a', 'prompt'), n('b', 'prompt'), n('c', 'image')]
    const edges = [e('a', 'b'), e('b', 'c')]
    const ids = resolveDuplicateSourceIds(nodes, edges, 'c', ['c'], 'upstream')
    expect(ids.sort()).toEqual(['b', 'c'])
  })
})

describe('duplicateSubgraph', () => {
  it('clears generationRecordId on copy', () => {
    const nodes = [
      n('a', 'image', {
        data: { generationRecordId: 'g1', url: 'u', status: 'completed' },
      }),
    ]
    const { nodes: out } = duplicateSubgraph(nodes, [], ['a'])
    expect(out[0].data?.generationRecordId).toBeUndefined()
    expect(out[0].data?.url).toBe('u')
    expect(out[0].id).not.toBe('a')
  })

  it('copies internal edges for A->B->C selection', () => {
    const nodes = [n('a', 'prompt'), n('b', 'image'), n('c', 'video')]
    const edges = [e('a', 'b'), e('b', 'c'), e('a', 'c')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['a', 'b', 'c'])
    expect(outNodes).toHaveLength(3)
    expect(outEdges).toHaveLength(3)
    for (const edge of outEdges) {
      expect(outNodes.some((x) => x.id === edge.source)).toBe(true)
      expect(outNodes.some((x) => x.id === edge.target)).toBe(true)
    }
  })

  it('upstream mode copies ref->img when only img selected', () => {
    const nodes = [n('ref', 'image'), n('img', 'image')]
    const edges = [e('ref', 'img')]
    const sourceIds = resolveDuplicateSourceIds(nodes, edges, 'img', ['img'], 'upstream')
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, sourceIds)
    expect(outNodes).toHaveLength(2)
    expect(outEdges).toHaveLength(1)
  })

  it('offsets duplicated positions', () => {
    const nodes = [n('a', 'image', { position: { x: 100, y: 200 } })]
    const { nodes: out } = duplicateSubgraph(nodes, [], ['a'], { offset: { x: 48, y: 48 } })
    expect(out[0].position).toEqual({ x: 148, y: 248 })
  })

  it('uses injected createNodeId', () => {
    const { nodes: out } = duplicateSubgraph(
      [n('a', 'image')],
      [],
      ['a'],
      { createNodeId: (type) => `${type}-agent-1` },
    )
    expect(out[0].id).toBe('image-agent-1')
  })
})

describe('sanitizeNodeDataForDuplicate', () => {
  it('clones nested plain objects', () => {
    const data = sanitizeNodeDataForDuplicate('image', {
      prompt: 'p',
      settings: { model: 'm' },
    })
    expect(data.prompt).toBe('p')
    expect(data.settings).toEqual({ model: 'm' })
  })

  it('resets generating status to idle when no url', () => {
    const data = sanitizeNodeDataForDuplicate('image', { status: 'generating', prompt: 'p' })
    expect(data.status).toBe('idle')
    expect(data.prompt).toBe('p')
  })

  it('sets completed when media has url', () => {
    const data = sanitizeNodeDataForDuplicate('image', {
      status: 'generating',
      url: 'https://x/a.png',
    })
    expect(data.status).toBe('completed')
  })
})
