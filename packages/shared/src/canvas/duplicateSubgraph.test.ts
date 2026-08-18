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

describe('resolveDuplicateSourceIds', () => {
  it('does not expand upstream nodes into copy set', () => {
    const nodes = [n('ref'), n('img')]
    const edges = [e('ref', 'img')]
    const ids = resolveDuplicateSourceIds(nodes, edges, 'img', ['img'], 'upstream')
    expect(ids).toEqual(['img'])
  })

  it('uses multi-select when context is in selection', () => {
    const nodes = [n('a', 'prompt'), n('b', 'image')]
    const ids = resolveDuplicateSourceIds(nodes, [], 'b', ['a', 'b'], 'none')
    expect(ids.sort()).toEqual(['a', 'b'])
  })
})

describe('duplicateSubgraph', () => {
  it('clears generationRecordId on copy', () => {
    const nodes = [
      n('a', 'image', {
        data: { generationRecordId: 'g1', url: 'u', status: 'completed' },
      }),
    ]
    const { nodes: out, edges: outEdges } = duplicateSubgraph(nodes, [e('ref', 'a')], ['a'])
    expect(out).toHaveLength(1)
    expect(out[0].data?.generationRecordId).toBeUndefined()
    expect(out[0].data?.url).toBe('u')
    expect(out[0].id).not.toBe('a')
    expect(outEdges).toHaveLength(0)
  })

  it('default mode copies nodes only without edges', () => {
    const nodes = [n('a', 'prompt'), n('b', 'image')]
    const edges = [e('a', 'b')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['a', 'b'])
    expect(outNodes).toHaveLength(2)
    expect(outEdges).toHaveLength(0)
  })

  it('upstream mode reuses upstream node and links to copy', () => {
    const nodes = [n('ref', 'image'), n('img', 'image')]
    const edges = [e('ref', 'img')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['img'], {
      edgeMode: 'upstream',
    })
    expect(outNodes).toHaveLength(1)
    expect(outNodes[0].id).not.toBe('img')
    expect(outEdges).toHaveLength(1)
    expect(outEdges[0].source).toBe('ref')
    expect(outEdges[0].target).toBe(outNodes[0].id)
  })

  it('upstream mode does not duplicate internal edges among selection', () => {
    const nodes = [n('p', 'prompt'), n('i', 'image'), n('v', 'video')]
    const edges = [e('p', 'i'), e('i', 'v'), e('ext', 'p')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(
      nodes,
      edges,
      ['p', 'i', 'v'],
      { edgeMode: 'upstream' },
    )
    expect(outNodes).toHaveLength(3)
    expect(outEdges).toHaveLength(1)
    expect(outEdges[0].source).toBe('ext')
    const copyP = outNodes.find((node) => node.type === 'prompt')!
    expect(outEdges[0].target).toBe(copyP.id)
  })

  it('internal mode copies edges fully inside selection', () => {
    const nodes = [n('a', 'prompt'), n('b', 'image'), n('c', 'video')]
    const edges = [e('a', 'b'), e('b', 'c'), e('a', 'c')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['a', 'b', 'c'], {
      edgeMode: 'internal',
    })
    expect(outNodes).toHaveLength(3)
    expect(outEdges).toHaveLength(3)
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
