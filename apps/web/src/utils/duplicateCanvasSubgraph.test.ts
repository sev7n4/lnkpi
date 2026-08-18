import { describe, expect, it } from 'vitest'
import {
  duplicateSubgraph,
  resolveDuplicateSourceIds,
  sanitizeNodeDataForDuplicate,
} from './duplicateCanvasSubgraph'
import type { DuplicateFlowNode } from './duplicateCanvasSubgraph'
import type { FlowEdge } from '@/composables/useCanvasActions'

const n = (
  id: string,
  type = 'image',
  extra: Partial<DuplicateFlowNode> = {},
): DuplicateFlowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {},
  ...extra,
})

const e = (source: string, target: string): FlowEdge => ({
  id: `e-${source}-${target}`,
  source,
  target,
})

describe('resolveDuplicateSourceIds', () => {
  it('keeps only selected seed for upstream mode', () => {
    const nodes = [n('ref'), n('img')]
    const edges = [e('ref', 'img')]
    const ids = resolveDuplicateSourceIds(nodes, edges, 'img', ['img'], 'upstream')
    expect(ids).toEqual(['img'])
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
    expect(out[0].data.generationRecordId).toBeUndefined()
    expect(out[0].data.url).toBe('u')
    expect(out[0].id).not.toBe('a')
  })

  it('copies nodes only by default', () => {
    const nodes = [n('a', 'prompt'), n('b', 'image'), n('c', 'video')]
    const edges = [e('a', 'b'), e('b', 'c')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['a', 'b', 'c'])
    expect(outNodes).toHaveLength(3)
    expect(outEdges).toHaveLength(0)
  })

  it('upstream mode links existing upstream to copy', () => {
    const nodes = [n('ref', 'image'), n('img', 'image')]
    const edges = [e('ref', 'img')]
    const { nodes: outNodes, edges: outEdges } = duplicateSubgraph(nodes, edges, ['img'], {
      edgeMode: 'upstream',
    })
    expect(outNodes).toHaveLength(1)
    expect(outEdges).toHaveLength(1)
    expect(outEdges[0].source).toBe('ref')
    expect(outEdges[0].target).toBe(outNodes[0].id)
  })

  it('offsets duplicated positions', () => {
    const nodes = [n('a', 'image', { position: { x: 100, y: 200 } })]
    const { nodes: out } = duplicateSubgraph(nodes, [], ['a'], { offset: { x: 48, y: 48 } })
    expect(out[0].position).toEqual({ x: 148, y: 248 })
  })
})

describe('sanitizeNodeDataForDuplicate', () => {
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
