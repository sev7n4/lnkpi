import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { duplicateSubgraph, resolveDuplicateSourceIds } from './duplicateCanvasSubgraph'

describe('duplicate with reactive canvas nodes', () => {
  it('does not throw on reactive nested data', () => {
    const nodes = [
      {
        id: 'img-1',
        type: 'image',
        position: { x: 100, y: 100 },
        data: reactive({
          url: 'https://x/a.png',
          prompt: 'test',
          settings: reactive({ model: 'gpt' }),
        }),
      },
    ]
    expect(() => duplicateSubgraph(nodes as any, [], ['img-1'])).not.toThrow()
    const result = duplicateSubgraph(nodes as any, [], ['img-1'])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].position).toEqual({ x: 148, y: 148 })
  })

  it('upstream resolves with reactive edges array', () => {
    const nodes = [
      { id: 'ref', type: 'image', position: { x: 0, y: 0 }, data: reactive({}) },
      { id: 'img', type: 'image', position: { x: 200, y: 0 }, data: reactive({ url: 'u' }) },
    ]
    const edges = [{ id: 'e-ref-img', source: 'ref', target: 'img' }]
    const sourceIds = resolveDuplicateSourceIds(nodes as any, edges, 'img', ['img'], 'upstream')
    expect(sourceIds.sort()).toEqual(['img', 'ref'])
  })
})
